import { NextResponse } from "next/server";
import { z } from "zod";
import { BackendError, backendStatus, getDiscoverOptions, runDiscover } from "@/lib/backend";
import { ruleShortlist, sanitizeShortlist, shortlistGeminiSchema, shortlistPrompt, shortlistSchema } from "@/lib/discover";
import { GeminiAuthError, GeminiUnavailableError, generateWithFallback } from "@/lib/gemini";
import { jsonError, readJson, validationError } from "@/lib/http";
import { SYSTEM_INSTRUCTION } from "@/lib/prompts";
import { getAiConfig } from "@/lib/settings";
import type { StrategyMeta } from "@/lib/types";

/** GET: markets, exchanges and sectors for the filters. */
export async function GET() {
  try {
    return NextResponse.json(await getDiscoverOptions());
  } catch (err) {
    if (err instanceof BackendError) return jsonError(backendStatus(err), "BACKEND", err.message);
    throw err;
  }
}

const bodySchema = z.object({
  country: z.enum(["in", "us"]),
  exchanges: z.array(z.string().max(10)).min(1).max(4),
  sector: z.string().min(2).max(40),
  min_market_cap: z.number().nonnegative().nullable().default(null),
});

/** POST: screen the sector, then a ranked shortlist (Gemini when configured, otherwise rule-based). */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);

  let result;
  try {
    result = await runDiscover(parsed.data);
  } catch (err) {
    if (err instanceof BackendError) return jsonError(backendStatus(err), "BACKEND", err.message);
    throw err;
  }
  if (!result.finalists.length) return NextResponse.json({ result, shortlist: null, meta: null });

  const finalists = result.finalists.map((f) => f.ticker);
  const cfg = await getAiConfig();
  let meta: StrategyMeta = { source: "rule-based", model: null, attempts: [], fallbackReason: cfg.apiKey ? undefined : "No Gemini API key saved." };
  let shortlist = null;

  if (cfg.apiKey) {
    try {
      const ai = await generateWithFallback({
        apiKey: cfg.apiKey,
        models: cfg.models,
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: shortlistPrompt(result),
        responseSchema: shortlistGeminiSchema,
        validator: shortlistSchema,
      });
      shortlist = sanitizeShortlist(ai.data, finalists);
      meta = shortlist
        ? { source: "gemini", model: ai.model, attempts: ai.attempts }
        : { source: "rule-based", model: null, attempts: ai.attempts, fallbackReason: "Gemini's answer did not match the finalists." };
    } catch (err) {
      if (err instanceof GeminiAuthError) {
        meta = { source: "rule-based", model: null, attempts: err.attempts, fallbackReason: "Gemini rejected the API key. Update it in Settings." };
      } else if (err instanceof GeminiUnavailableError) {
        meta = { source: "rule-based", model: null, attempts: err.attempts, fallbackReason: "Every Gemini model in the fallback chain failed." };
      } else {
        throw err;
      }
    }
  }
  return NextResponse.json({ result, shortlist: shortlist ?? ruleShortlist(result), meta });
}
