"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Lock, Pencil, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { StrategyDrawer } from "@/components/StrategyDrawer";
import { Alert, Button, Card, Input, Signed, cx } from "@/components/ui";
import { ErrorWithSuggestions, TickerSearch } from "@/components/TickerSearch";
import { api, toUiError, useAiStatus, type UiError } from "@/lib/client";
import { fmtMoney, fmtPct, fmtQty, fmtSignedMoney } from "@/lib/format";
import type { PositionRow } from "@/lib/types";

const emptyForm = { ticker: "", avgBuyPrice: "", quantity: "" };

export function PortfolioTable() {
  const ai = useAiStatus();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: number; avgBuyPrice: string; quantity: string } | null>(null);
  const [strategyRow, setStrategyRow] = useState<PositionRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ positions: PositionRow[]; backendError: string | null }>("/api/positions");
      setRows(data.positions);
      setBackendError(data.backendError);
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api("/api/positions", {
        method: "POST",
        body: JSON.stringify({ ticker: form.ticker, avgBuyPrice: Number(form.avgBuyPrice), quantity: Number(form.quantity) }),
      });
      setForm(emptyForm);
      await load();
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError(null);
    try {
      await api(`/api/positions/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ avgBuyPrice: Number(editing.avgBuyPrice), quantity: Number(editing.quantity) }),
      });
      setEditing(null);
      await load();
    } catch (e) {
      setError(toUiError(e));
    }
  };

  const remove = async (row: PositionRow) => {
    if (!window.confirm(`Remove ${row.ticker} from your portfolio?`)) return;
    setError(null);
    try {
      await api(`/api/positions/${row.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(toUiError(e));
    }
  };

  const totals = useMemo(() => {
    const currencies = new Set(rows.map((r) => r.currency).filter(Boolean));
    if (!rows.length || currencies.size > 1 || rows.some((r) => r.marketValue == null)) return null;
    const cost = rows.reduce((s, r) => s + r.costBasis, 0);
    const value = rows.reduce((s, r) => s + (r.marketValue ?? 0), 0);
    return { cost, value, pnl: value - cost, pnlPct: ((value - cost) / cost) * 100, currency: [...currencies][0] ?? null };
  }, [rows]);

  return (
    <>
      {totals && (
        <dl className="mb-6 grid grid-cols-3 gap-6 rounded-lg border border-neutral-200 bg-white px-5 py-4">
          <Summary label="Cost basis" value={fmtMoney(totals.cost, totals.currency)} />
          <Summary label="Market value" value={fmtMoney(totals.value, totals.currency)} />
          <Summary
            label="Unrealised P/L"
            value={
              <Signed value={totals.pnl}>
                {fmtSignedMoney(totals.pnl, totals.currency)} <span className="text-sm">({fmtPct(totals.pnlPct)})</span>
              </Signed>
            }
          />
        </dl>
      )}

      <Card
        title="Positions"
        description="Live prices via Yahoo Finance; may be delayed."
        actions={
          <Button variant="secondary" size="sm" onClick={load} loading={loading}>
            {!loading && <RefreshCw className="h-3.5 w-3.5" />} Refresh
          </Button>
        }
      >
        <div className="space-y-3">
          {backendError && <Alert tone="warning">Live prices unavailable: {backendError}</Alert>}
          {error && (
            <ErrorWithSuggestions
              error={error}
              onPick={(ticker) => {
                setForm((f) => ({ ...f, ticker }));
                setError(null);
              }}
            />
          )}
          {!ai.loading && !ai.enabled && (
            <Alert tone="info">
              AI Strategy is locked. <Link href="/settings" className="font-medium underline">Add your Gemini API key</Link> to enable it.
            </Alert>
          )}

          <form onSubmit={add} className="flex flex-wrap items-end gap-2">
            <Field label="Ticker">
              <TickerSearch required value={form.ticker} onChange={(ticker) => setForm((f) => ({ ...f, ticker }))} className="w-56" />
            </Field>
            <Field label="Avg buy price">
              <Input required type="number" step="any" min="0" placeholder="0.00" value={form.avgBuyPrice} onChange={(e) => setForm({ ...form, avgBuyPrice: e.target.value })} className="num w-36" />
            </Field>
            <Field label="Quantity">
              <Input required type="number" step="any" min="0" placeholder="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="num w-28" />
            </Field>
            <Button type="submit" loading={saving}>
              {!saving && <Plus className="h-4 w-4" />} Add position
            </Button>
          </form>
        </div>

        <div className="-mx-5 mt-4 overflow-x-auto border-t border-neutral-200">
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500">
              <tr className="border-b border-neutral-200">
                <Th align="left">Ticker</Th>
                <Th>Qty</Th>
                <Th>Avg cost</Th>
                <Th>Last</Th>
                <Th>Day</Th>
                <Th>Market value</Th>
                <Th>P/L</Th>
                <Th>P/L %</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isEditing = editing?.id === r.id;
                return (
                  <tr key={r.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-5 py-2.5 font-medium">{r.ticker}</td>
                    <Td>
                      {isEditing && editing ? (
                        <Input type="number" step="any" min="0" value={editing.quantity} onChange={(e) => setEditing({ ...editing, quantity: e.target.value })} className="num h-8 w-24 text-right" />
                      ) : (
                        fmtQty(r.quantity)
                      )}
                    </Td>
                    <Td>
                      {isEditing && editing ? (
                        <Input type="number" step="any" min="0" value={editing.avgBuyPrice} onChange={(e) => setEditing({ ...editing, avgBuyPrice: e.target.value })} className="num h-8 w-28 text-right" />
                      ) : (
                        fmtMoney(r.avgBuyPrice, r.currency)
                      )}
                    </Td>
                    <Td>{fmtMoney(r.price, r.currency)}</Td>
                    <Td>
                      <Signed value={r.dayChangePct}>{fmtPct(r.dayChangePct)}</Signed>
                    </Td>
                    <Td>{fmtMoney(r.marketValue, r.currency)}</Td>
                    <Td>
                      <Signed value={r.pnl}>{fmtSignedMoney(r.pnl, r.currency)}</Signed>
                    </Td>
                    <Td>
                      <Signed value={r.pnlPct}>{fmtPct(r.pnlPct)}</Signed>
                    </Td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing && editing ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={saveEdit} title="Save">
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} title="Cancel">
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!ai.enabled}
                              title={ai.enabled ? "Generate AI strategy" : (ai.reason ?? "Add a Gemini API key in Settings")}
                              onClick={() => setStrategyRow(r)}
                            >
                              {ai.enabled ? <Sparkles className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                              AI Strategy
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Edit"
                              onClick={() => setEditing({ id: r.id, avgBuyPrice: String(r.avgBuyPrice), quantity: String(r.quantity) })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="danger" title="Delete" onClick={() => remove(r)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && !loading && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-sm text-neutral-500">
                    No positions yet. Add one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {strategyRow && <StrategyDrawer row={strategyRow} onClose={() => setStrategyRow(null)} />}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-500">
      {label}
      {children}
    </label>
  );
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="num mt-1 text-lg font-semibold text-neutral-900">{value}</dd>
    </div>
  );
}

function Th({ children, align = "right" }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return <th className={cx("px-5 py-2 font-medium", align === "left" ? "text-left" : "text-right")}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="num px-3 py-2.5 text-right">{children}</td>;
}
