"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { History, Lock, Search } from "lucide-react";
import { SignalsPanel } from "@/components/SignalsPanel";
import { StrategyView } from "@/components/StrategyView";
import { ErrorWithSuggestions, TickerSearch } from "@/components/TickerSearch";
import { Alert, Button, cx } from "@/components/ui";
import { api, toUiError, useAiStatus, type UiError } from "@/lib/client";
import { fmtMoney, fmtRelative } from "@/lib/format";
import type { AnalyzerStrategy } from "@/lib/strategy-schema";
import type { AnalyzeSignals, ReportSummary, SavedReport, StrategyMeta } from "@/lib/types";

interface AnalyzeResponse {
  signals: AnalyzeSignals;
  strategy: AnalyzerStrategy;
  meta: StrategyMeta;
}

const stanceLabel = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function AnalyzeView() {
  const ai = useAiStatus();
  const [ticker, setTicker] = useState("");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<ReportSummary[]>([]);

  const loadRecent = useCallback(async () => {
    try {
      setRecent((await api<{ reports: ReportSummary[] }>("/api/reports?kind=ANALYZER&limit=8&distinct=ticker")).reports);
    } catch {
      /* recent list is optional */
    }
  }, []);

  useEffect(() => {
    loadRecent();
    // Arriving from Discover: pre-fill the ticker (the user still clicks Analyze, which uses a Gemini request).
    const t = new URLSearchParams(window.location.search).get("ticker");
    if (t) setTicker(t.toUpperCase().slice(0, 20));
  }, [loadRecent]);

  const run = async (symbol: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<AnalyzeResponse>("/api/analyze", { method: "POST", body: JSON.stringify({ ticker: symbol }) }));
      setSavedAt(null);
      loadRecent();
    } catch (e) {
      setError(toUiError(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(ticker);
  };

  const openSaved = async (r: ReportSummary) => {
    setLoading(true);
    setError(null);
    try {
      const saved = await api<SavedReport>(`/api/reports/${r.id}`);
      if (saved.kind === "ANALYZER") {
        setData({ signals: saved.signals, strategy: saved.strategy, meta: saved.meta });
        setSavedAt(saved.createdAt);
        setTicker(saved.ticker);
      }
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setLoading(false);
    }
  };

  const s = data?.signals;

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <TickerSearch required value={ticker} onChange={setTicker} placeholder="Symbol or name, e.g. MSFT, tata silver" className="w-full max-w-96" disabled={!ai.enabled} />
        <Button type="submit" loading={loading && !savedAt} disabled={!ai.enabled || loading}>
          {!loading && (ai.enabled ? <Search className="h-4 w-4" /> : <Lock className="h-4 w-4" />)}
          Analyze
        </Button>
      </form>

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center gap-1 text-neutral-500">
            <History className="h-3.5 w-3.5" aria-hidden /> Recent
          </span>
          {recent.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => openSaved(r)}
              disabled={loading}
              title={`Open saved analysis from ${new Date(r.createdAt).toLocaleString()} (no new Gemini request)`}
              className={cx(
                "rounded-full border border-neutral-300 bg-white px-2.5 py-1 hover:bg-neutral-100 disabled:opacity-50",
                s?.ticker === r.ticker && savedAt && "border-neutral-900",
              )}
            >
              <span className="font-medium text-neutral-900">{r.ticker}</span>
              <span className="ml-1.5 text-neutral-500">
                {stanceLabel(r.stance)} · {fmtRelative(r.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}

      {!ai.loading && !ai.enabled && (
        <Alert tone="info">
          The analyzer is locked.{" "}
          <Link href="/settings" className="font-medium underline">
            Add your Gemini API key
          </Link>{" "}
          to enable it.
        </Alert>
      )}
      {loading && !savedAt && (
        <p className="text-sm text-neutral-500" aria-live="polite">
          Fetching 5 years of prices and financials, scoring quality, valuation and trend, running forecast and sentiment, then asking Gemini…
        </p>
      )}
      {error && (
        <ErrorWithSuggestions
          error={error}
          onPick={(symbol) => {
            setTicker(symbol);
            setError(null);
          }}
        />
      )}

      {data && s && !(loading && !savedAt) && (
        <>
          {savedAt && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600">
              <span className="flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" aria-hidden />
                Saved analysis from {fmtRelative(savedAt)} ({new Date(savedAt).toLocaleString()}). Prices and data are as of then.
              </span>
              <button type="button" onClick={() => run(s.ticker)} disabled={!ai.enabled} className="shrink-0 font-medium text-neutral-900 underline disabled:opacity-50">
                Re-run now
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl font-semibold">{s.ticker}</h2>
            {s.name && <span className="text-sm text-neutral-500">{s.name}</span>}
            <span className="num ml-auto text-lg font-medium">{fmtMoney(s.technicals.last_close, s.currency)}</span>
          </div>
          <StrategyView kind="analyzer" strategy={data.strategy} meta={data.meta} currency={s.currency} />
          <SignalsPanel signals={s} />
        </>
      )}
    </div>
  );
}
