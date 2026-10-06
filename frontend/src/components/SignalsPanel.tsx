import { ExternalLink } from "lucide-react";
import { ForecastChart } from "@/components/ForecastChart";
import { Badge, Card, Signed, Stat } from "@/components/ui";
import { fmtNum, fmtPct } from "@/lib/format";
import type { AnalyzeSignals, PositionSignals, Sentiment } from "@/lib/types";

const levels = (xs: number[]) => (xs.length ? xs.map((x) => fmtNum(x)).join(" · ") : "—");

export function MockBadge({ what }: { what: string }) {
  return (
    <Badge tone="warning" title={`${what} is synthetic because the local model is not loaded`}>
      Mock {what.toLowerCase()}
    </Badge>
  );
}

export function SignalsPanel({ signals }: { signals: PositionSignals | AnalyzeSignals }) {
  const t = signals.technicals;
  const f = signals.forecast;
  const sentiment = "sentiment" in signals ? signals.sentiment : null;

  return (
    <div className="space-y-4">
      <Card title="Technicals" description={`Daily bars, ${signals.history.length} sessions · engine: ${t.indicator_engine}`}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Stat label="Last close" value={fmtNum(t.last_close)} sub={<Signed value={t.change_period_pct}>{fmtPct(t.change_period_pct)} over period</Signed>} />
          <Stat label="RSI (14)" value={fmtNum(t.rsi_14, 1)} sub={t.rsi_state} />
          <Stat
            label="MACD histogram"
            value={<Signed value={t.macd_hist}>{fmtNum(t.macd_hist, 3)}</Signed>}
            sub={t.macd_crossover !== "none" ? `${t.macd_crossover} cross ${t.macd_crossover_bars_ago}d ago` : t.macd_trend}
          />
          <Stat label="ATR (14)" value={fmtNum(t.atr_14)} sub={`Vol ${fmtPct(t.volatility_annual_pct, 1, false)} ann.`} />
          <Stat label="SMA 20 / 50" value={`${fmtNum(t.sma_20)} / ${fmtNum(t.sma_50)}`} />
          <Stat label="Period range" value={`${fmtNum(t.low_period)} – ${fmtNum(t.high_period)}`} />
          <Stat label="Support" value={levels(t.support)} />
          <Stat label="Resistance" value={levels(t.resistance)} />
        </dl>
      </Card>

      <Card
        title={`${f.horizon_trading_days}-day forecast`}
        description={`Model: ${f.model}`}
        actions={f.is_mock ? <MockBadge what="Forecast" /> : <Badge tone="info">Chronos-Bolt</Badge>}
      >
        <p className="num mb-3 text-sm text-neutral-700">
          Median at horizon <span className="font-medium text-neutral-900">{fmtNum(f.points.at(-1)?.p50)}</span>{" "}
          (<Signed value={f.expected_return_pct}>{fmtPct(f.expected_return_pct)}</Signed>) · 80% band {fmtNum(f.p10_end)} – {fmtNum(f.p90_end)}
        </p>
        <ForecastChart history={signals.history} forecast={f} />
        {f.note && <p className="mt-3 text-xs text-neutral-500">{f.note}</p>}
      </Card>

      {sentiment && <SentimentCard sentiment={sentiment} />}
    </div>
  );
}

function SentimentCard({ sentiment }: { sentiment: Sentiment }) {
  const tone = sentiment.label === "positive" ? "positive" : sentiment.label === "negative" ? "negative" : "neutral";
  return (
    <Card
      title="News sentiment"
      description={`Model: ${sentiment.model} · score from −1 (negative) to +1 (positive)`}
      actions={sentiment.is_mock ? <MockBadge what="Sentiment" /> : <Badge tone="info">FinBERT</Badge>}
    >
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="num font-medium">{sentiment.score > 0 ? "+" : ""}{sentiment.score.toFixed(2)}</span>
        <Badge tone={tone}>{sentiment.label}</Badge>
      </div>
      {sentiment.headlines.length ? (
        <ul className="divide-y divide-neutral-100 text-sm">
          {sentiment.headlines.map((h, i) => (
            <li key={i} className="flex items-start justify-between gap-4 py-2">
              <div className="min-w-0">
                {h.link ? (
                  <a href={h.link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-start gap-1 text-neutral-800 hover:underline">
                    {h.title}
                    <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-neutral-400" />
                  </a>
                ) : (
                  <span className="text-neutral-800">{h.title}</span>
                )}
                <div className="mt-0.5 text-xs text-neutral-500">
                  {[h.publisher, h.published_at?.slice(0, 10)].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Badge tone={h.label === "positive" ? "positive" : h.label === "negative" ? "negative" : "neutral"}>
                <span className="num">{h.score > 0 ? "+" : ""}{h.score.toFixed(2)}</span>
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">{sentiment.note ?? "No recent headlines."}</p>
      )}
      {sentiment.note && sentiment.headlines.length > 0 && <p className="mt-3 text-xs text-neutral-500">{sentiment.note}</p>}
    </Card>
  );
}
