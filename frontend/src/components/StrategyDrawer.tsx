"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { SignalsPanel } from "@/components/SignalsPanel";
import { StrategyView } from "@/components/StrategyView";
import { Alert, Button, Signed } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtMoney, fmtPct, fmtQty } from "@/lib/format";
import type { PositionStrategy } from "@/lib/strategy-schema";
import type { PositionFacts, PositionRow, PositionSignals, StrategyMeta } from "@/lib/types";

interface StrategyResponse {
  position: PositionFacts;
  signals: PositionSignals;
  strategy: PositionStrategy;
  meta: StrategyMeta;
}

const STEPS = ["Fetching 6 months of daily data", "Computing RSI, MACD, ATR, support/resistance", "Running 14-day forecast", "Asking Gemini for a strategy"];

export function StrategyDrawer({ row, onClose }: { row: PositionRow; onClose: () => void }) {
  const [data, setData] = useState<StrategyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStep(0);
    try {
      setData(await api<StrategyResponse>(`/api/strategy/${row.id}`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [row.id]);

  useEffect(() => {
    run();
  }, [run]);

  // Progress hint only — the server does the steps in one request.
  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const currency = data?.signals.currency ?? row.currency;
  const p = data?.position;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`AI strategy for ${row.ticker}`}>
      <div className="absolute inset-0 bg-neutral-900/20" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-3xl flex-col bg-neutral-50 shadow-xl">
        <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-base font-semibold">{row.ticker}</h2>
            <p className="num text-xs text-neutral-500">
              {fmtQty(row.quantity)} @ {fmtMoney(row.avgBuyPrice, currency)}
              {p && (
                <>
                  {" · "}last {fmtMoney(p.lastPrice, currency)} ·{" "}
                  <Signed value={p.unrealizedPnl}>
                    {fmtMoney(p.unrealizedPnl, currency)} ({fmtPct(p.unrealizedPnlPct)})
                  </Signed>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={run} disabled={loading} title="Regenerate">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} title="Close (Esc)">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {loading && (
            <ol className="space-y-2 rounded-lg border border-neutral-200 bg-white p-5 text-sm">
              {STEPS.map((s, i) => (
                <li key={s} className={i < step ? "text-neutral-400" : i === step ? "font-medium text-neutral-900" : "text-neutral-300"}>
                  {i < step ? "✓" : i === step ? "…" : "·"} {s}
                </li>
              ))}
            </ol>
          )}
          {error && !loading && <Alert tone="negative">{error}</Alert>}
          {data && !loading && (
            <>
              <StrategyView kind="position" strategy={data.strategy} meta={data.meta} currency={currency} />
              <SignalsPanel signals={data.signals} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
