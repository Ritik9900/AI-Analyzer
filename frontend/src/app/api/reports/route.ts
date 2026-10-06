import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/http";
import { parseReport, summarize } from "@/lib/reports";
import type { ReportSummary } from "@/lib/types";

/**
 * GET /api/reports?kind=ANALYZER|POSITION&positionId=3&limit=6&distinct=ticker
 * Summaries of saved strategies (newest first), skipping outdated formats.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind");
  if (kind && kind !== "ANALYZER" && kind !== "POSITION") return jsonError(400, "VALIDATION", "kind must be ANALYZER or POSITION");
  const positionId = q.get("positionId") ? Number(q.get("positionId")) : undefined;
  if (positionId !== undefined && (!Number.isInteger(positionId) || positionId <= 0)) return jsonError(400, "VALIDATION", "Invalid positionId");
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 10) || 10, 1), 50);
  const distinctTicker = q.get("distinct") === "ticker";

  const rows = await prisma.strategyReport.findMany({
    where: { ...(kind ? { kind } : {}), ...(positionId ? { positionId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit * 5, // headroom for outdated / duplicate rows
  });

  const out: ReportSummary[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (distinctTicker && seen.has(row.ticker)) continue;
    const parsed = parseReport(row);
    if (!parsed) continue;
    seen.add(row.ticker);
    out.push(summarize(parsed));
    if (out.length >= limit) break;
  }
  return NextResponse.json({ reports: out });
}
