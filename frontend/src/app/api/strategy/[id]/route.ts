import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BackendError, backendStatus, getPositionSignals, getQuotes } from "@/lib/backend";
import { jsonError } from "@/lib/http";
import { requireAi, runStrategy, saveReport } from "@/lib/ai-pipeline";
import { rulePositionStrategy } from "@/lib/fallback-strategy";
import { positionPrompt } from "@/lib/prompts";
import { positionGeminiSchema, positionStrategySchema } from "@/lib/strategy-schema";
import type { PositionFacts, PositionSignals, Quote } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(_req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return jsonError(400, "VALIDATION", "Invalid position id");

  const ai = await requireAi();
  if ("error" in ai) return ai.error;

  const position = await prisma.position.findUnique({ where: { id } });
  if (!position) return jsonError(404, "NOT_FOUND", "Position not found");

  const allPositions = await prisma.position.findMany();
  let signals: PositionSignals;
  let quotes: Quote[];
  try {
    // Quotes for every holding let the advisor see portfolio concentration.
    [signals, quotes] = await Promise.all([
      getPositionSignals(position.ticker),
      getQuotes(allPositions.map((p) => p.ticker)).catch(() => [] as Quote[]),
    ]);
  } catch (err) {
    if (err instanceof BackendError) return jsonError(backendStatus(err), "BACKEND", err.message);
    throw err;
  }

  const last = signals.technicals.last_close;
  const costBasis = position.avgBuyPrice * position.quantity;
  const marketValue = last * position.quantity;
  const pnl = marketValue - costBasis;
  const pnlPct = (pnl / costBasis) * 100;

  // Weight within same-currency holdings (no FX conversion); null if any price is missing.
  const quoteBy = new Map(quotes.map((q) => [q.ticker, q]));
  const sameCurrency = allPositions.filter((p) => (quoteBy.get(p.ticker)?.currency ?? signals.currency) === signals.currency);
  const values = sameCurrency.map((p) => (p.id === position.id ? marketValue : (quoteBy.get(p.ticker)?.price ?? NaN) * p.quantity));
  const total = values.reduce((s, v) => s + v, 0);
  const portfolioWeightPct = Number.isFinite(total) && total > 0 ? r2((marketValue / total) * 100) : null;
  const facts: PositionFacts = {
    ticker: position.ticker,
    quantity: position.quantity,
    avgBuyPrice: position.avgBuyPrice,
    lastPrice: last,
    costBasis: r2(costBasis),
    marketValue: r2(marketValue),
    unrealizedPnl: r2(pnl),
    unrealizedPnlPct: r2(pnlPct),
    status: Math.abs(pnlPct) < 0.05 ? "FLAT" : pnl > 0 ? "PROFIT" : "LOSS",
    portfolioWeightPct,
    portfolioPositions: allPositions.length,
  };

  const result = await runStrategy({
    cfg: ai.cfg,
    prompt: positionPrompt(facts, signals),
    responseSchema: positionGeminiSchema,
    validator: positionStrategySchema,
    fallback: () => rulePositionStrategy(signals, facts),
  });
  if ("error" in result) return result.error;

  result.meta.reportId = await saveReport({
    kind: "POSITION",
    ticker: position.ticker,
    positionId: position.id,
    signals,
    strategy: result.strategy,
    meta: result.meta,
    usedMockMl: signals.forecast.is_mock,
  });

  return NextResponse.json({ position: facts, signals, strategy: result.strategy, meta: result.meta });
}
