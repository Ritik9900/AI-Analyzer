import { ChartTooltip } from "@/components/charts/Bars";
import { divergingColor, inkOn } from "@/components/charts/theme";

// Correlation matrix as a heatmap on a diverging scale centred on 0 (grey = unrelated).
// Values are printed in every cell, so the grid doubles as its own table view.

const short = (t: string) => t.replace(/\.(NS|BO)$/, "");

function describe(v: number): string {
  if (v >= 0.7) return "move together strongly";
  if (v >= 0.4) return "move together moderately";
  if (v > -0.2) return "largely independent";
  return "tend to move in opposite directions";
}

export function CorrelationHeatmap({ tickers, matrix }: { tickers: string[]; matrix: number[][] }) {
  const n = tickers.length;
  return (
    <figure>
      <div className="overflow-x-auto pb-1 sm:overflow-visible">
        <div
          role="table"
          aria-label="Correlation of daily returns between holdings"
          className="grid min-w-max gap-0.5 text-[11px]"
          style={{ gridTemplateColumns: `minmax(4.5rem,auto) repeat(${n}, minmax(2.75rem, 1fr))` }}
        >
          <span role="columnheader" />
          {tickers.map((t) => (
            <span key={t} role="columnheader" className="truncate px-0.5 pb-1 text-center font-medium text-neutral-600" title={t}>
              {short(t)}
            </span>
          ))}
          {tickers.map((row, i) => (
            <div key={row} role="row" className="contents">
              <span role="rowheader" className="truncate pr-2 text-right font-medium leading-9 text-neutral-600" title={row}>
                {short(row)}
              </span>
              {tickers.map((col, j) => {
                const v = matrix[i][j];
                if (i === j) {
                  return (
                    <span key={col} role="cell" aria-label={`${row} with itself`} className="flex h-9 items-center justify-center rounded-sm bg-neutral-100 text-neutral-400">
                      —
                    </span>
                  );
                }
                const bg = divergingColor(v);
                return (
                  <span
                    key={col}
                    role="cell"
                    tabIndex={0}
                    aria-label={`${row} and ${col}: correlation ${v.toFixed(2)}, ${describe(v)}`}
                    className="group relative flex h-9 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                    style={{ background: bg, color: inkOn(bg) }}
                  >
                    <span className="num">{v.toFixed(2)}</span>
                    <ChartTooltip style={{ bottom: "100%", left: "50%", transform: "translateX(-50%)" }} className="mb-1 text-left">
                      <div className="font-medium text-neutral-900">
                        {short(row)} × {short(col)}
                      </div>
                      <div className="num mt-0.5">
                        <span className="font-semibold text-neutral-900">{v.toFixed(2)}</span> <span className="text-neutral-500">{describe(v)}</span>
                      </div>
                    </ChartTooltip>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 flex items-center gap-2 text-[11px] text-neutral-500">
        <span>−1 opposite</span>
        <span className="h-2 w-40 rounded-sm" style={{ background: `linear-gradient(90deg, ${divergingColor(-1)}, ${divergingColor(0)}, ${divergingColor(1)})` }} />
        <span>+1 move together</span>
      </figcaption>
    </figure>
  );
}
