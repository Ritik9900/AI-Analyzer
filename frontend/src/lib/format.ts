const DASH = "—";

const valid = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/** Indian digit grouping (₹3,31,770.76; ₹1.6LCr) for rupees, international grouping otherwise. */
const localeFor = (currency?: string | null) => (currency === "INR" ? "en-IN" : "en-US");

export function fmtMoney(n: number | null | undefined, currency?: string | null, digits = 2): string {
  if (!valid(n)) return DASH;
  try {
    return new Intl.NumberFormat(localeFor(currency), {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return n.toFixed(digits);
  }
}

/** Large amounts in compact form, e.g. ₹1.6LCr, ₹2.7L, $107.7B. */
export function fmtCompact(n: number | null | undefined, currency?: string | null): string {
  if (!valid(n)) return DASH;
  try {
    return new Intl.NumberFormat(localeFor(currency), { style: "currency", currency: currency || "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  }
}

export function fmtSignedMoney(n: number | null | undefined, currency?: string | null, digits = 2): string {
  if (!valid(n)) return DASH;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtMoney(Math.abs(n), currency, digits)}`;
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (!valid(n)) return DASH;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(n: number | null | undefined, digits = 2, signed = true): string {
  if (!valid(n)) return DASH;
  const sign = signed && n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

export function fmtQty(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function toneOf(n: number | null | undefined): "positive" | "negative" | "neutral" {
  if (!valid(n) || n === 0) return "neutral";
  return n > 0 ? "positive" : "negative";
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function fmtRelative(iso: string | Date, now = Date.now()): string {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

/** "2026-10-06" -> "6 Oct 2026" (or "6 Oct" when short). */
export function fmtDate(iso: string, short = false): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(short ? {} : { year: "numeric" }), timeZone: "UTC" });
}
