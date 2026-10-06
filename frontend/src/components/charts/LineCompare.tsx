"use client";

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Legend } from "@/components/charts/Bars";
import { CHART } from "@/components/charts/theme";
import { fmtDate, fmtNum, fmtPct } from "@/lib/format";

// Two series indexed to 100 at the window start, on ONE axis (never a dual axis).
// The primary series carries the accent colour; the comparison is de-emphasised grey.

const W = 720;
const H = 240;
const PAD_Y = 12;

export interface ComparePoint {
  date: string;
  a: number; // indexed primary
  b: number | null; // indexed comparison
  rawA?: string; // formatted raw value shown in the tooltip
}

export function LineCompare({ points, labels, ariaLabel }: { points: ComparePoint[]; labels: [string, string]; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;

  const geo = useMemo(() => {
    const vals = points.flatMap((p) => [p.a, p.b]).filter((v): v is number => v != null);
    const lo = Math.min(...vals, 100);
    const hi = Math.max(...vals, 100);
    const pad = (hi - lo) * 0.08 || 2;
    const yMin = lo - pad;
    const yMax = hi + pad;
    const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);
    const y = (v: number) => PAD_Y + (1 - (v - yMin) / (yMax - yMin)) * (H - 2 * PAD_Y);
    const path = (key: "a" | "b") =>
      points
        .map((p, i) => [p[key], i] as const)
        .filter(([v]) => v != null)
        .map(([v, i], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v as number).toFixed(1)}`)
        .join("");
    const step = (yMax - yMin) / 4;
    const ticks = [0, 1, 2, 3, 4].map((k) => yMin + step * k).filter((v) => Math.abs(v - 100) > step * 0.35);
    return { x, y, pathA: path("a"), pathB: path("b"), ticks };
  }, [points, n]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(Math.round(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * (n - 1)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? n - 1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n - 1) - 1));
    else if (e.key === "Home") setHover(0);
    else if (e.key === "End") setHover(n - 1);
    else return;
    e.preventDefault();
  };

  if (n < 2) return <p className="text-sm text-neutral-500">Not enough data for this period.</p>;

  const last = points[n - 1];
  const active = hover != null ? points[hover] : null;
  const activePct = hover != null ? (geo.x(hover) / W) * 100 : 0;
  const chg = (v: number | null) => (v == null ? null : v - 100);

  return (
    <figure>
      <figcaption className="mb-3">
        <Legend
          items={[
            { label: `${labels[0]} ${fmtPct(chg(last.a), 1)}`, color: CHART.series1, shape: "line" },
            { label: `${labels[1]} ${fmtPct(chg(last.b), 1)}`, color: CHART.context, shape: "line" },
          ]}
        />
      </figcaption>

      <div className="relative pr-12">
        <div
          className="relative h-[240px] cursor-crosshair rounded outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          tabIndex={0}
          role="img"
          aria-label={`${ariaLabel}. Use arrow keys to inspect values.`}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {geo.ticks.map((t) => (
              <line key={t} x1={0} x2={W} y1={geo.y(t)} y2={geo.y(t)} stroke={CHART.grid} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={0} x2={W} y1={geo.y(100)} y2={geo.y(100)} stroke={CHART.axis} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={geo.pathB} fill="none" stroke={CHART.context} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={geo.pathA} fill="none" stroke={CHART.series1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>

          {active && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-neutral-400" style={{ left: `${activePct}%` }} />
              {[active.a, active.b].map((v, i) =>
                v == null ? null : (
                  <span
                    key={i}
                    className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
                    style={{ left: `${activePct}%`, top: `${(geo.y(v) / H) * 100}%`, background: i === 0 ? CHART.series1 : CHART.context }}
                  />
                ),
              )}
              <div
                className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-xs shadow-md"
                style={activePct > 60 ? { right: `${100 - activePct + 1.5}%` } : { left: `${activePct + 1.5}%` }}
              >
                <div className="mb-1 text-neutral-500">{fmtDate(active.date)}</div>
                <TipLine color={CHART.series1} value={fmtPct(chg(active.a), 1)} label={labels[0]} extra={active.rawA} />
                {active.b != null && <TipLine color={CHART.context} value={fmtPct(chg(active.b), 1)} label={labels[1]} />}
              </div>
            </>
          )}
        </div>

        <span className="num absolute right-0 -translate-y-1/2 text-[11px] font-medium text-neutral-600" style={{ top: `${(geo.y(100) / H) * 100}%` }}>
          100
        </span>
        {geo.ticks.map((t) => (
          <span key={t} className="num absolute right-0 -translate-y-1/2 text-[11px] text-neutral-500" style={{ top: `${(geo.y(t) / H) * 100}%` }}>
            {fmtNum(t, 0)}
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between pr-12 text-[11px] text-neutral-500">
        <span>{fmtDate(points[0].date)}</span>
        <span>{fmtDate(points[Math.floor(n / 2)].date)}</span>
        <span>{fmtDate(last.date)}</span>
      </div>
    </figure>
  );
}

function TipLine({ color, value, label, extra }: { color: string; value: string; label: string; extra?: string }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="h-0.5 w-3 rounded" style={{ background: color }} />
      <span className="num font-semibold text-neutral-900">{value}</span>
      <span className="text-neutral-500">{label}</span>
      {extra && <span className="num text-neutral-500">· {extra}</span>}
    </div>
  );
}
