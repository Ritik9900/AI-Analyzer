"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Alert, Input, cx } from "@/components/ui";
import { api, type UiError } from "@/lib/client";
import type { SymbolMatch } from "@/lib/types";

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

/**
 * Ticker input with Yahoo symbol search. Accepts a raw symbol or a name ("tata silver");
 * picking a result fills in the exact Yahoo symbol (e.g. TATSILV.NS).
 */
export function TickerSearch({
  value,
  onChange,
  placeholder = "Symbol or name",
  className,
  disabled,
  required,
  autoFocus,
}: {
  value: string;
  onChange: (symbol: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [results, setResults] = useState<SymbolMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false); // only search on user typing, not on programmatic fills
  const seq = useRef(0);

  useEffect(() => {
    const q = value.trim();
    if (!dirty || q.length < MIN_CHARS) {
      setResults([]);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await api<{ results: SymbolMatch[] }>("/api/search", { method: "POST", body: JSON.stringify({ query: q }) });
        if (id === seq.current) {
          setResults(data.results);
          setActive(data.results.length ? 0 : -1);
        }
      } catch {
        if (id === seq.current) setResults([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, dirty]);

  const pick = (m: SymbolMatch) => {
    onChange(m.symbol);
    setDirty(false);
    setOpen(false);
    setResults([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") setActive((a) => (a + 1) % results.length);
    else if (e.key === "ArrowUp") setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    else if (e.key === "Enter" && active >= 0) pick(results[active]);
    else if (e.key === "Escape") setOpen(false);
    else return;
    e.preventDefault();
  };

  const showList = open && dirty && value.trim().length >= MIN_CHARS;

  return (
    <div className={cx("relative", className)}>
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          setDirty(true);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full uppercase placeholder:normal-case"
        maxLength={60}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
      />
      {loading && <LoaderCircle className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-neutral-400" />}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 z-30 mt-1 max-h-80 w-[26rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {results.map((m, i) => (
            <li
              key={m.symbol}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              onMouseEnter={() => setActive(i)}
              className={cx("flex cursor-pointer items-baseline gap-3 px-3 py-1.5 text-sm", i === active && "bg-neutral-100")}
            >
              <span className="w-28 shrink-0 font-medium text-neutral-900">{m.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-neutral-600">{m.name ?? "—"}</span>
              <span className="shrink-0 text-xs text-neutral-400">{[m.exchange, m.type].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
          {!loading && !results.length && <li className="px-3 py-1.5 text-sm text-neutral-500">No matches. Try the company or fund name.</li>}
          {loading && !results.length && <li className="px-3 py-1.5 text-sm text-neutral-400">Searching…</li>}
        </ul>
      )}
    </div>
  );
}

/** Error alert that renders clickable "did you mean" symbols when the API supplied them. */
export function ErrorWithSuggestions({ error, onPick }: { error: UiError; onPick: (symbol: string) => void }) {
  return (
    <Alert tone="negative">
      {error.message}
      {error.suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {error.suggestions.map((s) => (
            <button
              key={s.symbol}
              type="button"
              onClick={() => onPick(s.symbol)}
              className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs text-neutral-800 hover:bg-red-50"
              title={[s.name, s.exchange].filter(Boolean).join(" · ")}
            >
              <span className="font-medium">{s.symbol}</span>
              {s.name && <span className="ml-1.5 text-neutral-500">{s.name.length > 32 ? `${s.name.slice(0, 32)}…` : s.name}</span>}
            </button>
          ))}
        </div>
      )}
    </Alert>
  );
}
