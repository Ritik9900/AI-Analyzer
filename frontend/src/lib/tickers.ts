import { suggestSymbols } from "@/lib/backend";
import { jsonError } from "@/lib/http";

// Yahoo symbols: AAPL, BRK-B, TATSILV.NS, ^GSPC, EURUSD=X, BTC-USD
export const TICKER_RE = /^[A-Za-z0-9.\-^=]{1,20}$/;

/**
 * Response for input that isn't a usable symbol — either malformed (e.g. a name like
 * "tata silver") or unknown to Yahoo — with fuzzy-search suggestions attached.
 */
export async function unknownTickerResponse(input: string, status = 400) {
  const suggestions = (await suggestSymbols(input)).filter((s) => s.symbol !== input.toUpperCase());
  const label = input.length > 40 ? `${input.slice(0, 40)}…` : input;
  return jsonError(
    status,
    "UNKNOWN_TICKER",
    suggestions.length
      ? `No market data found for '${label}'. Did you mean one of these?`
      : `No market data found for '${label}'. Try searching by company or fund name instead.`,
    { suggestions },
  );
}
