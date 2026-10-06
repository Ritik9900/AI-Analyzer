"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { History, RefreshCw, X } from "lucide-react";
import { SignalsPanel } from "@/components/SignalsPanel";
import { StrategyView } from "@/components/StrategyView";
import { Alert, Button, Signed } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtMoney, fmtPct, fmtQty, fmtRelative, fmtSignedMoney } from "@/lib/format";
import type { PositionStrategy } from "@/lib/strategy-schema";
import type { PositionFacts, PositionRow, PositionSignals, ReportSummary, SavedReport, StrategyMeta } from "@/lib/types";

interface StrategyResponse {
  position: PositionFacts | null;
  signals: PositionSignals;
  strategy: PositionStrategy;
  meta: StrategyMeta;
}

const STEPS = [
  "Fetching 5 years of prices, index and financial statements",
  "Computing trend, risk, valuation and Piotroski F-Score",
  "Running 26-week price projection",
  "Asking Gemini for a long-term view",
];

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

export function StrategyDrawer({ row, onClose }: { row: PositionRow; onClose: () => void }) {
  const [data, setData] = useState<StrategyResponse | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null); // set when showing a saved (not fresh) view
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setLoading(true);
    setError(null);
    setStep(0);
    try {
      setData(await api<StrategyResponse>(`/api/strategy/${row.id}`, { method: "POST" }));
      setSavedAt(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }, [row.id]);

  // Show the latest saved view instantly (no Gemini call); generate only if there is none.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { reports } = await api<{ reports: ReportSummary[] }>(`/api/reports?kind=POSITION&positionId=${row.id}&limit=1`);
        if (reports[0]) {
          const saved = await api<SavedReport>(`/api/reports/${reports[0].id}`);
          if (!cancelled && saved.kind === "POSITION") {
            setData({ position: saved.position, signals: saved.signals, strategy: saved.strategy, meta: saved.meta });
            setSavedAt(saved.createdAt);
            setLoading(false);
            return;
          }
        }
      } catch {
        /* fall through to a fresh generation */
      }
      if (!cancelled) generate();
    })();
    return () => {
      cancelled = true;
    };
  }, [row.id, generate]);

  // Progress hint only — the server does the steps in one request.
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500);
    return () => clearInterval(t);
  }, [generating]);

  // Dialog behaviour: lock page scroll, move focus in, restore it on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const currency = data?.signals.currency ?? row.currency;
  const p = data?.position;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-neutral-900/25" onClick={onClose} aria-hidden />
      <aside ref={panelRef} className="relative flex h-full w-full max-w-3xl flex-col bg-neutral-50 shadow-xl">
        <header className="flex items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-4">
          <div className="min-w-0">
            <h2 id="drawer-title" className="text-base font-semibold">
              {row.ticker}
              {data?.signals.name && <span className="ml-2 text-sm font-normal text-neutral-500">{data.signals.name}</span>}
            </h2>
            <p className="num text-xs text-neutral-500">
              {fmtQty(row.quantity)} @ {fmtMoney(row.avgBuyPrice, currency)}
              {p && (
                <>
                  {" · "}last {fmtMoney(p.lastPrice, currency)} ·{" "}
                  <Signed value={p.unrealizedPnl}>
                    {fmtSignedMoney(p.unrealizedPnl, currency)} ({fmtPct(p.unrealizedPnlPct)})
                  </Signed>
                  {p.portfolioWeightPct != null && <> · {fmtPct(p.portfolioWeightPct, 1, false)} of portfolio</>}
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="secondary" size="sm" onClick={generate} disabled={loading} title="Generate a fresh view (uses one Gemini request)">
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </Button>
            <Button ref={closeRef} variant="ghost" size="sm" onClick={onClose} title="Close (Esc)" aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {loading && (
            <ol className="space-y-2 rounded-lg border border-neutral-200 bg-white p-5 text-sm" aria-live="polite">
              {generating ? (
                STEPS.map((s, i) => (
                  <li key={s} className={i < step ? "text-neutral-400" : i === step ? "font-medium text-neutral-900" : "text-neutral-300"}>
                    {i < step ? "✓" : i === step ? "…" : "·"} {s}
                  </li>
                ))
              ) : (
                <li className="text-neutral-500">Loading saved view…</li>
              )}
            </ol>
          )}
          {error && !loading && <Alert tone="negative">{error}</Alert>}
          {data && !loading && (
            <>
              {savedAt && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600">
                  <span className="flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5" aria-hidden />
                    Saved view from {fmtRelative(savedAt)} ({new Date(savedAt).toLocaleString()}). Prices and data are as of then.
                  </span>
                  <button type="button" onClick={generate} className="shrink-0 font-medium text-neutral-900 underline">
                    Regenerate
                  </button>
                </div>
              )}
              <StrategyView kind="position" strategy={data.strategy} meta={data.meta} currency={currency} />
              <SignalsPanel signals={data.signals} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
