import type { AnalyzeSignals, PositionSignals, Quote, SymbolMatch } from "@/lib/types";

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

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new BackendError(
      timedOut
        ? `Signals service timed out after ${timeoutMs / 1000}s.`
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

export function getPositionSignals(ticker: string) {
  return post<PositionSignals>("/signals/position", { ticker }, 90_000);
}

export function getAnalyzeSignals(ticker: string) {
  return post<AnalyzeSignals>("/signals/analyze", { ticker }, 120_000);
}

/** Map a backend failure to the status our own API should return. */
export function backendStatus(err: BackendError): number {
  if (err.status === 404 || err.status === 422) return err.status;
  return err.status === 504 ? 504 : 502;
}
