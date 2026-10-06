const DASH = "—";

const valid = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

export function fmtMoney(n: number | null | undefined, currency?: string | null): string {
  if (!valid(n)) return DASH;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

export function fmtSignedMoney(n: number | null | undefined, currency?: string | null): string {
  if (!valid(n)) return DASH;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtMoney(Math.abs(n), currency)}`;
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
