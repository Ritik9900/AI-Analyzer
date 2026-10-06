import type { AnalyzerStrategy, PositionStrategy, VERDICTS } from "@/lib/strategy-schema";
import type { AnalyzeSignals, PositionFacts, PositionSignals } from "@/lib/types";

/*
 * Deterministic, rule-based LONG-TERM strategies used ONLY when every Gemini model fails.
 * Same output shape as the AI path so the UI renders it identically; always LOW confidence
 * and clearly labelled as a fallback.
 *
 * Scoring (each roughly -1..+1.5):
 *   quality   - Piotroski F-Score ratio, ROE
 *   valuation - analyst upside, PEG
 *   trend     - 200-day trend, 1y return relative to the benchmark index
 */

type Verdict = (typeof VERDICTS)[number];
type Row = { area: string; verdict: Verdict; note: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number | null | undefined, suffix = "") => (n == null ? "n/a" : `${r2(n)}${suffix}`);
const verdictOf = (score: number, known: boolean): Verdict => (!known ? "UNKNOWN" : score > 0.25 ? "POSITIVE" : score < -0.25 ? "NEGATIVE" : "NEUTRAL");

const FALLBACK_NOTE = "Rule-based fallback: Gemini was unavailable, so this was generated from fixed rules, not AI.";
const MAX_WEIGHT = 10;

function assess(signals: PositionSignals) {
  const lt = signals.long_term;
  const f = signals.fundamentals;
  const last = signals.technicals.last_close;

  // Quality
  let quality = 0;
  const fRatio = f.piotroski_score != null && f.piotroski_max ? f.piotroski_score / f.piotroski_max : null;
  if (fRatio != null && (f.piotroski_max ?? 0) >= 5) quality += fRatio >= 0.6 ? 1 : fRatio <= 0.35 ? -1 : 0;
  if (f.roe_pct != null) quality += f.roe_pct >= 15 ? 0.5 : f.roe_pct < 8 ? -0.5 : 0;
  const qualityKnown = fRatio != null || f.roe_pct != null;

  // Valuation
  let valuation = 0;
  if (f.analyst_upside_pct != null) valuation += f.analyst_upside_pct >= 15 ? 1 : f.analyst_upside_pct <= -5 ? -1 : 0;
  if (f.peg != null && f.peg > 0) valuation += f.peg < 1 ? 0.5 : f.peg > 2.5 ? -0.5 : 0;
  const valuationKnown = f.analyst_upside_pct != null || f.peg != null;

  // Trend
  let trend = lt.trend === "uptrend" ? 1 : lt.trend === "downtrend" ? -1 : 0;
  if (lt.relative_return_1y_pct != null) trend += lt.relative_return_1y_pct > 5 ? 0.5 : lt.relative_return_1y_pct < -10 ? -0.5 : 0;

  // Risk (informational; drives position-size caps)
  const highRisk = (lt.volatility_1y_pct ?? 0) > 40 || lt.max_drawdown_pct < -50;

  const scorecard: Row[] = [
    {
      area: "Business quality",
      verdict: verdictOf(quality, qualityKnown),
      note: `Piotroski F-Score ${f.piotroski_score ?? "n/a"}/${f.piotroski_max ?? 9}, ROE ${fmt(f.roe_pct, "%")}, debt/equity ${fmt(f.debt_to_equity)}.`,
    },
    {
      area: "Valuation",
      verdict: verdictOf(valuation, valuationKnown),
      note: `P/E ${fmt(f.pe_trailing)} (forward ${fmt(f.pe_forward)}), PEG ${fmt(f.peg)}, analyst target ${fmt(f.analyst_target_mean)} (${fmt(f.analyst_upside_pct, "%")} upside).`,
    },
    {
      area: "Long-term trend",
      verdict: verdictOf(trend, lt.trend !== "unknown"),
      note: `${lt.trend}; ${fmt(lt.price_vs_sma200_pct, "%")} vs 200-day average, 1y ${fmt(lt.return_1y_pct, "%")} vs ${lt.benchmark ?? "index"} ${fmt(lt.benchmark_return_1y_pct, "%")}.`,
    },
    {
      area: "Risk",
      verdict: highRisk ? "NEGATIVE" : "NEUTRAL",
      note: `1y volatility ${fmt(lt.volatility_1y_pct, "%")}, max drawdown ${fmt(lt.max_drawdown_pct, "%")}, beta ${fmt(lt.beta_1y)}.`,
    },
  ];

  // Staggered buy levels below the price: 200-DMA, weekly supports, 52-week low; de-duplicated within 3%.
  const candidates = [lt.sma_200, ...lt.weekly_support, lt.low_52w]
    .filter((p): p is number => p != null && p < last * 0.995)
    .sort((a, b) => b - a);
  const levels: number[] = [];
  for (const p of candidates) if (!levels.some((l) => Math.abs(l - p) / l < 0.03)) levels.push(p);
  while (levels.length < 2) levels.push((levels.at(-1) ?? last) * 0.93);

  const targets = [
    { label: "Analyst mean target", price: f.analyst_target_mean },
    { label: "Weekly resistance", price: lt.weekly_resistance[0] },
    { label: "200-day average", price: lt.sma_200 },
    { label: "52-week high", price: lt.high_52w },
  ]
    .filter((t): t is { label: string; price: number } => t.price != null && t.price > last * 1.01)
    .sort((a, b) => a.price - b.price)
    .slice(0, 3)
    .map((t) => ({ ...t, price: r2(t.price) }));

  const invalidationPrice = r2(Math.min(lt.low_52w, ...lt.weekly_support.slice(-1)) * 0.97);
  const thesisInvalidation = {
    price: invalidationPrice,
    condition:
      lt.trend === "uptrend"
        ? `Weekly closes below the 200-day average (${fmt(lt.sma_200)}) for 4+ weeks, or the Piotroski F-Score falling below 4.`
        : `A weekly close below ${invalidationPrice} (3% under the 52-week low / lowest weekly support), or the Piotroski F-Score falling below 4.`,
  };

  const risks = [FALLBACK_NOTE];
  if (signals.forecast.is_mock) risks.push("The price forecast is a synthetic baseline (local model not loaded).");
  if (f.note) risks.push(f.note);
  if (highRisk) risks.push("High volatility / deep historical drawdowns: size the position conservatively.");

  return { last, lt, f, quality, valuation, trend, highRisk, scorecard, levels, targets, thesisInvalidation, risks };
}

