"use client";

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fmtNum } from "@/lib/format";
import type { Forecast, PricePoint } from "@/lib/types";

// Single-axis line chart: recent weekly closes (neutral ink) + forecast median (blue, dashed)
// with the p10–p90 band. Crosshair tooltip on hover/arrow keys; table view below.

const W = 640;
const H = 220;
const PAD_Y = 12;
const HISTORY_POINTS = 104; // ~2 years of weekly closes

const INK = "#52514e";
const SERIES = "#2a78d6";

interface Row {
  date: string;
  close?: number;
  p10?: number;
  p50?: number;
  p90?: number;
}

export function ForecastChart({ history, forecast }: { history: PricePoint[]; forecast: Forecast }) {
  const [hover, setHover] = useState<number | null>(null);

  const { rows, x, y, histPath, medianPath, bandPath, splitX, ticks } = useMemo(() => {
    const hist = history.slice(-HISTORY_POINTS);
    const last = hist[hist.length - 1];
    const rows: Row[] = [
      ...hist.map((h) => ({ date: h.date, close: h.close })),
      ...forecast.points.map((p) => ({ date: p.date, p10: p.p10, p50: p.p50, p90: p.p90 })),
    ];
    const values = rows.flatMap((r) => [r.close, r.p10, r.p90].filter((v): v is number => v != null));
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.05 || hi * 0.01;
    const yMin = lo - pad;
    const yMax = hi + pad;

    const x = (i: number) => (i / (rows.length - 1)) * W;
    const y = (v: number) => PAD_Y + (1 - (v - yMin) / (yMax - yMin)) * (H - 2 * PAD_Y);
    const line = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");

    const splitIdx = hist.length - 1;
    const fc = forecast.points.map((p, i) => ({ i: splitIdx + 1 + i, ...p }));
    const histPath = line(hist.map((h, i) => [x(i), y(h.close)]));
    const medianPath = line([[x(splitIdx), y(last.close)], ...fc.map((p): [number, number] => [x(p.i), y(p.p50)])]);
    const upper = [[x(splitIdx), y(last.close)], ...fc.map((p): [number, number] => [x(p.i), y(p.p90)])] as [number, number][];
    const lower = fc.map((p): [number, number] => [x(p.i), y(p.p10)]).reverse();
    const bandPath = `${line([...upper, ...lower])}Z`;

    const ticks = [yMax - pad, (yMin + yMax) / 2, yMin + pad].map((v) => ({ v, top: (y(v) / H) * 100 }));
    return { rows, x, y, histPath, medianPath, bandPath, splitX: x(splitIdx), ticks };
  }, [history, forecast]);

  const n = rows.length;
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (n - 1)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? n - 1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n - 1) - 1));
    else return;
    e.preventDefault();
  };

  const active = hover != null ? rows[hover] : null;
  const activePct = hover != null ? (x(hover) / W) * 100 : 0;

  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
        <LegendLine color={INK} label={`Weekly close (last ${Math.min(HISTORY_POINTS, history.length)} weeks)`} />
        <LegendLine color={SERIES} dashed label="Forecast median" />
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: SERIES, opacity: 0.18 }} />
          80% band (p10–p90)
        </span>
      </figcaption>

      <div className="relative pr-16">
        <div
          className="relative h-[220px] cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          tabIndex={0}
          role="img"
          aria-label={`Weekly price history and ${forecast.horizon_periods}-week projection. Use arrow keys to inspect values.`}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {ticks.map((t) => (
              <line key={t.v} x1={0} x2={W} y1={y(t.v)} y2={y(t.v)} stroke="#e7e5e4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={bandPath} fill={SERIES} fillOpacity={0.15} />
            <line x1={splitX} x2={splitX} y1={0} y2={H} stroke="#a8a29e" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            <path d={histPath} fill="none" stroke={INK} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            <path d={medianPath} fill="none" stroke={SERIES} strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>

          {active && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-neutral-400" style={{ left: `${activePct}%` }} />
              <div
                className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-md border border-neutral-200 bg-white px-2.5 py-2 text-xs shadow-sm"
                style={activePct > 60 ? { right: `${100 - activePct + 1}%` } : { left: `${activePct + 1}%` }}
              >
                <div className="mb-1 text-neutral-500">{active.date}</div>
                {active.close != null && <TipRow color={INK} label="Close" value={active.close} />}
                {active.p50 != null && (
                  <>
                    <TipRow color={SERIES} dashed label="Median" value={active.p50} />
                    <div className="num mt-0.5 pl-5 text-neutral-500">
                      {fmtNum(active.p10)} – {fmtNum(active.p90)}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {ticks.map((t) => (
          <span key={t.v} className="num absolute right-0 -translate-y-1/2 text-[11px] text-neutral-500" style={{ top: `${t.top}%` }}>
            {fmtNum(t.v)}
          </span>
        ))}
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800">Forecast table</summary>
        <table className="num mt-2 w-full text-right">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-1 text-left font-normal">Date</th>
              <th className="font-normal">p10</th>
              <th className="font-normal">Median</th>
              <th className="font-normal">p90</th>
            </tr>
          </thead>
          <tbody className="text-neutral-800">
            {forecast.points.map((p) => (
              <tr key={p.date} className="border-t border-neutral-100">
                <td className="py-1 text-left">{p.date}</td>
                <td>{fmtNum(p.p10)}</td>
                <td>{fmtNum(p.p50)}</td>
                <td>{fmtNum(p.p90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function LegendLine({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="16" height="4" aria-hidden>
        <line x1="0" x2="16" y1="2" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      {label}
    </span>
  );
}

function TipRow({ color, label, value, dashed }: { color: string; label: string; value: number; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg width="12" height="4" aria-hidden>
        <line x1="0" x2="12" y1="2" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "3 2" : undefined} />
      </svg>
      <span className="num font-semibold text-neutral-900">{fmtNum(value)}</span>
      <span className="text-neutral-500">{label}</span>
    </div>
  );
}
