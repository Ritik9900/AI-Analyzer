import { GoogleGenAI, type Schema } from "@google/genai";
import type { ZodType } from "zod";
import type { GeminiAttempt } from "@/lib/types";

/*
 * Gemini with a model fallback chain.
 *
 *  For each model in the configured chain (Settings → Model fallback chain):
 *    - 429 / 5xx / timeouts / network  → retry the same model once with backoff, then move on
 *    - 404 / "not found" / unsupported / 403 model access → move to the next model immediately
 *    - malformed or schema-invalid JSON, empty/blocked output → move to the next model
 *    - invalid API key (401 or API_KEY_INVALID)            → stop: no model will work
 *  If every configured model is *unavailable* (retired ids), discover live models via
 *  models.list() and try up to two stable ones not yet tried.
 *  If everything fails, the caller decides what to do (we fall back to rule-based output).
 */

const REQUEST_TIMEOUT_MS = 45_000;
const TOTAL_BUDGET_MS = 120_000;
const MAX_ATTEMPTS_PER_MODEL = 2;
const MAX_DISCOVERED_MODELS = 2;

export class GeminiAuthError extends Error {
  constructor(
    message: string,
    public attempts: GeminiAttempt[],
  ) {
    super(message);
  }
}

export class GeminiUnavailableError extends Error {
  constructor(
    message: string,
    public attempts: GeminiAttempt[],
  ) {
    super(message);
  }
}

class BadOutputError extends Error {}

type ErrorKind = "auth" | "model_unavailable" | "retryable" | "bad_output" | "bad_request";

const redact = (s: string) => s.replace(/AIza[0-9A-Za-z_\-]{20,}/g, "[redacted-key]").slice(0, 300);

function errorStatus(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    for (const k of ["status", "code"]) {
      if (typeof rec[k] === "number") return rec[k] as number;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/"code"\s*:\s*(\d{3})/) ?? msg.match(/\b(4\d\d|5\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

function classify(err: unknown): { kind: ErrorKind; message: string } {
  const message = redact(err instanceof Error ? err.message : String(err));
  if (err instanceof BadOutputError) return { kind: "bad_output", message };

  const status = errorStatus(err);
  if (status === 401 || /API key not valid|API_KEY_INVALID|invalid api key|API key expired/i.test(message)) {
    return { kind: "auth", message };
  }
  if (
    status === 404 ||
    status === 403 ||
    /not found|is not supported|no longer available|deprecated|not available|unsupported model/i.test(message)
  ) {
    return { kind: "model_unavailable", message };
  }
  if (
    status === 429 ||
    (status !== undefined && status >= 500) ||
    /RESOURCE_EXHAUSTED|overloaded|UNAVAILABLE|DEADLINE_EXCEEDED|timed? ?out|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|aborted/i.test(
      message,
    )
  ) {
    return { kind: "retryable", message };
  }
  return { kind: "bad_request", message };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new BadOutputError("Model returned invalid JSON");
  }
}

function client(apiKey: string) {
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
}

export interface GenerateOptions<T> {
  apiKey: string;
  models: string[];
  systemInstruction: string;
  prompt: string;
  responseSchema: Schema;
  validator: ZodType<T>;
  temperature?: number;
}

export interface GenerateResult<T> {
  data: T;
  model: string;
  attempts: GeminiAttempt[];
}

export async function generateWithFallback<T>(opts: GenerateOptions<T>): Promise<GenerateResult<T>> {
  const ai = client(opts.apiKey);
  const attempts: GeminiAttempt[] = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const tried = new Set<string>();

  const tryModel = async (model: string): Promise<{ data: T } | { kind: ErrorKind }> => {
    tried.add(model);
    let lastKind: ErrorKind = "bad_request";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      if (Date.now() > deadline) return { kind: "retryable" };
      try {
        const res = await ai.models.generateContent({
          model,
          contents: opts.prompt,
          config: {
            systemInstruction: opts.systemInstruction,
            responseMimeType: "application/json",
            responseSchema: opts.responseSchema,
            temperature: opts.temperature ?? 0.2,
          },
        });
        const text = res.text;
        if (!text) {
          const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "empty";
          throw new BadOutputError(`No text returned (finish reason: ${reason})`);
        }
        const parsed = opts.validator.safeParse(parseJson(text));
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new BadOutputError(`Output failed validation at ${issue?.path.join(".") || "root"}: ${issue?.message}`);
        }
        attempts.push({ model, ok: true });
        return { data: parsed.data };
      } catch (err) {
        const { kind, message } = classify(err);
        attempts.push({ model, ok: false, error: `${kind}: ${message}` });
        if (kind === "auth") throw new GeminiAuthError(message, attempts);
        lastKind = kind;
        if (kind === "retryable" && attempt < MAX_ATTEMPTS_PER_MODEL) {
          await sleep(1000 * attempt + Math.random() * 500);
          continue;
        }
        return { kind };
      }
    }
    return { kind: lastKind };
  };

  const kinds: ErrorKind[] = [];
  for (const model of opts.models) {
    const result = await tryModel(model);
    if ("data" in result) return { data: result.data, model, attempts };
    kinds.push(result.kind);
    if (Date.now() > deadline) break;
  }

  // Every configured id is retired/unknown → discover what this key can actually use.
  if (kinds.length && kinds.every((k) => k === "model_unavailable") && Date.now() < deadline) {
    const discovered = (await listGenerativeModels(opts.apiKey).catch(() => [])).filter((m) => !tried.has(m));
    for (const model of discovered.slice(0, MAX_DISCOVERED_MODELS)) {
      const result = await tryModel(model);
      if ("data" in result) return { data: result.data, model, attempts };
      if (Date.now() > deadline) break;
    }
  }

  throw new GeminiUnavailableError("All Gemini models failed", attempts);
}

/**
 * Stable text models available to this key, best first (newest version, flash before pro,
 * full before lite). Preview/experimental/specialised variants are excluded.
 */
export async function listGenerativeModels(apiKey: string): Promise<string[]> {
  const ai = client(apiKey);
  const names: string[] = [];
  const pager = await ai.models.list();
  for await (const m of pager) {
    const name = (m.name ?? "").replace(/^models\//, "");
    const actions = (m as { supportedActions?: string[] }).supportedActions;
    if (actions && !actions.includes("generateContent")) continue;
    if (/^gemini-\d+(\.\d+)?-(flash|pro)(-lite)?$/.test(name)) names.push(name);
  }
  const version = (n: string) => Number(n.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const tier = (n: string) => (n.endsWith("-flash") ? 0 : n.endsWith("-flash-lite") ? 1 : n.endsWith("-pro") ? 2 : 3);
  return [...new Set(names)].sort((a, b) => version(b) - version(a) || tier(a) - tier(b));
}
