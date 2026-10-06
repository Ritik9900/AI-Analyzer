"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Lock, Pencil, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { StrategyDrawer } from "@/components/StrategyDrawer";
import { Alert, Button, Card, Input, Signed, Skeleton, StatTile, cx } from "@/components/ui";
import { ErrorWithSuggestions, TickerSearch } from "@/components/TickerSearch";
import { api, toUiError, useAiStatus, type UiError } from "@/lib/client";
import { fmtMoney, fmtPct, fmtQty, fmtSignedMoney } from "@/lib/format";
import type { PositionRow } from "@/lib/types";

const emptyForm = { ticker: "", avgBuyPrice: "", quantity: "" };
const AUTO_REFRESH_MS = 60_000;

type Row = PositionRow & { weightPct: number | null; dayChange: number | null };
type SortKey = "ticker" | "quantity" | "marketValue" | "weightPct" | "dayChangePct" | "pnl" | "pnlPct";

export function PortfolioTable() {
  const ai = useAiStatus();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: number; avgBuyPrice: string; quantity: string } | null>(null);
  const [strategyRow, setStrategyRow] = useState<PositionRow | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "marketValue", dir: -1 });
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api<{ positions: PositionRow[]; backendError: string | null }>("/api/positions");
      setRows(data.positions);
      setBackendError(data.backendError);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setRefreshing(false);
      setInitialLoad(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep prices fresh while the tab is visible; never refresh under an open inline edit.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && !editingRef.current) load();
    };
    const timer = setInterval(tick, AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
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

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") saveEdit();
    else if (e.key === "Escape") setEditing(null);
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
    const day = rows.reduce((s, r) => s + (r.dayChangePct == null || r.marketValue == null ? 0 : r.marketValue - r.marketValue / (1 + r.dayChangePct / 100)), 0);
    return { cost, value, pnl: value - cost, pnlPct: ((value - cost) / cost) * 100, day, dayPct: (day / (value - day)) * 100, currency: [...currencies][0] ?? null };
  }, [rows]);

  const sorted: Row[] = useMemo(() => {
    const total = totals?.value ?? null;
    const withDerived = rows.map((r) => ({
      ...r,
      weightPct: total && r.marketValue != null ? (r.marketValue / total) * 100 : null,
      dayChange: r.dayChangePct == null || r.marketValue == null ? null : r.marketValue - r.marketValue / (1 + r.dayChangePct / 100),
    }));
    return withDerived.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir;
    });
  }, [rows, totals, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "ticker" ? 1 : -1 }));

  return (
    <>
      {totals && (
        <section aria-label="Portfolio summary" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Market value" value={fmtMoney(totals.value, totals.currency)} sub={`${rows.length} holdings`} />
          <StatTile label="Invested" value={fmtMoney(totals.cost, totals.currency)} sub="Cost basis" />
          <StatTile
            label="Unrealised P/L"
            value={<Signed value={totals.pnl}>{fmtSignedMoney(totals.pnl, totals.currency)}</Signed>}
            sub={<Signed value={totals.pnlPct}>{fmtPct(totals.pnlPct)}</Signed>}
          />
          <StatTile
            label="Today"
            value={<Signed value={totals.day}>{fmtSignedMoney(totals.day, totals.currency)}</Signed>}
            sub={<Signed value={totals.dayPct}>{fmtPct(totals.dayPct)}</Signed>}
          />
        </section>
      )}

      <Card
        title="Positions"
        description={
          <>
            Live prices via Yahoo Finance; may be delayed.
            {updatedAt && <> Updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}, auto-refreshes every minute.</>}
          </>
        }
        actions={
          <Button variant="secondary" size="sm" onClick={load} loading={refreshing}>
            {!refreshing && <RefreshCw className="h-3.5 w-3.5" />} Refresh
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
              AI Strategy is locked.{" "}
              <Link href="/settings" className="font-medium underline">
                Add your Gemini API key
              </Link>{" "}
              to enable it.
            </Alert>
          )}

          <form onSubmit={add} className="flex flex-wrap items-end gap-2">
            <Field label="Ticker">
              <TickerSearch required value={form.ticker} onChange={(ticker) => setForm((f) => ({ ...f, ticker }))} className="w-56" />
            </Field>
            <Field label="Avg buy price">
              <Input
                required
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="0.00"
                value={form.avgBuyPrice}
                onChange={(e) => setForm({ ...form, avgBuyPrice: e.target.value })}
                className="num w-36"
              />
            </Field>
            <Field label="Quantity">
              <Input
                required
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="0"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="num w-28"
              />
            </Field>
            <Button type="submit" loading={saving}>
              {!saving && <Plus className="h-4 w-4" />} Add position
            </Button>
          </form>
        </div>

        <div className="relative -mx-5 mt-4 overflow-x-auto border-t border-neutral-200">
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500">
              <tr className="border-b border-neutral-200">
                <SortTh label="Ticker" k="ticker" sort={sort} onSort={toggleSort} align="left" />
                <SortTh label="Qty" k="quantity" sort={sort} onSort={toggleSort} />
                <Th>Avg cost</Th>
                <Th>Last</Th>
                <SortTh label="Day" k="dayChangePct" sort={sort} onSort={toggleSort} />
                <SortTh label="Market value" k="marketValue" sort={sort} onSort={toggleSort} />
                <SortTh label="Weight" k="weightPct" sort={sort} onSort={toggleSort} />
                <SortTh label="P/L" k="pnl" sort={sort} onSort={toggleSort} />
                <SortTh label="P/L %" k="pnlPct" sort={sort} onSort={toggleSort} />
                <th className="px-5 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className={cx("whitespace-nowrap transition-opacity", refreshing && !initialLoad && "opacity-70")}>
              {initialLoad &&
                Array.from({ length: 4 }, (_, i) => (
                  <tr key={i} className="border-b border-neutral-100">
                    {Array.from({ length: 10 }, (_, j) => (
                      <td key={j} className="px-3 py-3 first:pl-5">
                        <Skeleton className={cx("h-4", j === 0 ? "w-24" : "ml-auto w-16")} />
                      </td>
                    ))}
                  </tr>
                ))}
              {sorted.map((r) => {
                const isEditing = editing?.id === r.id;
                return (
                  <tr key={r.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-5 py-2.5 font-medium">{r.ticker}</td>
                    <Td>
                      {isEditing && editing ? (
                        <Input
                          autoFocus
                          aria-label={`Quantity for ${r.ticker}`}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          value={editing.quantity}
                          onChange={(e) => setEditing({ ...editing, quantity: e.target.value })}
                          onKeyDown={onEditKey}
                          className="num h-8 w-24 text-right"
                        />
                      ) : (
                        fmtQty(r.quantity)
                      )}
                    </Td>
                    <Td>
                      {isEditing && editing ? (
                        <Input
                          aria-label={`Average buy price for ${r.ticker}`}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          value={editing.avgBuyPrice}
                          onChange={(e) => setEditing({ ...editing, avgBuyPrice: e.target.value })}
                          onKeyDown={onEditKey}
                          className="num h-8 w-28 text-right"
                        />
                      ) : (
                        fmtMoney(r.avgBuyPrice, r.currency)
                      )}
                    </Td>
                    <Td>{fmtMoney(r.price, r.currency)}</Td>
                    <Td>
                      <Signed value={r.dayChangePct}>{fmtPct(r.dayChangePct)}</Signed>
                    </Td>
                    <Td>{fmtMoney(r.marketValue, r.currency)}</Td>
                    <Td>{fmtPct(r.weightPct, 1, false)}</Td>
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
                            <Button size="sm" variant="ghost" onClick={saveEdit} title="Save (Enter)" aria-label="Save">
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} title="Cancel (Esc)" aria-label="Cancel">
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!ai.enabled}
                              title={ai.enabled ? "Long-term AI view of this holding" : (ai.reason ?? "Add a Gemini API key in Settings")}
                              onClick={() => setStrategyRow(r)}
                            >
                              {ai.enabled ? <Sparkles className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                              AI Strategy
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Edit"
                              aria-label={`Edit ${r.ticker}`}
                              onClick={() => setEditing({ id: r.id, avgBuyPrice: String(r.avgBuyPrice), quantity: String(r.quantity) })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="danger" title="Delete" aria-label={`Delete ${r.ticker}`} onClick={() => remove(r)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && !initialLoad && (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-sm whitespace-normal text-neutral-500">
                    <p className="font-medium text-neutral-700">No positions yet</p>
                    <p className="mt-1">
                      Search by name or symbol above (e.g. &ldquo;infosys&rdquo; or &ldquo;TCS.NS&rdquo;), enter your average buy price and quantity, then
                      Add position.
                    </p>
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

function Th({ children, align = "right" }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return <th className={cx("whitespace-nowrap px-3 py-2 font-medium first:pl-5", align === "left" ? "text-left" : "text-right")}>{children}</th>;
}

function SortTh({
  label,
  k,
  sort,
  onSort,
  align = "right",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  const Icon = active ? (sort.dir === 1 ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      className={cx("whitespace-nowrap px-3 py-2 font-medium first:pl-5", align === "left" ? "text-left" : "text-right")}
    >
      <button type="button" onClick={() => onSort(k)} className={cx("inline-flex items-center gap-1 hover:text-neutral-900", active && "text-neutral-900")}>
        {label}
        <Icon className="h-3 w-3" aria-hidden />
      </button>
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="num px-3 py-2.5 text-right">{children}</td>;
}
