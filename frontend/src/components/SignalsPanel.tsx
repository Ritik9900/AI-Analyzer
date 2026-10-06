import { Check, ExternalLink, Minus, X } from "lucide-react";
import { ForecastChart } from "@/components/ForecastChart";
import { Badge, Card, Signed, Stat } from "@/components/ui";
import { fmtCompact, fmtNum, fmtPct } from "@/lib/format";
import type { AnalyzeSignals, Fundamentals, LongTerm, PositionSignals, Sentiment, Technicals } from "@/lib/types";

const levels = (xs: number[]) => (xs.length ? xs.map((x) => fmtNum(x)).join(" · ") : "—");
const trendTone = { uptrend: "positive", downtrend: "negative", sideways: "neutral", unknown: "neutral" } as const;

export function MockBadge({ what }: { what: string }) {
  return (
    <Badge tone="warning" title={`${what} is synthetic because the local model is not loaded`}>
      Mock {what.toLowerCase()}
    </Badge>
  );
}

export function SignalsPanel({ signals }: { signals: PositionSignals | AnalyzeSignals }) {
  const f = signals.forecast;
  const sentiment = "sentiment" in signals ? signals.sentiment : null;

  return (
    <div className="space-y-4">
      <LongTermCard lt={signals.long_term} />
      <FundamentalsCard f={signals.fundamentals} currency={signals.currency} />

      <Card
        title={`${f.horizon_periods}-week price projection`}
        description={`Model: ${f.model} · weekly closes · weak signal for long-term decisions`}
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
      <TimingCard t={signals.technicals} />
    </div>
  );
}

function LongTermCard({ lt }: { lt: LongTerm }) {
  return (
    <Card
      title="Long-term picture"
      description={`${lt.years_of_data} years of daily data · price returns exclude dividends`}
      actions={<Badge tone={trendTone[lt.trend]}>{lt.trend}</Badge>}
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat
          label="vs 200-day avg"
          value={<Signed value={lt.price_vs_sma200_pct}>{fmtPct(lt.price_vs_sma200_pct)}</Signed>}
          sub={`200d ${fmtNum(lt.sma_200)} · 50d ${fmtNum(lt.sma_50)}`}
        />
        <Stat label="52-week range" value={`${fmtNum(lt.low_52w)} – ${fmtNum(lt.high_52w)}`} sub={`${fmtPct(lt.pct_from_52w_high)} from high`} />
        <Stat
          label="1-year return"
          value={<Signed value={lt.return_1y_pct}>{fmtPct(lt.return_1y_pct)}</Signed>}
          sub={lt.benchmark ? `vs ${lt.benchmark} ${fmtPct(lt.benchmark_return_1y_pct)}` : undefined}
        />
        <Stat
          label="Relative to index (1y)"
          value={<Signed value={lt.relative_return_1y_pct}>{fmtPct(lt.relative_return_1y_pct)}</Signed>}
          sub={`Beta ${fmtNum(lt.beta_1y)}`}
        />
        <Stat
          label="CAGR 3y / 5y"
          value={
            <>
              <Signed value={lt.cagr_3y_pct}>{fmtPct(lt.cagr_3y_pct)}</Signed> / <Signed value={lt.cagr_5y_pct}>{fmtPct(lt.cagr_5y_pct)}</Signed>
            </>
          }
        />
        <Stat label="Momentum (12-1m)" value={<Signed value={lt.momentum_12_1_pct}>{fmtPct(lt.momentum_12_1_pct)}</Signed>} />
        <Stat label="Max drawdown" value={fmtPct(lt.max_drawdown_pct)} sub={`now ${fmtPct(lt.current_drawdown_pct)} from peak`} />
        <Stat label="Volatility (1y)" value={fmtPct(lt.volatility_1y_pct, 1, false)} sub={`Weekly RSI ${fmtNum(lt.rsi_weekly_14, 1)}`} />
        <Stat label="Weekly support" value={levels(lt.weekly_support)} />
        <Stat label="Weekly resistance" value={levels(lt.weekly_resistance)} />
      </dl>
    </Card>
  );
}

