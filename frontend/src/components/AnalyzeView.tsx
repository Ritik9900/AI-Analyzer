"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Lock, Search } from "lucide-react";
import { SignalsPanel } from "@/components/SignalsPanel";
import { StrategyView } from "@/components/StrategyView";
import { ErrorWithSuggestions, TickerSearch } from "@/components/TickerSearch";
import { Alert, Button } from "@/components/ui";
import { api, toUiError, useAiStatus, type UiError } from "@/lib/client";
import { fmtMoney } from "@/lib/format";
import type { AnalyzerStrategy } from "@/lib/strategy-schema";
import type { AnalyzeSignals, StrategyMeta } from "@/lib/types";

interface AnalyzeResponse {
  signals: AnalyzeSignals;
  strategy: AnalyzerStrategy;
  meta: StrategyMeta;
}

export function AnalyzeView() {
  const ai = useAiStatus();
  const [ticker, setTicker] = useState("");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setData(await api<AnalyzeResponse>("/api/analyze", { method: "POST", body: JSON.stringify({ ticker }) }));
    } catch (e) {
      setError(toUiError(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const s = data?.signals;

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="flex gap-2">
        <TickerSearch
          required
          value={ticker}
          onChange={setTicker}
          placeholder="Symbol or name, e.g. MSFT, tata silver"
          className="w-96"
          disabled={!ai.enabled}
        />
        <Button type="submit" loading={loading} disabled={!ai.enabled}>
          {!loading && (ai.enabled ? <Search className="h-4 w-4" /> : <Lock className="h-4 w-4" />)}
          Analyze
        </Button>
      </form>

      {!ai.loading && !ai.enabled && (
        <Alert tone="info">
          The analyzer is locked. <Link href="/settings" className="font-medium underline">Add your Gemini API key</Link> to enable it.
        </Alert>
      )}
      {loading && <p className="text-sm text-neutral-500">Fetching data, computing indicators, running forecast and sentiment, then asking Gemini…</p>}
      {error && (
        <ErrorWithSuggestions
          error={error}
          onPick={(symbol) => {
            setTicker(symbol);
            setError(null);
          }}
        />
      )}

      {data && s && !loading && (
        <>
          <div className="flex items-baseline gap-3">
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
