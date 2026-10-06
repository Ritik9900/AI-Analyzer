import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BackendError, getPortfolioAnalytics, getQuotes } from "@/lib/backend";
import { WINDOWS, buildInsights, type WindowKey } from "@/lib/insights";
import type { PortfolioAnalytics, Quote } from "@/lib/types";

export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get("window") ?? "1y";
  const windowKey: WindowKey = param in WINDOWS ? (param as WindowKey) : "1y";

  const positions = await prisma.position.findMany();

  const quotes = new Map<string, Quote>();
  let pricesError: string | null = null;
  try {
    for (const q of await getQuotes(positions.map((p) => p.ticker))) quotes.set(q.ticker, q);
  } catch (err) {
    pricesError = err instanceof BackendError ? err.message : "Could not fetch live prices.";
  }

  // Analyse one currency at a time (no FX conversion): the one holding the most value.
  const valueByCurrency = new Map<string, number>();
  for (const p of positions) {
    const q = quotes.get(p.ticker);
    const ccy = q?.currency ?? "UNKNOWN";
    valueByCurrency.set(ccy, (valueByCurrency.get(ccy) ?? 0) + (q?.price ?? p.avgBuyPrice) * p.quantity);
  }
  const currency = [...valueByCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const inScope = positions.filter((p) => (quotes.get(p.ticker)?.currency ?? "UNKNOWN") === currency);
  const excluded = positions
    .filter((p) => !inScope.includes(p))
    .map((p) => ({ ticker: p.ticker, reason: `Priced in ${quotes.get(p.ticker)?.currency ?? "an unknown currency"}; insights cover ${currency} holdings only` }));

  let analytics: PortfolioAnalytics | null = null;
  let analyticsError: string | null = null;
  if (inScope.length) {
    try {
      analytics = await getPortfolioAnalytics(
        inScope.map((p) => ({ ticker: p.ticker, quantity: p.quantity })),
        WINDOWS[windowKey].days,
      );
    } catch (err) {
      analyticsError = err instanceof BackendError ? err.message : "Portfolio analytics unavailable.";
    }
  }

  return NextResponse.json(
    buildInsights({
      positions: inScope,
      quotes,
      currency: currency === "UNKNOWN" ? null : currency,
      analytics,
      windowKey,
      excluded,
      analyticsError,
      pricesError,
    }),
  );
}
