import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BackendError, getQuotes } from "@/lib/backend";
import { jsonError, readJson, validationError } from "@/lib/http";
import { TICKER_RE, unknownTickerResponse } from "@/lib/tickers";
import type { PositionRow, Quote } from "@/lib/types";

const createSchema = z.object({
  // Free text up to 60 chars; non-symbol input (e.g. a fund name) gets search suggestions below.
  ticker: z.string().trim().min(1).max(60),
  avgBuyPrice: z.number().positive().finite(),
  quantity: z.number().positive().finite(),
});

export async function GET() {
  const positions = await prisma.position.findMany({ orderBy: { ticker: "asc" } });

  const quotes = new Map<string, Quote>();
  let backendError: string | null = null;
  try {
    for (const q of await getQuotes(positions.map((p) => p.ticker))) quotes.set(q.ticker, q);
  } catch (err) {
    backendError = err instanceof BackendError ? err.message : "Could not fetch live prices.";
  }

  const rows: PositionRow[] = positions.map((p) => {
    const q = quotes.get(p.ticker);
    const price = q?.price ?? null;
    const costBasis = p.avgBuyPrice * p.quantity;
    const marketValue = price == null ? null : price * p.quantity;
    const pnl = marketValue == null ? null : marketValue - costBasis;
    return {
      id: p.id,
      ticker: p.ticker,
      avgBuyPrice: p.avgBuyPrice,
      quantity: p.quantity,
      price,
      currency: q?.currency ?? null,
      costBasis,
      marketValue,
      pnl,
      pnlPct: pnl == null ? null : (pnl / costBasis) * 100,
      dayChangePct: price != null && q?.previous_close ? (price / q.previous_close - 1) * 100 : null,
    };
  });

  return NextResponse.json({ positions: rows, backendError });
}

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const { avgBuyPrice, quantity } = parsed.data;
  if (!TICKER_RE.test(parsed.data.ticker)) return unknownTickerResponse(parsed.data.ticker);
  const ticker = parsed.data.ticker.toUpperCase();

  // Reject unknown symbols when the signals service is reachable; allow offline entry otherwise.
  try {
    const [quote] = await getQuotes([ticker]);
    if (quote && quote.price == null) return unknownTickerResponse(ticker);
  } catch {
    /* backend down — accept and show price as unavailable */
  }

  try {
    const position = await prisma.position.create({ data: { ticker, avgBuyPrice, quantity } });
    return NextResponse.json({ position }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return jsonError(409, "DUPLICATE", `${ticker} is already in your portfolio. Edit the existing row instead.`);
    }
    throw err;
  }
}
