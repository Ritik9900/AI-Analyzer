import type { StrategyReport } from "@prisma/client";
import { analyzerStrategySchema, positionStrategySchema } from "@/lib/strategy-schema";
import type { ReportSummary, SavedReport, StrategyMeta } from "@/lib/types";

/**
 * Parse a stored StrategyReport. Returns null for reports in an older format (e.g. from the
 * short-term version of the app) so callers simply skip them instead of rendering broken data.
 */
export function parseReport(row: StrategyReport): SavedReport | null {
  try {
    const signals = JSON.parse(row.signalsJson);
    const output = JSON.parse(row.outputJson) as { strategy: unknown; meta: StrategyMeta; position?: unknown };
    if (!signals?.long_term || !signals?.fundamentals) return null;
    const schema = row.kind === "ANALYZER" ? analyzerStrategySchema : positionStrategySchema;
    const parsed = schema.safeParse(output.strategy);
    if (!parsed.success) return null;
    return {
      id: row.id,
      kind: row.kind as SavedReport["kind"],
      ticker: row.ticker,
      positionId: row.positionId,
      createdAt: row.createdAt.toISOString(),
      usedMockMl: row.usedMockMl,
      signals,
      strategy: parsed.data,
      meta: { ...output.meta, reportId: row.id },
      position: (output.position as SavedReport["position"]) ?? null,
    } as SavedReport;
  } catch {
    return null;
  }
}

export function summarize(r: SavedReport): ReportSummary {
  return {
    id: r.id,
    kind: r.kind,
    ticker: r.ticker,
    positionId: r.positionId,
    createdAt: r.createdAt,
    stance: r.strategy.stance,
    source: r.meta.source,
    model: r.meta.model,
  };
}
