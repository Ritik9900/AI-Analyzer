import type { Schema } from "@google/genai";
import type { ZodType } from "zod";
import { prisma } from "@/lib/prisma";
import { GeminiAuthError, GeminiUnavailableError, generateWithFallback } from "@/lib/gemini";
import { jsonError } from "@/lib/http";
import { SYSTEM_INSTRUCTION } from "@/lib/prompts";
import { getAiConfig, type AiConfig } from "@/lib/settings";
import type { StrategyMeta } from "@/lib/types";

/** Returns the AI config, or an error response if AI features are locked. */
export async function requireAi(): Promise<{ cfg: AiConfig & { apiKey: string } } | { error: Response }> {
  const cfg = await getAiConfig();
  if (!cfg.apiKey) {
    return {
      error: jsonError(
        403,
        "AI_LOCKED",
        cfg.keyError ?? "Add your Gemini API key in Settings to enable AI features.",
      ),
    };
  }
  return { cfg: cfg as AiConfig & { apiKey: string } };
}

interface StrategyRequest<T> {
  cfg: AiConfig & { apiKey: string };
  prompt: string;
  responseSchema: Schema;
  validator: ZodType<T>;
  fallback: () => T;
}

/**
 * Gemini (with model fallback chain) → rule-based fallback if every model fails.
 * Auth failures are surfaced to the user instead, because no model will work with a bad key.
 */
export async function runStrategy<T>(
  req: StrategyRequest<T>,
): Promise<{ strategy: T; meta: StrategyMeta } | { error: Response }> {
  try {
    const result = await generateWithFallback({
      apiKey: req.cfg.apiKey,
      models: req.cfg.models,
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt: req.prompt,
      responseSchema: req.responseSchema,
      validator: req.validator,
    });
    return { strategy: result.data, meta: { source: "gemini", model: result.model, attempts: result.attempts } };
  } catch (err) {
    if (err instanceof GeminiAuthError) {
      return {
        error: jsonError(401, "GEMINI_AUTH", "Gemini rejected the API key. Update it in Settings.", {
          attempts: err.attempts,
        }),
      };
    }
    if (err instanceof GeminiUnavailableError) {
      return {
        strategy: req.fallback(),
        meta: {
          source: "rule-based",
          model: null,
          attempts: err.attempts,
          fallbackReason: "Every Gemini model in the fallback chain failed; showing a rule-based strategy instead.",
        },
      };
    }
    throw err;
  }
}

/** Persist the exact inputs and outputs for later review. Never blocks the response. */
export async function saveReport(args: {
  kind: "POSITION" | "ANALYZER";
  ticker: string;
  positionId?: number;
  signals: unknown;
  strategy: unknown;
  meta: StrategyMeta;
  usedMockMl: boolean;
  /** Position facts at generation time (POSITION reports), so a saved view can be shown later as-is. */
  position?: unknown;
}): Promise<number | undefined> {
  try {
    const report = await prisma.strategyReport.create({
      data: {
        kind: args.kind,
        ticker: args.ticker,
        positionId: args.positionId,
        signalsJson: JSON.stringify(args.signals),
        outputJson: JSON.stringify({ strategy: args.strategy, meta: args.meta, position: args.position }),
        usedMockMl: args.usedMockMl,
        geminiModel: args.meta.model ?? "rule-based",
      },
    });
    return report.id;
  } catch (err) {
    console.error("Failed to save strategy report", err);
    return undefined;
  }
}
