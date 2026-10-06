import type { AnalyzeSignals, PortfolioAnalytics, PositionSignals, Quote, SymbolMatch } from "@/lib/types";

// Server-side client for the FastAPI signals service. Never imported by client components.

const BASE_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export class BackendError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// Desktop app: a per-launch token shared with the backend so other local programs can't use it.
const TOKEN_HEADER: Record<string, string> = process.env.PA_TOKEN ? { "x-pa-token": process.env.PA_TOKEN } : {};

async function request<T>(method: "GET" | "POST", path: string, body: unknown, timeoutMs: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "content-type": "application/json", ...TOKEN_HEADER },
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new BackendError(
      timedOut
        ? `Signals service timed out after ${timeoutMs / 1000}s.`
        : process.env.PA_PACKAGED === "1"
          ? "The analysis service is not running. Restart Portfolio Analyzer."
          : `Signals service unreachable at ${BASE_URL}. Is uvicorn running? (README, step 2)`,
      timedOut ? 504 : 503,
    );
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: unknown };
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* keep statusText */
    }
    throw new BackendError(detail, res.status);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown, timeoutMs: number) => request<T>("POST", path, body, timeoutMs);

export interface LicenseStatus {
  enforced: boolean;
  state: string;
  valid: boolean;
  message: string;
  device_id: string | null;
  licensee: string | null;
  expires_at: string | null;
  days_left: number | null;
  build_version: string;
}

export function getLicenseStatus() {
  return request<LicenseStatus>("GET", "/license/status", undefined, 15_000);
}

export function activateLicense(key: string) {
  return request<LicenseStatus>("POST", "/license/activate", { key }, 30_000);
}

export async function getQuotes(tickers: string[]): Promise<Quote[]> {
  if (!tickers.length) return [];
  const data = await post<{ quotes: Quote[] }>("/quotes", { tickers }, 20_000);
  return data.quotes;
}

export async function searchSymbols(query: string): Promise<SymbolMatch[]> {
  const data = await post<{ results: SymbolMatch[] }>("/search", { query }, 15_000);
  return data.results;
}

/** Best-effort suggestions for an unknown ticker; never throws. */
export async function suggestSymbols(query: string, limit = 5): Promise<SymbolMatch[]> {
  try {
    return (await searchSymbols(query)).slice(0, limit);
  } catch {
    return [];
  }
}

export function getPortfolioAnalytics(holdings: { ticker: string; quantity: number }[], windowDays: number) {
  return post<PortfolioAnalytics>("/portfolio/analytics", { holdings, window_days: windowDays }, 60_000);
}

export function getPositionSignals(ticker: string) {
  return post<PositionSignals>("/signals/position", { ticker }, 90_000);
}

export function getAnalyzeSignals(ticker: string) {
  return post<AnalyzeSignals>("/signals/analyze", { ticker }, 120_000);
}

/** Map a backend failure to the status our own API should return. */
export function backendStatus(err: BackendError): number {
  if (err.status === 403 || err.status === 404 || err.status === 422) return err.status; // 403 = licence
  return err.status === 504 ? 504 : 502;
}
