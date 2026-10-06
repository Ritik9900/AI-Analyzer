import { fmtMoney } from "@/lib/format";
import type { InsightHolding, InsightsResponse, Observation, PortfolioAnalytics, Quote, SectorSlice } from "@/lib/types";

/*
 * Turns positions + live quotes + backend analytics into the Insights payload.
 * Everything here is deterministic arithmetic — no AI — so it is cheap and always available.
 */

export const WINDOWS = { "3m": { days: 63, label: "3M" }, "6m": { days: 126, label: "6M" }, "1y": { days: 252, label: "1Y" } } as const;
export type WindowKey = keyof typeof WINDOWS;

const BENCHMARK_LABELS: Record<string, string> = { "^NSEI": "NIFTY 50", "^GSPC": "S&P 500" };

/** Concentration flag: ~10% for diversified portfolios, relaxed for small ones (1.5x an equal weight). */
export const concentrationLimit = (holdings: number) => Math.max(10, holdings > 0 ? 150 / holdings : 10);
const SECTOR_LIMIT = 35; // % of portfolio
const HIGH_CORRELATION = 0.7;

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;

interface PositionLike {
  ticker: string;
  avgBuyPrice: number;
  quantity: number;
}

export function buildInsights(args: {
  positions: PositionLike[];
  quotes: Map<string, Quote>;
  currency: string | null;
  analytics: PortfolioAnalytics | null;
  windowKey: WindowKey;
  excluded: { ticker: string; reason: string }[];
  analyticsError: string | null;
  pricesError: string | null;
}): InsightsResponse {
  const { positions, quotes, currency, analytics } = args;
  const byTicker = new Map(analytics?.holdings.map((h) => [h.ticker, h]) ?? []);
  const money = (n: number) => fmtMoney(n, currency, 0);

  const base = positions.map((p) => {
    const q = quotes.get(p.ticker);
    const price = q?.price ?? null;
    const value = price == null ? null : price * p.quantity;
    const invested = p.avgBuyPrice * p.quantity;
    const dayChange = price != null && q?.previous_close ? (price - q.previous_close) * p.quantity : null;
    return { p, price, value, invested, dayChange, prevClose: q?.previous_close ?? null };
  });

  const priced = base.filter((b) => b.value != null);
  const marketValue = priced.reduce((s, b) => s + (b.value ?? 0), 0);
  const investedAll = base.reduce((s, b) => s + b.invested, 0);
  const investedPriced = priced.reduce((s, b) => s + b.invested, 0);
  const dayKnown = base.filter((b) => b.dayChange != null);
  const dayChange = dayKnown.length ? dayKnown.reduce((s, b) => s + (b.dayChange ?? 0), 0) : null;
  const prevValue = dayKnown.reduce((s, b) => s + (b.prevClose ?? 0) * b.p.quantity, 0);

  const holdings: InsightHolding[] = base
    .map((b) => {
      const a = byTicker.get(b.p.ticker);
      const pnl = b.value == null ? null : b.value - b.invested;
      return {
        ticker: b.p.ticker,
        name: a?.name ?? null,
        sector: a?.sector ?? "Unclassified",
        quantity: b.p.quantity,
        avgBuyPrice: b.p.avgBuyPrice,
        price: b.price,
        invested: b.invested,
        value: b.value,
        pnl,
        pnlPct: pnl == null ? null : (pnl / b.invested) * 100,
        dayChangePct: b.price != null && b.prevClose ? (b.price / b.prevClose - 1) * 100 : null,
        weightPct: b.value == null || marketValue <= 0 ? null : (b.value / marketValue) * 100,
        investedWeightPct: investedAll > 0 ? (b.invested / investedAll) * 100 : 0,
        returnPct: a?.return_pct ?? null,
        volatilityPct: a?.volatility_pct ?? null,
        beta: a?.beta ?? null,
        pctVsSma200: a?.pct_vs_sma200 ?? null,
        dividendYieldPct: a?.dividend_yield_pct ?? null,
        riskContributionPct: a?.risk_contribution_pct ?? null,
        hrpWeightPct: a?.hrp_weight_pct ?? null,
      };
    })
    .sort((x, y) => (y.value ?? y.invested) - (x.value ?? x.invested));

  // Sectors (by current value and by amount invested)
  const sectorMap = new Map<string, SectorSlice>();
  for (const h of holdings) {
    const s = sectorMap.get(h.sector) ?? { sector: h.sector, value: 0, invested: 0, valuePct: 0, investedPct: 0, tickers: [] };
    s.value += h.value ?? 0;
    s.invested += h.invested;
    s.tickers.push(h.ticker);
    sectorMap.set(h.sector, s);
  }
  const sectors = [...sectorMap.values()]
    .map((s) => ({ ...s, valuePct: marketValue > 0 ? (s.value / marketValue) * 100 : 0, investedPct: investedAll > 0 ? (s.invested / investedAll) * 100 : 0 }))
    .sort((a, b) => b.value - a.value || b.invested - a.invested);

  // Dividends: Yahoo trailing yield x current value (an estimate, not a forecast)
  const divKnown = holdings.filter((h) => h.value != null && h.dividendYieldPct != null);
  const estDividendIncome = analytics && divKnown.length ? divKnown.reduce((s, h) => s + (h.value ?? 0) * ((h.dividendYieldPct ?? 0) / 100), 0) : null;

  const pnl = marketValue - investedPriced;
  const stats = analytics?.stats;
  const benchmark = analytics ? { symbol: analytics.benchmark, label: BENCHMARK_LABELS[analytics.benchmark] ?? analytics.benchmark } : null;
  const windowLabel = WINDOWS[args.windowKey].label;

  // --- Observations, most important first -------------------------------------------
  const obs: Observation[] = [];
  const limit = concentrationLimit(holdings.length);
  const heavy = holdings.filter((h) => (h.weightPct ?? 0) > limit);
  if (heavy.length) {
    obs.push({
      tone: "warning",
      title: heavy.length === 1 ? `${heavy[0].ticker} is ${pct(heavy[0].weightPct ?? 0)} of your portfolio` : `${heavy.length} holdings are above ${limit.toFixed(0)}% each`,
      detail: `${heavy.map((h) => `${h.ticker} ${pct(h.weightPct ?? 0)}`).join(", ")}. With ${holdings.length} holdings, ~${limit.toFixed(0)}% per stock is a reasonable ceiling (diversified portfolios usually aim for ~10%) so one company's problems can't sink the whole portfolio.`,
    });
  }
  const topSector = analytics ? sectors[0] : undefined;
  if (topSector && topSector.valuePct > SECTOR_LIMIT && topSector.sector !== "Unclassified") {
    obs.push({
      tone: "warning",
      title: `${topSector.sector} is ${pct(topSector.valuePct)} of your portfolio`,
      detail: `${topSector.tickers.join(", ")} tend to rise and fall together on sector news. Consider adding exposure to other sectors over time.`,
    });
  }
  const riskHeavy = holdings
    .filter((h) => h.riskContributionPct != null && h.weightPct != null && h.riskContributionPct - h.weightPct > 5)
    .sort((a, b) => (b.riskContributionPct ?? 0) - (b.weightPct ?? 0) - ((a.riskContributionPct ?? 0) - (a.weightPct ?? 0)));
  if (riskHeavy[0]) {
    const h = riskHeavy[0];
    obs.push({
      tone: "info",
      title: `${h.ticker} drives more risk than its size suggests`,
      detail: `It is ${pct(h.weightPct ?? 0)} of your money but ${pct(h.riskContributionPct ?? 0)} of the portfolio's price swings (volatility ${pct(h.volatilityPct ?? 0, 0)} over ${windowLabel}).`,
    });
  }
  if (analytics?.correlation) {
    const { tickers, matrix } = analytics.correlation;
    const pairs: [string, string, number][] = [];
    for (let i = 0; i < tickers.length; i++) for (let j = i + 1; j < tickers.length; j++) if (matrix[i][j] >= HIGH_CORRELATION) pairs.push([tickers[i], tickers[j], matrix[i][j]]);
    pairs.sort((a, b) => b[2] - a[2]);
    if (pairs.length) {
      obs.push({
        tone: "info",
        title: pairs.length === 1 ? `${pairs[0][0]} and ${pairs[0][1]} move together` : `${pairs.length} pairs of holdings move closely together`,
        detail: `${pairs.slice(0, 3).map(([a, b, c]) => `${a} & ${b} (${c.toFixed(2)})`).join(", ")}. Highly correlated holdings add less diversification than their count suggests.`,
      });
    }
  }
  if (stats?.return_pct != null && stats.benchmark_return_pct != null && benchmark) {
    const diff = stats.return_pct - stats.benchmark_return_pct;
    if (Math.abs(diff) >= 3) {
      obs.push({
        tone: diff > 0 ? "positive" : "warning",
        title: `${diff > 0 ? "Ahead of" : "Behind"} the ${benchmark.label} by ${Math.abs(diff).toFixed(1)} points over ${windowLabel}`,
        detail: `Your current holdings returned ${pct(stats.return_pct)} vs ${pct(stats.benchmark_return_pct)} for the index (price returns, assuming today's quantities were held throughout).`,
      });
    }
  }
  const losers = holdings.filter((h) => (h.pnl ?? 0) < 0);
  const totalLoss = losers.reduce((s, h) => s + (h.pnl ?? 0), 0);
  if (losers.length && totalLoss < 0) {
    const worst = losers.reduce((a, b) => ((a.pnl ?? 0) < (b.pnl ?? 0) ? a : b));
    obs.push({
      tone: "info",
      title: `${worst.ticker} accounts for ${pct(((worst.pnl ?? 0) / totalLoss) * 100, 0)} of your unrealised losses`,
      detail: `${money(Math.abs(worst.pnl ?? 0))} of ${money(Math.abs(totalLoss))} in total losses across ${losers.length} holding${losers.length > 1 ? "s" : ""}.`,
    });
  }
  const withTrend = holdings.filter((h) => h.pctVsSma200 != null);
  const below = withTrend.filter((h) => (h.pctVsSma200 ?? 0) < 0);
  if (withTrend.length >= 3 && below.length / withTrend.length >= 0.5) {
    obs.push({
      tone: "info",
      title: `${below.length} of ${withTrend.length} holdings trade below their 200-day average`,
      detail: "A broad long-term downtrend across the portfolio. Use the AI Strategy on each position to separate temporarily cheap businesses from deteriorating ones.",
    });
  }
  if (stats && holdings.length >= 4 && stats.effective_holdings < holdings.length * 0.6) {
    obs.push({
      tone: "info",
      title: `Your ${holdings.length} holdings act like ~${stats.effective_holdings.toFixed(1)} equal-sized ones`,
      detail: "Uneven position sizes reduce effective diversification.",
    });
  }
  if (estDividendIncome != null && estDividendIncome > 0 && marketValue > 0) {
    obs.push({
      tone: "positive",
      title: `About ${money(estDividendIncome)} a year in dividends`,
      detail: `Estimated from trailing dividend yields (${pct((estDividendIncome / marketValue) * 100, 2)} on current value). Not guaranteed.`,
    });
  }

  return {
    currency,
    window: { days: WINDOWS[args.windowKey].days, label: windowLabel, startDate: analytics?.start_date ?? null },
    benchmark,
    kpis: {
      marketValue: r2(marketValue),
      invested: r2(investedAll),
      pnl: r2(pnl),
      pnlPct: investedPriced > 0 ? (pnl / investedPriced) * 100 : 0,
      dayChange: dayChange == null ? null : r2(dayChange),
      dayChangePct: dayChange != null && prevValue > 0 ? (dayChange / prevValue) * 100 : null,
      holdings: positions.length,
      estDividendIncome: estDividendIncome == null ? null : r2(estDividendIncome),
      dividendYieldPct: estDividendIncome != null && marketValue > 0 ? (estDividendIncome / marketValue) * 100 : null,
      returnPct: stats?.return_pct ?? null,
      benchmarkReturnPct: stats?.benchmark_return_pct ?? null,
      volatilityPct: stats?.volatility_pct ?? null,
      beta: stats?.beta ?? null,
      maxDrawdownPct: stats?.max_drawdown_pct ?? null,
      effectiveHoldings: stats?.effective_holdings ?? null,
      avgCorrelation: stats?.avg_correlation ?? null,
    },
    holdings,
    sectors,
    series: analytics?.series ?? [],
    correlation: analytics?.correlation ?? null,
    observations: obs,
    excluded: [...args.excluded, ...(analytics?.excluded ?? [])],
    analyticsError: args.analyticsError,
    pricesError: args.pricesError,
  };
}