export function rulePositionStrategy(signals: PositionSignals, pos: PositionFacts): PositionStrategy {
  const a = assess(signals);
  const weight = pos.portfolioWeightPct;
  const base = {
    confidence: "LOW" as const,
    scorecard: a.scorecard,
    thesisInvalidation: a.thesisInvalidation,
    fairValue: null,
    targets: a.targets,
    horizon: "3-5 years",
    reviewTrigger: "After the next quarterly results, or if the invalidation condition is hit.",
    risks: a.risks,
  };
  const pnl = `${pos.unrealizedPnlPct >= 0 ? "up" : "down"} ${Math.abs(pos.unrealizedPnlPct).toFixed(1)}%`;

  if (a.quality <= -1 && a.trend < 0) {
    const half = Math.floor(pos.quantity / 2);
    const exitLevel = r2(Math.max(a.last, a.lt.weekly_resistance[0] ?? a.last));
    return {
      ...base,
      stance: "EXIT",
      summary: `Position is ${pnl}. Business quality is weak and the long-term trend is down, so the original thesis looks broken. Exit in parts into strength rather than at the lows.`,
      actions: [
        { action: "Sell half", price: exitLevel, quantity: half || null, rationale: "Into the nearest weekly resistance / current price." },
        { action: "Sell remainder", price: a.lt.sma_200 ? r2(Math.max(a.last, a.lt.sma_200)) : null, quantity: pos.quantity - half, rationale: "On a rebound toward the 200-day average, or at the invalidation level, whichever comes first." },
      ],
    };
  }

  if (a.quality <= -1 || (a.trend < 0 && a.valuation < 0)) {
    return {
      ...base,
      stance: "REVIEW_THESIS",
      summary: `Position is ${pnl}. ${a.quality <= -1 ? "Fundamental quality is weakening" : "The trend is down and valuation offers little cushion"}. Do not add money until the next results confirm the business is stabilising.`,
      actions: [{ action: "Hold, no new buying", price: null, quantity: null, rationale: "Wait for improving F-Score / earnings, or a reclaim of the 200-day average." }],
    };
  }

  if (weight != null && weight > 15) {
    const sellQty = Math.floor(pos.quantity * (1 - MAX_WEIGHT / weight));
    // Near the 52-week low, rebalance into the next rebound instead of selling at the bottom.
    const nearLow = a.lt.pct_from_52w_low < 10;
    const resistance = a.lt.weekly_resistance.filter((p) => p > a.last).slice(0, 2);
    const actions =
      nearLow && resistance.length
        ? resistance.map((price, i) => {
            const qty = i === resistance.length - 1 ? sellQty - Math.floor(sellQty / resistance.length) * i : Math.floor(sellQty / resistance.length);
            return { action: `Sell to rebalance (part ${i + 1})`, price: r2(price), quantity: qty || null, rationale: "Into weekly resistance on a rebound, rather than at the 52-week low." };
          })
        : [{ action: "Sell to rebalance", price: r2(a.last), quantity: sellQty || null, rationale: `Brings the weight back to about ${MAX_WEIGHT}%.` }];
    return {
      ...base,
      stance: "TRIM",
      summary: `Position is ${pnl} and makes up ${weight.toFixed(1)}% of the portfolio, above the ~${MAX_WEIGHT}% single-stock guideline. Reduce it to about ${MAX_WEIGHT}% to limit concentration risk${nearLow ? ", selling into rebounds rather than at the lows" : ""}. Do not add more.`,
      actions,
    };
  }

  if (pos.status === "PROFIT" && a.valuation <= -1 && (a.lt.rsi_weekly_14 ?? 0) > 70) {
    const sellQty = Math.floor(pos.quantity * 0.2);
    return {
      ...base,
      stance: "TRIM",
      summary: `Position is ${pnl}. Valuation looks stretched versus analyst targets and the weekly RSI is overbought, so booking part of the gain is reasonable while keeping the core holding.`,
      actions: [{ action: "Sell partial", price: r2(a.last), quantity: sellQty || null, rationale: "Trim ~20%; keep the rest compounding." }],
    };
  }

  if (a.quality >= 1 && a.valuation >= 0 && (weight == null || weight < MAX_WEIGHT)) {
    // Add up to the concentration cap (or +25% of the holding if the weight is unknown), split 50/50 across two levels.
    const capValue = weight != null && weight > 0 ? pos.marketValue * (MAX_WEIGHT / weight - 1) : pos.marketValue * 0.25;
    const budget = Math.min(capValue, pos.marketValue * 0.5);
    const tranches = a.levels.slice(0, 2).map((price) => ({ price: r2(price), quantity: Math.floor(budget / 2 / price) }));
    const addedQty = tranches.reduce((s, t) => s + t.quantity, 0);
    const newAvg = addedQty > 0 ? (pos.costBasis + tranches.reduce((s, t) => s + t.price * t.quantity, 0)) / (pos.quantity + addedQty) : null;
    return {
      ...base,
      stance: "ACCUMULATE",
      summary: `Position is ${pnl}. Business quality is sound and valuation is not stretched, so adding gradually at lower levels is reasonable while staying under the ~${MAX_WEIGHT}% weight guideline.`,
      actions: tranches.map((t, i) => ({
        action: `Buy tranche ${i + 1}`,
        price: t.price,
        quantity: t.quantity || null,
        rationale: `${i === 0 ? "Near the 200-day average / first weekly support." : "Deeper support / near the 52-week low."}${i === tranches.length - 1 && newAvg ? ` Average cost if both fill: ${r2(newAvg)}.` : ""}`,
      })),
    };
  }

  return {
    ...base,
    stance: "HOLD",
    summary: `Position is ${pnl}. Signals are mixed; there is no strong case to add or sell. Hold and reassess after the next results.`,
    actions: [{ action: "Hold", price: null, quantity: null, rationale: "Re-evaluate after quarterly results or if the invalidation condition is hit." }],
  };
}

