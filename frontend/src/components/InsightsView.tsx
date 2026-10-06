"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, CircleCheck, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { BarList, DivergingBars, Dumbbell, Legend, PairedBars, TipRow } from "@/components/charts/Bars";
import { CorrelationHeatmap } from "@/components/charts/Heatmap";
import { LineCompare } from "@/components/charts/LineCompare";
import { CHART } from "@/components/charts/theme";
import { Alert, Button, Card, Segmented, Signed, Skeleton, StatTile, cx } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtSignedMoney } from "@/lib/format";
import { concentrationLimit } from "@/lib/insights";
import type { InsightHolding, InsightsResponse, Observation } from "@/lib/types";

type WindowKey = "3m" | "6m" | "1y";
const WINDOW_OPTIONS: { value: WindowKey; label: string }[] = [
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "1y", label: "1Y" },
];

export function InsightsView() {
  const [windowKey, setWindowKey] = useState<WindowKey>("1y");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (w: WindowKey) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<InsightsResponse>(`/api/insights?window=${w}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(windowKey);
  }, [load, windowKey]);

  if (!data && loading) return <InsightsSkeleton />;
  if (!data) return <Alert tone="negative">{error ?? "Could not load insights."}</Alert>;
  if (!data.holdings.length) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-neutral-500">
          No holdings to analyse yet.{" "}
          <Link href="/" className="font-medium text-neutral-900 underline">
            Add positions on the Portfolio page
          </Link>
          .
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* One filter row scoping every period-based chart below */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Segmented ariaLabel="Analysis period" options={WINDOW_OPTIONS} value={windowKey} onChange={setWindowKey} />
          <span className="text-xs text-neutral-500">
            Period-based charts cover {data.window.startDate ? `${fmtDate(data.window.startDate)} – today` : `the last ${data.window.label}`}
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => load(windowKey)} loading={loading}>
          {!loading && <RefreshCw className="h-3.5 w-3.5" />} Refresh
        </Button>
      </div>

      {error && <Alert tone="negative">{error}</Alert>}
      {data.pricesError && <Alert tone="warning">Live prices unavailable: {data.pricesError}</Alert>}
      {data.analyticsError && <Alert tone="warning">Risk and performance analytics unavailable: {data.analyticsError}</Alert>}
      {data.excluded.length > 0 && (
        <Alert tone="info">
          Not included: {data.excluded.map((e) => `${e.ticker} (${e.reason})`).join("; ")}.
        </Alert>
      )}

      {/* Hold the previous render at reduced opacity while a new period loads — no layout jump */}
      <div className={cx("space-y-6 transition-opacity", loading && "pointer-events-none opacity-60")} aria-busy={loading}>
        <Kpis data={data} />
        <Observations items={data.observations} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <AllocationCard data={data} />
          <PnlCard data={data} />
        </div>

        <PerformanceCard data={data} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RiskCard data={data} />
          <CorrelationCard data={data} />
        </div>

        <RebalanceCard data={data} />
        <HoldingsTable data={data} />

        <p className="text-xs text-neutral-500">
          Period figures use daily closing prices and assume today&apos;s quantities were held for the whole period. Returns are price returns and exclude
          dividends. For information only; not financial advice.
        </p>
      </div>
    </div>
  );
}

// --- KPI row ------------------------------------------------------------------------------

function Kpis({ data }: { data: InsightsResponse }) {
  const k = data.kpis;
  const c = data.currency;
  const bench = data.benchmark?.label ?? "index";
  return (
    <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label="Market value" value={fmtMoney(k.marketValue, c, 0)} sub={`${k.holdings} holdings · invested ${fmtMoney(k.invested, c, 0)}`} />
      <StatTile
        label="Unrealised P/L"
        value={<Signed value={k.pnl}>{fmtSignedMoney(k.pnl, c, 0)}</Signed>}
        sub={<Signed value={k.pnlPct}>{fmtPct(k.pnlPct)} on cost</Signed>}
      />
      <StatTile
        label="Today"
        value={<Signed value={k.dayChange}>{fmtSignedMoney(k.dayChange, c, 0)}</Signed>}
        sub={<Signed value={k.dayChangePct}>{fmtPct(k.dayChangePct)}</Signed>}
      />
      <StatTile
        label={`Return, ${data.window.label}`}
        value={<Signed value={k.returnPct}>{fmtPct(k.returnPct, 1)}</Signed>}
        sub={`${bench} ${fmtPct(k.benchmarkReturnPct, 1)}`}
        hint="Current holdings held over the whole period (price return)"
      />
      <StatTile
        label={`Volatility, ${data.window.label}`}
        value={fmtPct(k.volatilityPct, 1, false)}
        sub={`Beta ${fmtNum(k.beta)} vs ${bench}`}
        hint="Annualised standard deviation of daily returns; beta < 1 means the portfolio moved less than the index"
      />
      <StatTile label={`Max drawdown, ${data.window.label}`} value={fmtPct(k.maxDrawdownPct, 1)} sub="Worst peak-to-trough fall" />
      <StatTile
        label="Diversification"
        value={k.effectiveHoldings != null ? `${fmtNum(k.effectiveHoldings, 1)} effective` : "—"}
        sub={k.avgCorrelation != null ? `Avg correlation ${fmtNum(k.avgCorrelation)}` : undefined}
        hint="Effective number of holdings = 1 / sum of squared weights"
      />
      <StatTile
        label="Est. dividends / year"
        value={fmtMoney(k.estDividendIncome, c, 0)}
        sub={k.dividendYieldPct != null ? `${fmtPct(k.dividendYieldPct, 2, false)} yield on value` : undefined}
        hint="Trailing dividend yields × current value; an estimate, not guaranteed"
      />
    </section>
  );
}

// --- Observations -------------------------------------------------------------------------

const obsStyle = {
  warning: { icon: TriangleAlert, className: "text-amber-600", label: "Attention" },
  info: { icon: Info, className: "text-blue-700", label: "Note" },
  positive: { icon: CircleCheck, className: "text-green-700", label: "Good" },
} as const;

function Observations({ items }: { items: Observation[] }) {
  if (!items.length) return null;
  return (
    <Card title="Key observations" description="Generated from your holdings with fixed rules (no AI)">
      <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2">
        {items.map((o, i) => {
          const s = obsStyle[o.tone];
          const Icon = s.icon;
          return (
            <li key={i} className="flex gap-2.5">
              <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", s.className)} strokeWidth={2} aria-label={s.label} />
              <div>
                <p className="text-sm font-medium text-neutral-900">{o.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">{o.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// --- Allocation ---------------------------------------------------------------------------

function AllocationCard({ data }: { data: InsightsResponse }) {
  const WEIGHT_GUIDELINE = Math.round(concentrationLimit(data.holdings.length));
  const [by, setBy] = useState<"stock" | "sector">("stock");
  const [metric, setMetric] = useState<"value" | "invested">("value");
  const c = data.currency;

  const rows =
    by === "stock"
      ? data.holdings.map((h) => {
          const pct = metric === "value" ? (h.weightPct ?? 0) : h.investedWeightPct;
          const over = metric === "value" && pct > WEIGHT_GUIDELINE;
          return {
            key: h.ticker,
            label: h.ticker,
            sub: h.sector,
            value: pct,
            valueLabel: fmtPct(pct, 1, false),
            flag: over ? <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label={`Above ${WEIGHT_GUIDELINE}% ceiling`} /> : undefined,
            tooltip: (
              <>
                <div className="mb-1 font-medium text-neutral-900">{h.name ?? h.ticker}</div>
                <TipRow value={fmtPct(h.weightPct, 1, false)} label="of current value" />
                <TipRow value={fmtPct(h.investedWeightPct, 1, false)} label="of amount invested" />
                <TipRow value={fmtMoney(h.value, c, 0)} label="value" />
                <TipRow value={fmtMoney(h.invested, c, 0)} label="invested" />
                {over && <div className="mt-1 text-amber-700">Above the ~{WEIGHT_GUIDELINE}% single-stock ceiling for a portfolio of this size</div>}
              </>
            ),
          };
        })
      : [...data.sectors]
          .sort((a, b) => (metric === "value" ? b.valuePct - a.valuePct : b.investedPct - a.investedPct))
          .map((s) => {
            const pct = metric === "value" ? s.valuePct : s.investedPct;
            return {
              key: s.sector,
              label: s.sector,
              sub: s.tickers.join(", "),
              value: pct,
              valueLabel: fmtPct(pct, 1, false),
              tooltip: (
                <>
                  <div className="mb-1 font-medium text-neutral-900">{s.sector}</div>
                  <TipRow value={fmtPct(s.valuePct, 1, false)} label={`of value · ${fmtMoney(s.value, c, 0)}`} />
                  <TipRow value={fmtPct(s.investedPct, 1, false)} label={`of invested · ${fmtMoney(s.invested, c, 0)}`} />
                  <div className="mt-1 text-neutral-500">{s.tickers.join(", ")}</div>
                </>
              ),
            };
          });

  return (
    <Card
      title="Allocation"
      description={metric === "value" ? "Share of current market value" : "Share of the amount you invested (cost)"}
      actions={
        <div className="flex flex-wrap justify-end gap-2">
          <Segmented size="sm" ariaLabel="Group by" options={[{ value: "stock", label: "Stocks" }, { value: "sector", label: "Sectors" }]} value={by} onChange={setBy} />
          <Segmented size="sm" ariaLabel="Measure" options={[{ value: "value", label: "Value" }, { value: "invested", label: "Invested" }]} value={metric} onChange={setMetric} />
        </div>
      }
    >
      <BarList
        rows={rows}
        ariaLabel={`Allocation by ${by}`}
        reference={by === "stock" && metric === "value" ? { value: WEIGHT_GUIDELINE, label: `${WEIGHT_GUIDELINE}% ceiling` } : undefined}
      />
    </Card>
  );
}

// --- P/L contribution ---------------------------------------------------------------------

function PnlCard({ data }: { data: InsightsResponse }) {
  const c = data.currency;
  const rows = data.holdings
    .filter((h) => h.pnl != null)
    .sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0))
    .map((h) => ({
      key: h.ticker,
      label: h.ticker,
      sub: fmtPct(h.pnlPct, 1),
      value: h.pnl ?? 0,
      valueLabel: fmtSignedMoney(h.pnl, c, 0),
      tooltip: (
        <>
          <div className="mb-1 font-medium text-neutral-900">{h.name ?? h.ticker}</div>
          <TipRow value={fmtSignedMoney(h.pnl, c, 0)} label={`unrealised (${fmtPct(h.pnlPct, 1)})`} />
          <TipRow value={fmtMoney(h.avgBuyPrice, c)} label="avg cost" />
          <TipRow value={fmtMoney(h.price, c)} label="last price" />
        </>
      ),
    }));
  return (
    <Card title="Profit / loss by holding" description={`Unrealised P/L in ${c ?? "currency"} · total ${fmtSignedMoney(data.kpis.pnl, c, 0)}`}>
      <div className="mb-2">
        <Legend
          items={[
            { label: "Gain", color: CHART.series1 },
            { label: "Loss", color: CHART.negative },
          ]}
        />
      </div>
      <DivergingBars rows={rows} ariaLabel="Unrealised profit or loss by holding" />
    </Card>
  );
}

// --- Performance vs benchmark ---------------------------------------------------------------

function PerformanceCard({ data }: { data: InsightsResponse }) {
  const c = data.currency;
  const bench = data.benchmark?.label ?? "Index";
  const points = useMemo(() => {
    const s = data.series;
    if (!s.length) return [];
    const a0 = s[0].portfolio;
    const b0 = s[0].benchmark;
    return s.map((p) => ({
      date: p.date,
      a: (p.portfolio / a0) * 100,
      b: b0 && p.benchmark != null ? (p.benchmark / b0) * 100 : null,
      rawA: fmtMoney(p.portfolio, c, 0),
    }));
  }, [data.series, c]);

  const monthly = useMemo(() => {
    const seen = new Set<string>();
    return [...points].reverse().filter((p) => (seen.has(p.date.slice(0, 7)) ? false : (seen.add(p.date.slice(0, 7)), true))).reverse();
  }, [points]);

  return (
    <Card title={`Your portfolio vs ${bench}`} description={`Indexed to 100 at the start of the ${data.window.label} period · today's holdings, daily closes`}>
      {points.length ? (
        <>
          <LineCompare points={points} labels={["Your portfolio", bench]} ariaLabel={`Your portfolio versus ${bench}, indexed to 100`} />
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800">Table view (month-end)</summary>
            <table className="num mt-2 w-full text-right">
              <thead className="text-neutral-500">
                <tr>
                  <th className="py-1 text-left font-normal">Date</th>
                  <th className="font-normal">Portfolio value</th>
                  <th className="font-normal">Portfolio</th>
                  <th className="font-normal">{bench}</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((p) => (
                  <tr key={p.date} className="border-t border-neutral-100">
                    <td className="py-1 text-left">{fmtDate(p.date)}</td>
                    <td>{p.rawA}</td>
                    <td>{fmtPct(p.a - 100, 1)}</td>
                    <td>{p.b == null ? "—" : fmtPct(p.b - 100, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : (
        <p className="text-sm text-neutral-500">Performance history unavailable.</p>
      )}
    </Card>
  );
}

// --- Risk -------------------------------------------------------------------------------------

function RiskCard({ data }: { data: InsightsResponse }) {
  const rows = data.holdings
    .filter((h) => h.riskContributionPct != null && h.weightPct != null)
    .sort((a, b) => (b.riskContributionPct ?? 0) - (a.riskContributionPct ?? 0))
    .map((h) => ({
      key: h.ticker,
      label: h.ticker,
      sub: `vol ${fmtPct(h.volatilityPct, 0, false)}`,
      a: h.weightPct ?? 0,
      b: Math.max(0, h.riskContributionPct ?? 0),
      aLabel: fmtPct(h.weightPct, 1, false),
      bLabel: fmtPct(h.riskContributionPct, 1, false),
      tooltip: (
        <>
          <div className="mb-1 font-medium text-neutral-900">{h.name ?? h.ticker}</div>
          <TipRow swatch={CHART.series1} value={fmtPct(h.weightPct, 1, false)} label="of value" />
          <TipRow swatch={CHART.series2} value={fmtPct(h.riskContributionPct, 1, false)} label="of portfolio risk" />
          <TipRow value={fmtPct(h.volatilityPct, 1, false)} label={`volatility (${data.window.label})`} />
          <TipRow value={fmtNum(h.beta)} label="beta" />
        </>
      ),
    }));
  return (
    <Card title="Where your risk comes from" description={`Share of value vs share of portfolio volatility, ${data.window.label}`}>
      {rows.length ? (
        <>
          <div className="mb-2">
            <Legend
              items={[
                { label: "Share of value", color: CHART.series1 },
                { label: "Share of risk", color: CHART.series2 },
              ]}
            />
          </div>
          <PairedBars rows={rows} ariaLabel="Share of value and share of risk per holding" />
          <p className="mt-3 text-xs text-neutral-500">
            A holding whose orange bar is longer than its blue bar adds more volatility than its size suggests (high volatility or high correlation with the rest).
          </p>
        </>
      ) : (
        <p className="text-sm text-neutral-500">Risk analytics unavailable.</p>
      )}
    </Card>
  );
}

function CorrelationCard({ data }: { data: InsightsResponse }) {
  return (
    <Card title="How your holdings move together" description={`Correlation of daily returns, ${data.window.label}`}>
      {data.correlation ? (
        <>
          <CorrelationHeatmap tickers={data.correlation.tickers} matrix={data.correlation.matrix} />
          <p className="mt-3 text-xs text-neutral-500">
            Red cells (near +1) move together and add little diversification; grey cells are unrelated, which is what spreads risk.
          </p>
        </>
      ) : (
        <p className="text-sm text-neutral-500">Needs at least two holdings with price history.</p>
      )}
    </Card>
  );
}

function RebalanceCard({ data }: { data: InsightsResponse }) {
  const rows = data.holdings
    .filter((h) => h.hrpWeightPct != null && h.weightPct != null)
    .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))
    .map((h) => ({
      key: h.ticker,
      label: h.ticker,
      sub: h.sector,
      from: h.weightPct ?? 0,
      to: h.hrpWeightPct ?? 0,
      valueLabel: `${fmtNum(h.weightPct, 1)} → ${fmtNum(h.hrpWeightPct, 1)}%`,
      tooltip: (
        <>
          <div className="mb-1 font-medium text-neutral-900">{h.name ?? h.ticker}</div>
          <TipRow swatch={CHART.series1} value={fmtPct(h.weightPct, 1, false)} label="current weight" />
          <TipRow swatch={CHART.series1Light} value={fmtPct(h.hrpWeightPct, 1, false)} label="risk-balanced reference" />
          <TipRow value={fmtPct((h.hrpWeightPct ?? 0) - (h.weightPct ?? 0), 1)} label="difference" />
        </>
      ),
    }));
  if (rows.length < 2) return null;
  return (
    <Card
      title="Risk-balanced reference weights"
      description={`Hierarchical Risk Parity on ${data.window.label} returns: a reference point for rebalancing, not a recommendation`}
    >
      <div className="mb-2">
        <Legend
          items={[
            { label: "Current weight", color: CHART.series1, shape: "dot" },
            { label: "Risk-balanced (HRP)", color: CHART.series1Light, shape: "dot" },
          ]}
        />
      </div>
      <Dumbbell rows={rows} ariaLabel="Current weight versus risk-balanced reference weight" />
      <p className="mt-3 text-xs text-neutral-500">
        HRP gives less weight to volatile holdings and to groups that move together, so each part of the portfolio carries a similar share of risk. It
        ignores valuation and business quality, so use it alongside the AI Strategy view rather than instead of it.
      </p>
    </Card>
  );
}

// --- Holdings table (sortable; also the table view for the charts above) -----------------------

type SortKey = keyof Pick<
  InsightHolding,
  "ticker" | "sector" | "weightPct" | "value" | "pnl" | "pnlPct" | "returnPct" | "volatilityPct" | "beta" | "pctVsSma200" | "dividendYieldPct" | "riskContributionPct"
>;

const COLUMNS: { key: SortKey; label: string; align?: "left" }[] = [
  { key: "ticker", label: "Ticker", align: "left" },
  { key: "sector", label: "Sector", align: "left" },
  { key: "weightPct", label: "Weight" },
  { key: "value", label: "Value" },
  { key: "pnl", label: "P/L" },
  { key: "pnlPct", label: "P/L %" },
  { key: "returnPct", label: "Return" },
  { key: "volatilityPct", label: "Volatility" },
  { key: "beta", label: "Beta" },
  { key: "pctVsSma200", label: "vs 200-day" },
  { key: "dividendYieldPct", label: "Div. yield" },
  { key: "riskContributionPct", label: "Risk share" },
];

function HoldingsTable({ data }: { data: InsightsResponse }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "weightPct", dir: -1 });
  const c = data.currency;
  const rows = useMemo(
    () =>
      [...data.holdings].sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir;
      }),
    [data.holdings, sort],
  );
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "ticker" || key === "sector" ? 1 : -1 }));

  return (
    <Card title="Holdings detail" description={`Return, volatility, beta and risk share over ${data.window.label}; click a column to sort`}>
      <div className="relative -mx-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500">
            <tr className="border-b border-neutral-200">
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                const Icon = active ? (sort.dir === 1 ? ArrowUp : ArrowDown) : ChevronsUpDown;
                return (
                  <th
                    key={col.key}
                    aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                    className={cx("whitespace-nowrap px-3 py-2 font-medium first:pl-5 last:pr-5", col.align === "left" ? "text-left" : "text-right")}
                  >
                    <button type="button" onClick={() => toggle(col.key)} className={cx("inline-flex items-center gap-1 hover:text-neutral-900", active && "text-neutral-900")}>
                      {col.label}
                      <Icon className="h-3 w-3" />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="num whitespace-nowrap">
            {rows.map((h) => (
              <tr key={h.ticker} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                <td className="px-3 py-2 pl-5 text-left font-medium">{h.ticker}</td>
                <td className="max-w-40 truncate px-3 py-2 text-left text-neutral-600" title={h.sector}>
                  {h.sector}
                </td>
                <td className="px-3 py-2 text-right">{fmtPct(h.weightPct, 1, false)}</td>
                <td className="px-3 py-2 text-right">{fmtMoney(h.value, c, 0)}</td>
                <td className="px-3 py-2 text-right">
                  <Signed value={h.pnl}>{fmtSignedMoney(h.pnl, c, 0)}</Signed>
                </td>
                <td className="px-3 py-2 text-right">
                  <Signed value={h.pnlPct}>{fmtPct(h.pnlPct, 1)}</Signed>
                </td>
                <td className="px-3 py-2 text-right">
                  <Signed value={h.returnPct}>{fmtPct(h.returnPct, 1)}</Signed>
                </td>
                <td className="px-3 py-2 text-right">{fmtPct(h.volatilityPct, 1, false)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(h.beta)}</td>
                <td className="px-3 py-2 text-right">
                  <Signed value={h.pctVsSma200}>{fmtPct(h.pctVsSma200, 1)}</Signed>
                </td>
                <td className="px-3 py-2 text-right">{fmtPct(h.dividendYieldPct, 2, false)}</td>
                <td className="px-3 py-2 pr-5 text-right">{fmtPct(h.riskContributionPct, 1, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function InsightsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading insights">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-40" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
