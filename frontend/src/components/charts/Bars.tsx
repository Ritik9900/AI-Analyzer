import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/components/ui";
import { CHART } from "@/components/charts/theme";

// Horizontal bar charts built from plain HTML so they stay crisp and responsive.
// Hover or keyboard focus on a row reveals its tooltip; every value is also printed at the bar tip.

export function ChartTooltip({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div
      role="tooltip"
      style={style}
      className={cx(
        // display:none until hover/focus: an invisible-but-laid-out tooltip would widen the page on phones
        "pointer-events-none absolute z-20 hidden min-w-40 rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-xs text-neutral-700 shadow-md",
        "group-hover:block group-focus-visible:block",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Tooltip row: value leads (strong), label follows. */
export function TipRow({ value, label, swatch }: { value: ReactNode; label: ReactNode; swatch?: string }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      {swatch && <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: swatch }} />}
      <span className="num font-semibold text-neutral-900">{value}</span>
      <span className="text-neutral-500">{label}</span>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; shape?: "bar" | "dot" | "line" }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          {i.shape === "dot" ? (
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />
          ) : i.shape === "line" ? (
            <span className="h-0.5 w-4 rounded" style={{ background: i.color }} />
          ) : (
            <span className="h-2.5 w-3.5 rounded-sm" style={{ background: i.color }} />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

const COLS_2 = "grid-cols-[minmax(5.5rem,9rem)_1fr]";
const rowBase =
  "group relative grid items-center gap-3 rounded-md px-1.5 py-1.5 outline-none hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-300";

function RowLabel({ label, sub, flag }: { label: string; sub?: string; flag?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-sm font-medium text-neutral-900">
        <span className="truncate">{label}</span>
        {flag}
      </div>
      {sub && <div className="truncate text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

// Anchor the tooltip above the mark, flipping to the left side past the midpoint so it stays in the card.
const tipLeft = (pct: number): CSSProperties => (pct > 55 ? { right: `${100 - pct}%`, bottom: "100%" } : { left: `${pct}%`, bottom: "100%" });

// --- Single-series bars (allocation) ----------------------------------------------------

export interface BarRow {
  key: string;
  label: string;
  sub?: string;
  value: number;
  valueLabel: string;
  flag?: ReactNode;
  tooltip: ReactNode;
}

export function BarList({
  rows,
  ariaLabel,
  color = CHART.series1,
  reference,
}: {
  rows: BarRow[];
  ariaLabel: string;
  color?: string;
  reference?: { value: number; label: string };
}) {
  const max = Math.max(...rows.map((r) => r.value), reference?.value ?? 0, 1e-9);
  const refPct = reference ? (reference.value / max) * 100 : null;
  return (
    <div role="list" aria-label={ariaLabel}>
      {refPct != null && (
        <div className="grid grid-cols-[minmax(5.5rem,9rem)_1fr] gap-3 px-1.5" aria-hidden>
          <span />
          <div className="relative mr-16 h-4">
            <span className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] text-neutral-500" style={{ left: `${refPct}%` }}>
              {reference!.label}
            </span>
          </div>
        </div>
      )}
      {rows.map((r) => {
        const pct = (Math.max(0, r.value) / max) * 100;
        return (
          <div key={r.key} role="listitem" tabIndex={0} className={cx(rowBase, COLS_2)} aria-label={`${r.label}: ${r.valueLabel}`}>
            <RowLabel label={r.label} sub={r.sub} flag={r.flag} />
            <div className="relative mr-16 h-6 border-l border-neutral-300">
              {refPct != null && <div className="absolute -inset-y-2 border-l border-dashed border-neutral-400" style={{ left: `${refPct}%` }} aria-hidden />}
              <div className="absolute inset-y-1 left-0 rounded-r transition-[filter] group-hover:brightness-110" style={{ width: `${pct}%`, background: color }} />
              <span className="num absolute top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-sm bg-white/85 px-1 ml-0.5 text-xs text-neutral-700" style={{ left: `${pct}%` }}>
                {r.valueLabel}
              </span>
              <ChartTooltip style={tipLeft(pct)} className="mb-1">
                {r.tooltip}
              </ChartTooltip>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Diverging bars (P/L contribution) ---------------------------------------------------

export function DivergingBars({ rows, ariaLabel }: { rows: BarRow[]; ariaLabel: string }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  return (
    <div role="list" aria-label={ariaLabel}>
      {rows.map((r) => {
        const w = (Math.abs(r.value) / max) * 50;
        const pos = r.value >= 0;
        const anchor = pos ? 50 + w : 50 - w;
        return (
          <div key={r.key} role="listitem" tabIndex={0} className={cx(rowBase, COLS_2)} aria-label={`${r.label}: ${r.valueLabel}`}>
            <RowLabel label={r.label} sub={r.sub} flag={r.flag} />
            <div className="relative mx-16 h-6">
              <div className="absolute -inset-y-1.5 left-1/2 w-px bg-neutral-300" aria-hidden />
              <div
                className={cx("absolute inset-y-1 transition-[filter] group-hover:brightness-110", pos ? "rounded-r" : "rounded-l")}
                style={{ [pos ? "left" : "right"]: "50%", width: `${w}%`, background: pos ? CHART.series1 : CHART.negative }}
              />
              <span
                className="num absolute top-1/2 -translate-y-1/2 whitespace-nowrap px-1.5 text-xs text-neutral-700"
                style={pos ? { left: `${50 + w}%` } : { right: `${50 + w}%` }}
              >
                {r.valueLabel}
              </span>
              <ChartTooltip style={tipLeft(anchor)} className="mb-1">
                {r.tooltip}
              </ChartTooltip>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Two series per row (value share vs risk share) ------------------------------------

export interface PairedRow {
  key: string;
  label: string;
  sub?: string;
  a: number;
  b: number;
  aLabel: string;
  bLabel: string;
  tooltip: ReactNode;
}

export function PairedBars({ rows, ariaLabel, colors = [CHART.series1, CHART.series2] }: { rows: PairedRow[]; ariaLabel: string; colors?: [string, string] }) {
  const max = Math.max(...rows.flatMap((r) => [r.a, r.b]), 1e-9);
  return (
    <div role="list" aria-label={ariaLabel}>
      {rows.map((r) => {
        const pa = (Math.max(0, r.a) / max) * 100;
        const pb = (Math.max(0, r.b) / max) * 100;
        return (
          <div key={r.key} role="listitem" tabIndex={0} className={cx(rowBase, COLS_2)} aria-label={`${r.label}: ${r.aLabel}, ${r.bLabel}`}>
            <RowLabel label={r.label} sub={r.sub} />
            <div className="relative mr-14 flex h-7 flex-col justify-center gap-0.5 border-l border-neutral-300">
              {[
                [pa, colors[0], r.aLabel],
                [pb, colors[1], r.bLabel],
              ].map(([p, c, l], i) => (
                <div key={i} className="relative h-2.5">
                  <div className="absolute inset-y-0 left-0 rounded-r transition-[filter] group-hover:brightness-110" style={{ width: `${p}%`, background: c as string }} />
                  <span className="num absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1.5 text-[11px] leading-none text-neutral-700" style={{ left: `${p}%` }}>
                    {l}
                  </span>
                </div>
              ))}
              <ChartTooltip style={tipLeft(Math.max(pa, pb))} className="mb-1">
                {r.tooltip}
              </ChartTooltip>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Dumbbell (current → reference) -----------------------------------------------------

export interface DumbbellRow {
  key: string;
  label: string;
  sub?: string;
  from: number;
  to: number;
  valueLabel: string;
  tooltip: ReactNode;
}

export function Dumbbell({ rows, ariaLabel, colors = [CHART.series1, CHART.series1Light] }: { rows: DumbbellRow[]; ariaLabel: string; colors?: [string, string] }) {
  const max = Math.max(...rows.flatMap((r) => [r.from, r.to]), 1e-9);
  return (
    <div role="list" aria-label={ariaLabel}>
      {rows.map((r) => {
        const pf = (r.from / max) * 100;
        const pt = (r.to / max) * 100;
        return (
          <div key={r.key} role="listitem" tabIndex={0} className={cx(rowBase, "grid-cols-[minmax(5.5rem,9rem)_1fr_6.5rem]")} aria-label={`${r.label}: ${r.valueLabel}`}>
            <RowLabel label={r.label} sub={r.sub} />
            <div className="relative mx-1.5 h-6 border-l border-neutral-300">
              <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-neutral-300" style={{ left: `${Math.min(pf, pt)}%`, width: `${Math.abs(pt - pf)}%` }} />
              {[
                [pt, colors[1]],
                [pf, colors[0]],
              ].map(([p, c], i) => (
                <span
                  key={i}
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition-transform group-hover:scale-125"
                  style={{ left: `${p}%`, background: c as string }}
                />
              ))}
              <ChartTooltip style={tipLeft(Math.max(pf, pt))} className="mb-1">
                {r.tooltip}
              </ChartTooltip>
            </div>
            <span className="num text-right text-xs text-neutral-700">{r.valueLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