export function ruleAnalyzerStrategy(signals: AnalyzeSignals): AnalyzerStrategy {
  const a = assess(signals);
  const sent = signals.sentiment.score;
  const total = a.quality + a.valuation + a.trend + (sent > 0.3 ? 0.25 : sent < -0.3 ? -0.25 : 0);
  const stance: AnalyzerStrategy["stance"] = total >= 2 ? "BUY" : total >= 1 ? "ACCUMULATE_GRADUALLY" : total >= -0.5 ? "WATCHLIST" : "AVOID";

  const prices = stance === "BUY" ? [a.last, ...a.levels.slice(0, 2)] : a.levels.slice(0, 3);
  const alloc = prices.length === 3 ? [40, 30, 30] : [50, 50];
  const tranches = prices.map((p, i) => ({
    price: r2(p),
    allocationPct: alloc[i] ?? 0,
    note: i === 0 && stance === "BUY" ? "Starter position at the current price." : "Staggered buy near support / 200-day average / 52-week low.",
  }));
  const zonePrices = tranches.map((t) => t.price);

  return {
    stance,
    confidence: "LOW",
    summary: `Rule-based tally ${total >= 0 ? "+" : ""}${r2(total)} across quality, valuation and trend. ${
      stance === "BUY" || stance === "ACCUMULATE_GRADUALLY"
        ? "Build the position in tranches rather than all at once."
        : "Wait for better data or a lower price before committing capital."
    }`,
    scorecard: [
      ...a.scorecard,
      {
        area: "News sentiment",
        verdict: signals.sentiment.headlines.length ? verdictOf(sent, true) : "UNKNOWN",
        note: `Aggregate ${signals.sentiment.label} (${sent.toFixed(2)}); short-term noise for a long-term investor.`,
      },
    ],
    accumulationZone: { low: Math.min(...zonePrices), high: Math.max(...zonePrices) },
    tranches,
    thesisInvalidation: a.thesisInvalidation,
    fairValue: null,
    targets: a.targets,
    horizon: "3-5 years",
    maxPortfolioWeightPct: a.highRisk ? 3 : a.quality >= 1 ? 8 : 5,
    reviewTrigger: "After the next quarterly results.",
    rationale: a.scorecard.map((r) => `${r.area}: ${r.note}`),
    risks: signals.sentiment.is_mock ? [...a.risks, "Sentiment is a keyword heuristic (FinBERT not loaded)."] : a.risks,
  };
}
