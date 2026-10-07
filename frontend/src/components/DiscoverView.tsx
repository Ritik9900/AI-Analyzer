"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bot, Cog, ExternalLink, Plus, Search, TriangleAlert } from "lucide-react";
import { CHART } from "@/components/charts/theme";
import { Alert, Badge, Button, Card, Segmented, Skeleton, cx } from "@/components/ui";
import { api } from "@/lib/client";
import type { Shortlist, ShortlistPick } from "@/lib/discover";
import { fmtCompact, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import type { DiscoverCandidate, DiscoverOptions, DiscoverResult, StrategyMeta } from "@/lib/types";

interface Response {
  result: DiscoverResult;
  shortlist: Shortlist | null;
  meta: StrategyMeta | null;
}

const CAP_LABELS: Record<string, string[]> = {
  in: ["Any size", "₹5,000 Cr+", "₹20,000 Cr+", "₹1 lakh Cr+"],
  us: ["Any size", "$2B+", "$10B+", "$200B+"],
};
const STEPS = [
  "Finding the largest stocks in this sector",
  "Scoring quality, valuation, trend and risk against sector peers",
  "Checking Piotroski F-Score and news for the top 8",
  "Projecting prices and comparing the top 3",
];
const verdictTone = { BUY: "positive", ACCUMULATE_GRADUALLY: "info", WATCHLIST: "neutral" } as const;
const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function DiscoverView() {
  const [opts, setOpts] = useState<DiscoverOptions | null>(null);
  const [country, setCountry] = useState<"in" | "us">("in");
  const [exchanges, setExchanges] = useState<string[]>([]);
  const [sector, setSector] = useState("Technology");
  const [capIdx, setCapIdx] = useState(0);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DiscoverOptions>("/api/discover")
      .then(setOpts)
      .catch((e: Error) => setError(e.message));
  }, []);

  const market = opts?.markets.find((m) => m.code === country);
  useEffect(() => {
    if (market) setExchanges(market.exchanges);
    setCapIdx(0);
  }, [market]);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 6000);
    return () => clearInterval(t);
  }, [loading]);

  const run = async () => {
    if (!market) return;
    setLoading(true);
    setStep(0);
    setError(null);
    try {
      const minCap = market.cap_presets[capIdx] || null;
      setData(await api<Response>("/api/discover", { method: "POST", body: JSON.stringify({ country, exchanges, sector, min_market_cap: minCap }) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggleExchange = (ex: string) => setExchanges((cur) => (cur.includes(ex) ? cur.filter((e) => e !== ex) : [...cur, ex]));

  return (
    <div className="space-y-6">
      <Card title="What are you looking for?" description="Pick a market and a sector. The screen ranks the largest stocks in it for long-term investing.">
        {!opts ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <Field label="Country">
                <Segmented ariaLabel="Country" options={opts.markets.map((m) => ({ value: m.code, label: m.label }))} value={country} onChange={(v) => setCountry(v as "in" | "us")} />
              </Field>
              <Field label="Exchanges">
                <div className="flex h-9 items-center gap-4">
                  {market?.exchanges.map((ex) => (
                    <label key={ex} className="flex items-center gap-1.5 text-sm text-neutral-800">
                      <input type="checkbox" checked={exchanges.includes(ex)} onChange={() => toggleExchange(ex)} className="h-4 w-4 accent-neutral-900" />
                      {ex}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Sector">
                <select
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                >
                  {opts.sectors.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Company size">
                <select
                  value={capIdx}
                  onChange={(e) => setCapIdx(Number(e.target.value))}
                  className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
                >
                  {CAP_LABELS[country].map((l, i) => (
                    <option key={l} value={i}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={run} loading={loading} disabled={!exchanges.length}>
                {!loading && <Search className="h-4 w-4" />} Find the best ideas
              </Button>
              <span className="text-xs text-neutral-500">Takes about 15–60 seconds. Results are cached for 30 minutes.</span>
            </div>
          </div>
        )}
      </Card>

      {error && <Alert tone="negative">{error}</Alert>}

      {loading && (
        <Card>
          <ol className="space-y-2 text-sm" aria-live="polite">
            {STEPS.map((s, i) => (
              <li key={s} className={i < step ? "text-neutral-400" : i === step ? "font-medium text-neutral-900" : "text-neutral-300"}>
                {i < step ? "✓" : i === step ? "…" : "·"} {s}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {data && !loading && <Results data={data} />}

      <p className="text-xs text-neutral-500">
        A shortlist for further research, not a recommendation to buy. Scores compare stocks only with their sector peers, using delayed
        third-party data that can be incomplete. Always do your own research or consult a registered adviser.
      </p>
    </div>
  );
}

function Results({ data }: { data: Response }) {
  const { result, shortlist, meta } = data;
  const byTicker = useMemo(() => new Map(result.candidates.map((c) => [c.ticker, c])), [result]);
  const ccy = result.currency;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {result.sector} · {result.country === "in" ? "India" : "US"} ({result.exchanges.join(", ")})
        </h2>
        <span className="text-xs text-neutral-500">
          Scored {result.screened} of {result.total_in_sector ?? "?"} stocks in the sector · {result.elapsed_s}s
        </span>
      </div>
      {result.notes.map((n) => (
        <Alert key={n} tone="info">
          {n}
        </Alert>
      ))}

      {shortlist && (
        <Card
          title="Shortlist"
          description={shortlist.summary}
          actions={
            meta?.source === "gemini" ? (
              <Badge tone="info">
                <Bot className="h-3.5 w-3.5" /> {meta.model}
              </Badge>
            ) : (
              <Badge>
                <Cog className="h-3.5 w-3.5" /> Rule-based
              </Badge>
            )
          }
        >
          {meta?.source === "rule-based" && meta.fallbackReason && (
            <div className="mb-4">
              <Alert tone="warning">{meta.fallbackReason} Showing the rule-based shortlist.</Alert>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {shortlist.picks.map((p) => (
              <PickCard key={p.ticker} pick={p} c={byTicker.get(p.ticker)} currency={ccy} medians={result.sector_medians} />
            ))}
          </div>
          {shortlist.caveats.length > 0 && (
            <ul className="mt-4 list-disc space-y-0.5 pl-5 text-xs text-neutral-500">
              {shortlist.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title="All scored stocks" description="Percentile scores within this sector screen (100 = best of the group). Click a row for the full analysis.">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500">
              <tr className="border-b border-neutral-200">
                {["#", "Stock", "Score", "Quality", "Value", "Trend", "Risk", "P/E", "ROE", "1y", "vs 200d", "Mkt cap"].map((h, i) => (
                  <th key={h} className={cx("whitespace-nowrap px-3 py-2 font-medium first:pl-5 last:pr-5", i < 2 ? "text-left" : "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num whitespace-nowrap">
              {result.candidates.map((c) => (
                <tr
                  key={c.ticker}
                  className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                  onClick={() => (window.location.href = `/analyze?ticker=${encodeURIComponent(c.ticker)}`)}
                >
                  <td className="px-3 py-2 pl-5 text-neutral-500">{c.rank}</td>
                  <td className="max-w-56 px-3 py-2">
                    <div className="font-medium text-neutral-900">{c.ticker}</div>
                    <div className="truncate text-xs text-neutral-500" title={c.name ?? ""}>
                      {c.name}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ScoreBar value={c.score} />
                  </td>
                  {(["quality", "valuation", "trend", "risk"] as const).map((k) => (
                    <td key={k} className="px-3 py-2 text-right text-neutral-700">
                      {c.factors[k] == null ? "—" : c.factors[k]!.toFixed(0)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">{fmtNum(c.pe_trailing, 1)}</td>
                  <td className="px-3 py-2 text-right">{c.roe_pct == null ? "—" : `${c.roe_pct.toFixed(0)}%`}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(c.return_1y_pct, 0)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(c.pct_vs_sma200, 0)}</td>
                  <td className="px-3 py-2 pr-5 text-right">{fmtCompact(c.market_cap, ccy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-4 text-xs text-neutral-600">
          <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800">How the score works</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Quality 35%: return on equity, operating margin, revenue growth, debt (debt is skipped for banks and insurers).</li>
            <li>Valuation 25%: P/E and price-to-book (lower is better; loss-makers rank last), analyst target upside.</li>
            <li>Trend 25%: distance from the 200-day average, 12-1 month momentum, 1-year return vs {result.benchmark}.</li>
            <li>Risk 15%: 1-year volatility and maximum drawdown (lower is better).</li>
            <li>Each input is a percentile within this screen. Stocks with missing data are pulled toward the middle.</li>
            <li>The top 8 are then adjusted for Piotroski F-Score (up to ±5) and news sentiment (up to ±2).</li>
          </ul>
        </details>
      </Card>
    </>
  );
}

function PickCard({ pick, c, currency, medians }: { pick: ShortlistPick; c?: DiscoverCandidate; currency: string; medians: Record<string, number | null> }) {
  return (
    <article className="flex flex-col rounded-lg border border-neutral-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-neutral-500">#{pick.rank}</div>
          <div className="text-base font-semibold text-neutral-900">{pick.ticker}</div>
          {c?.name && <div className="text-xs text-neutral-500">{c.name}</div>}
        </div>
        <Badge tone={verdictTone[pick.verdict]}>{label(pick.verdict)}</Badge>
      </div>

      {c && (
        <>
          <div className="mt-3 flex items-center gap-2 text-xs text-neutral-600">
            <ScoreBar value={c.score} wide /> <span>score</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <Metric label="Price" value={fmtMoney(c.price, currency)} />
            <Metric label="P/E (sector)" value={`${fmtNum(c.pe_trailing, 1)} (${fmtNum(medians.pe_trailing, 1)})`} />
            <Metric label="ROE (sector)" value={`${c.roe_pct == null ? "—" : `${c.roe_pct.toFixed(0)}%`} (${medians.roe_pct == null ? "—" : `${medians.roe_pct.toFixed(0)}%`})`} />
            <Metric label="F-Score" value={c.piotroski_score != null ? `${c.piotroski_score}/${c.piotroski_max}` : "—"} />
            <Metric label="vs 200-day" value={fmtPct(c.pct_vs_sma200, 1)} />
            <Metric label="1y return" value={fmtPct(c.return_1y_pct, 1)} />
          </dl>
        </>
      )}

      <p className="mt-3 text-sm leading-relaxed text-neutral-800">{pick.thesis}</p>
      <p className="mt-2 text-xs text-neutral-600">{pick.whyThisRank}</p>

      <div className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-xs">
        <span className="text-neutral-500">Buy zone </span>
        <span className="num font-medium text-neutral-900">
          {fmtMoney(pick.buyZone.low, currency)} – {fmtMoney(pick.buyZone.high, currency)}
        </span>
      </div>
      <p className="mt-2 flex gap-1.5 text-xs text-neutral-600">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="Invalidation" />
        {pick.invalidation}
      </p>
      {pick.keyRisks.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-neutral-600">
          {pick.keyRisks.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Link href={`/analyze?ticker=${encodeURIComponent(pick.ticker)}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-medium hover:bg-neutral-50">
          <ExternalLink className="h-3.5 w-3.5" /> Full analysis
        </Link>
        <Link href={`/?add=${encodeURIComponent(pick.ticker)}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-medium hover:bg-neutral-50">
          <Plus className="h-3.5 w-3.5" /> Add to portfolio
        </Link>
      </div>
    </article>
  );
}

function ScoreBar({ value, wide }: { value: number; wide?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" title={`Score ${value.toFixed(0)} / 100`}>
      <span className={cx("relative h-2 rounded-full bg-neutral-100", wide ? "w-28" : "w-14")}>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: CHART.series1 }} />
      </span>
      <span className="num w-7 text-right font-medium text-neutral-900">{value.toFixed(0)}</span>
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="num text-neutral-900">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </div>
  );
}
