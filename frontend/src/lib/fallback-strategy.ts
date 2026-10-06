import type { AnalyzerStrategy, PositionStrategy } from "@/lib/strategy-schema";
import type { AnalyzeSignals, PositionFacts, PositionSignals } from "@/lib/types";

/*
 * Deterministic, rule-based strategies used ONLY when every Gemini model fails.
 * Same output shape as the AI path so the UI renders it identically; always LOW confidence
 * and clearly labelled as a fallback.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

const FALLBACK_NOTE = "Rule-based fallback: Gemini was unavailable, so this was generated from fixed rules, not AI.";

function context(signals: PositionSignals) {
  const t = signals.technicals;
  const f = signals.forecast;
  const last = t.last_close;
  const atr = t.atr_14 ?? last * 0.02;
  const s1 = t.support[0] ?? last - 1.5 * atr;
  const s2 = t.support[1] ?? s1 - atr;
  const r1 = t.resistance[0];
  const r2nd = t.resistance[1];
  const risks = [FALLBACK_NOTE];
  if (f.is_mock) risks.push("The forecast is a synthetic baseline (local model not loaded), not a model prediction.");
  return {
    t,
    f,
    last,
    atr,
    s1,
    s2,
    r1,
    r2nd,
    risks,
    macdBull: t.macd_trend === "bullish",
    fcUp: f.expected_return_pct > 0.5,
    fcDown: f.expected_return_pct < -0.5,
  };
}

export function rulePositionStrategy(signals: PositionSignals, pos: PositionFacts): PositionStrategy {
  const c = context(signals);
  const { last, atr } = c;
  const targetsAbove = (levels: [string, number | undefined][]) =>
    levels.filter((l): l is [string, number] => l[1] != null && l[1] > last).map(([label, price]) => ({ label, price: r2(price) }));

  if (pos.status === "LOSS") {
    if (c.fcUp && c.macdBull && (c.t.rsi_14 ?? 50) < 70) {
      const low = r2(Math.max(c.s1 - 0.25 * atr, last - 2 * atr));
      const high = r2(Math.max(low, Math.min(last, low + atr)));
      const addQty = Math.floor(pos.quantity * 0.25);
      const mid = (low + high) / 2;
      const newAvg = addQty > 0 ? (pos.avgBuyPrice * pos.quantity + mid * addQty) / (pos.quantity + addQty) : null;
      return {
        stance: "AVERAGE_DOWN",
        confidence: "LOW",
        summary: `Position is down ${Math.abs(pos.unrealizedPnlPct).toFixed(1)}%, but the forecast median and MACD both lean positive. A measured add near support lowers the cost basis with a defined stop.`,
        actions: [
          {
            action: "Buy",
            price: r2(mid),
            quantity: addQty || null,
            rationale: `Add in the ${low}–${high} zone (support / ATR band).${newAvg ? ` Blended average if filled at midpoint: ${r2(newAvg)}.` : ""}`,
          },
          { action: "Set stop-loss", price: r2(Math.min(c.s2, low - 1.5 * atr)), quantity: null, rationale: "Below second support / 1.5× ATR under the zone." },
        ],
        stopLoss: r2(Math.min(c.s2, low - 1.5 * atr)),
        trailingStopPct: null,
        averageDownZone: { low, high },
        targets: targetsAbove([
          ["Resistance 1", c.r1],
          ["Breakeven", pos.avgBuyPrice],
        ]),
        reviewInDays: 7,
        risks: c.risks,
      };
    }
    if (c.fcDown && !c.macdBull) {
      const bounce = c.r1 != null ? Math.min(c.r1, last + atr) : last + atr;
      return {
        stance: "CUT_LOSS",
        confidence: "LOW",
        summary: `Position is down ${Math.abs(pos.unrealizedPnlPct).toFixed(1)}% and both the forecast median and MACD point lower. Reducing exposure limits further drawdown.`,
        actions: [
          { action: "Sell on bounce", price: r2(bounce), quantity: pos.quantity, rationale: "Exit into the nearest resistance / +1× ATR if reached." },
          { action: "Set stop-loss", price: r2(last - atr), quantity: pos.quantity, rationale: "1× ATR below the last close caps further loss." },
        ],
        stopLoss: r2(last - atr),
        trailingStopPct: null,
        averageDownZone: null,
        targets: [],
        reviewInDays: 3,
        risks: c.risks,
      };
    }
    return {
      stance: "HOLD",
      confidence: "LOW",
      summary: `Position is down ${Math.abs(pos.unrealizedPnlPct).toFixed(1)}% with mixed signals. Hold with a stop below support rather than adding capital.`,
      actions: [{ action: "Set stop-loss", price: r2(c.s1 - 0.5 * atr), quantity: pos.quantity, rationale: "Half an ATR below first support." }],
      stopLoss: r2(c.s1 - 0.5 * atr),
      trailingStopPct: null,
      averageDownZone: null,
      targets: targetsAbove([
        ["Resistance 1", c.r1],
        ["Breakeven", pos.avgBuyPrice],
      ]),
      reviewInDays: 5,
      risks: c.risks,
    };
  }

  // In profit (or flat)
  const trailPct = r2(((2 * atr) / last) * 100);
  const cushionExceeds2Atr = last - pos.avgBuyPrice > 2 * atr;
  const trailStop = r2(cushionExceeds2Atr ? Math.max(last - 2 * atr, pos.avgBuyPrice) : last - 2 * atr);

  if (c.t.rsi_state === "overbought" || (c.fcDown && !c.macdBull)) {
    const sellQty = Math.floor(pos.quantity / 3);
    return {
      stance: "TAKE_PARTIAL_PROFIT",
      confidence: "LOW",
      summary: `Position is up ${pos.unrealizedPnlPct.toFixed(1)}%. ${c.t.rsi_state === "overbought" ? "RSI is overbought" : "The forecast median and MACD are turning down"}, so locking in part of the gain is prudent.`,
      actions: [
        { action: "Sell", price: r2(c.r1 ?? last), quantity: sellQty || null, rationale: "Trim about one third at the last price / nearest resistance." },
        { action: "Trail stop", price: trailStop, quantity: null, rationale: `Trail the remainder at 2× ATR (${trailPct}%).` },
      ],
      stopLoss: trailStop,
      trailingStopPct: trailPct,
      averageDownZone: null,
      targets: targetsAbove([
        ["Resistance 1", c.r1],
        ["Forecast p90", c.f.p90_end],
      ]),
      reviewInDays: 5,
      risks: c.risks,
    };
  }

  return {
    stance: "TRAIL_STOP",
    confidence: "LOW",
    summary: `Position is up ${pos.unrealizedPnlPct.toFixed(1)}% and the trend is intact. Let it run with a 2× ATR trailing stop.`,
    actions: [{ action: "Trail stop", price: trailStop, quantity: null, rationale: `2× ATR trailing stop (${trailPct}%)${cushionExceeds2Atr ? ", floored at cost basis" : ""}.` }],
    stopLoss: trailStop,
    trailingStopPct: trailPct,
    averageDownZone: null,
    targets: targetsAbove([
      ["Resistance 1", c.r1],
      ["Resistance 2", c.r2nd],
      ["Forecast p90", c.f.p90_end],
    ]),
    reviewInDays: 7,
    risks: c.risks,
  };
}

export function ruleAnalyzerStrategy(signals: AnalyzeSignals): AnalyzerStrategy {
  const c = context(signals);
  const { last, atr, t } = c;
  const sent = signals.sentiment.score;

  const votes = [
    c.macdBull ? 1 : -1,
    c.fcUp ? 1 : c.fcDown ? -1 : 0,
    sent > 0.15 ? 1 : sent < -0.15 ? -1 : 0,
    t.rsi_state === "oversold" ? 1 : t.rsi_state === "overbought" ? -1 : 0,
  ];
  const score = votes.reduce((a, b) => a + b, 0);
  const stance: AnalyzerStrategy["stance"] = score >= 2 ? "BUY" : score === 1 ? "ACCUMULATE_ON_DIPS" : score === 0 ? "WAIT" : "AVOID";

  const buyZone =
    stance === "BUY"
      ? { low: r2(Math.max(c.s1, last - atr)), high: r2(last) }
      : { low: r2(c.s1 - 0.25 * atr), high: r2(Math.min(last, c.s1 + 0.25 * atr)) };
  if (buyZone.low > buyZone.high) [buyZone.low, buyZone.high] = [buyZone.high, buyZone.low];

  const stopLoss = r2(buyZone.low - 1.5 * atr);
  let targets = [
    { label: "Resistance 1", price: c.r1 },
    { label: "Resistance 2", price: c.r2nd },
    { label: "Forecast p90", price: c.f.p90_end },
  ]
    .filter((x): x is { label: string; price: number } => x.price != null && x.price > buyZone.high)
    .map((x) => ({ ...x, price: r2(x.price) }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 3);
  if (!targets.length) targets = [{ label: "+2× ATR", price: r2(buyZone.high + 2 * atr) }];

  return {
    stance,
    confidence: "LOW",
    summary: `Signal tally ${score > 0 ? "+" : ""}${score} across MACD, forecast, sentiment and RSI. ${
      stance === "BUY" || stance === "ACCUMULATE_ON_DIPS" ? "Entry is reasonable within the zone below." : "Wait for price to reach the zone below before considering entry."
    }`,
    buyZone,
    stopLoss,
    targets,
    holdDuration: "Up to ~3 weeks (14-trading-day forecast horizon)",
    rationale: [
      `MACD trend: ${t.macd_trend}${t.macd_crossover !== "none" ? ` (${t.macd_crossover} crossover ${t.macd_crossover_bars_ago} bars ago)` : ""}.`,
      `Forecast median ${c.f.expected_return_pct > 0 ? "+" : ""}${c.f.expected_return_pct}% over ${c.f.horizon_trading_days} trading days.`,
      `News sentiment ${signals.sentiment.label} (${sent}).`,
      `RSI(14) ${t.rsi_14 ?? "n/a"} (${t.rsi_state}). Stop is 1.5× ATR below the zone.`,
    ],
    risks: signals.sentiment.is_mock ? [...c.risks, "Sentiment is a keyword heuristic (FinBERT not loaded)."] : c.risks,
  };
}
