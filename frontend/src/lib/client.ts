"use client";

import { useEffect, useState } from "react";
import type { ApiErrorBody, SymbolMatch } from "@/lib/types";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public suggestions: SymbolMatch[] = [],
  ) {
    super(message);
  }
}

/** Error message plus any ticker suggestions, for rendering with <ErrorWithSuggestions>. */
export interface UiError {
  message: string;
  suggestions: SymbolMatch[];
}

export const toUiError = (e: unknown): UiError => ({
  message: e instanceof Error ? e.message : String(e),
  suggestions: e instanceof ApiClientError ? e.suggestions : [],
});

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    throw new ApiClientError(
      data?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      data?.error?.code ?? "UNKNOWN",
      data?.suggestions ?? [],
    );
  }
  return data as T;
}

export interface AiStatus {
  loading: boolean;
  enabled: boolean;
  reason: string | null;
}

/** Whether AI features are unlocked (a readable Gemini key is saved). */
export function useAiStatus(): AiStatus {
  const [status, setStatus] = useState<AiStatus>({ loading: true, enabled: false, reason: null });
  useEffect(() => {
    api<{ hasKey: boolean; keyError: string | null }>("/api/settings")
      .then((s) => setStatus({ loading: false, enabled: s.hasKey, reason: s.hasKey ? null : (s.keyError ?? "No Gemini API key saved.") }))
      .catch((e: Error) => setStatus({ loading: false, enabled: false, reason: e.message }));
  }, []);
  return status;
}
