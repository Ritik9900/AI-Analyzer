import { NextResponse } from "next/server";
import { z } from "zod";
import { BackendError, backendStatus, getAnalyzeSignals } from "@/lib/backend";
import { jsonError, readJson, validationError } from "@/lib/http";
import { requireAi, runStrategy, saveReport } from "@/lib/ai-pipeline";
import { ruleAnalyzerStrategy } from "@/lib/fallback-strategy";
import { analyzerPrompt } from "@/lib/prompts";
import { analyzerGeminiSchema, analyzerStrategySchema } from "@/lib/strategy-schema";
import { TICKER_RE, unknownTickerResponse } from "@/lib/tickers";
import type { AnalyzeSignals } from "@/lib/types";

const bodySchema = z.object({ ticker: z.string().trim().min(1).max(60) });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);

  const ai = await requireAi();
  if ("error" in ai) return ai.error;

  if (!TICKER_RE.test(parsed.data.ticker)) return unknownTickerResponse(parsed.data.ticker);
  const ticker = parsed.data.ticker.toUpperCase();

  let signals: AnalyzeSignals;
  try {
    signals = await getAnalyzeSignals(ticker);
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) return unknownTickerResponse(ticker, 404);
    if (err instanceof BackendError) return jsonError(backendStatus(err), "BACKEND", err.message);
    throw err;
  }

  const result = await runStrategy({
    cfg: ai.cfg,
    prompt: analyzerPrompt(signals),
    responseSchema: analyzerGeminiSchema,
    validator: analyzerStrategySchema,
    fallback: () => ruleAnalyzerStrategy(signals),
  });
  if ("error" in result) return result.error;

  result.meta.reportId = await saveReport({
    kind: "ANALYZER",
    ticker,
    signals,
    strategy: result.strategy,
    meta: result.meta,
    usedMockMl: signals.forecast.is_mock || signals.sentiment.is_mock,
  });

  return NextResponse.json({ signals, strategy: result.strategy, meta: result.meta });
}