function FundamentalsCard({ f, currency }: { f: Fundamentals; currency: string | null }) {
  if (!f.available) {
    return (
      <Card title="Fundamentals">
        <p className="text-sm text-neutral-500">{f.note ?? "Not available for this symbol."}</p>
      </Card>
    );
  }
  const ratio = f.piotroski_score != null && f.piotroski_max ? f.piotroski_score / f.piotroski_max : null;
  const fTone = ratio == null ? "neutral" : ratio >= 0.6 ? "positive" : ratio <= 0.35 ? "negative" : "neutral";
  return (
    <Card
      title="Fundamentals"
      description={[f.sector, f.industry, f.fiscal_year && `FY ending ${f.fiscal_year}`].filter(Boolean).join(" · ") || undefined}
      actions={
        f.piotroski_score != null ? (
          <Badge tone={fTone}>
            F-Score {f.piotroski_score}/{f.piotroski_max}
          </Badge>
        ) : undefined
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label="Market cap" value={fmtCompact(f.market_cap, currency)} />
        <Stat label="P/E (trailing / fwd)" value={`${fmtNum(f.pe_trailing, 1)} / ${fmtNum(f.pe_forward, 1)}`} sub={`PEG ${fmtNum(f.peg)}`} />
        <Stat label="Price / book" value={fmtNum(f.price_to_book)} />
        <Stat
          label="Dividend yield"
          value={fmtPct(f.dividend_yield_pct, 2, false)}
          sub={f.payout_ratio_pct != null ? `payout ${fmtPct(f.payout_ratio_pct, 0, false)}` : undefined}
        />
        <Stat label="ROE / ROA" value={`${fmtPct(f.roe_pct, 1, false)} / ${fmtPct(f.roa_pct, 1, false)}`} />
        <Stat label="Operating / net margin" value={`${fmtPct(f.operating_margin_pct, 1, false)} / ${fmtPct(f.profit_margin_pct, 1, false)}`} />
        <Stat
          label="Revenue / earnings growth"
          value={
            <>
              <Signed value={f.revenue_growth_pct}>{fmtPct(f.revenue_growth_pct, 1)}</Signed> /{" "}
              <Signed value={f.earnings_growth_pct}>{fmtPct(f.earnings_growth_pct, 1)}</Signed>
            </>
          }
          sub="latest quarter, YoY"
        />
        <Stat label="Debt / equity" value={fmtNum(f.debt_to_equity)} sub={f.current_ratio != null ? `current ratio ${fmtNum(f.current_ratio)}` : undefined} />
        <Stat
          label="Analyst target (mean)"
          value={fmtNum(f.analyst_target_mean)}
          sub={
            f.analyst_target_mean != null ? (
              <>
                <Signed value={f.analyst_upside_pct}>{fmtPct(f.analyst_upside_pct, 1)}</Signed> · {f.analyst_rating?.replace(/_/g, " ") ?? "—"} (
                {f.analyst_count ?? 0})
              </>
            ) : undefined
          }
        />
        <Stat label="Target range" value={f.analyst_target_low != null ? `${fmtNum(f.analyst_target_low)} – ${fmtNum(f.analyst_target_high)}` : "—"} />
        <Stat label="Free cash flow" value={fmtCompact(f.free_cash_flow, currency)} />
      </dl>

      {f.piotroski_tests.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-800">
            Piotroski F-Score breakdown (latest vs prior fiscal year)
          </summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {f.piotroski_tests.map((t) => (
              <li key={t.name} className="flex items-center gap-2 text-neutral-700">
                {t.passed === true ? (
                  <Check className="h-4 w-4 text-green-700" aria-label="passed" />
                ) : t.passed === false ? (
                  <X className="h-4 w-4 text-red-700" aria-label="failed" />
                ) : (
                  <Minus className="h-4 w-4 text-neutral-400" aria-label="no data" />
                )}
                <span className={t.passed == null ? "text-neutral-400" : undefined}>{t.name}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {f.note && <p className="mt-3 text-xs text-neutral-500">{f.note}</p>}
    </Card>
  );
}

function TimingCard({ t }: { t: Technicals }) {
  return (
    <Card title="Short-term timing" description={`Daily indicators, last ~6 months · for timing tranches only · engine: ${t.indicator_engine}`}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label="RSI (14, daily)" value={fmtNum(t.rsi_14, 1)} sub={t.rsi_state} />
        <Stat
          label="MACD histogram"
          value={<Signed value={t.macd_hist}>{fmtNum(t.macd_hist, 3)}</Signed>}
          sub={t.macd_crossover !== "none" ? `${t.macd_crossover} cross ${t.macd_crossover_bars_ago}d ago` : t.macd_trend}
        />
        <Stat label="Daily support" value={levels(t.support)} />
        <Stat label="Daily resistance" value={levels(t.resistance)} />
      </dl>
    </Card>
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
