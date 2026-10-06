import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/http";
import { parseReport } from "@/lib/reports";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/reports/:id — a saved strategy with the exact signals it was generated from. */
export async function GET(_req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return jsonError(400, "VALIDATION", "Invalid report id");
  const row = await prisma.strategyReport.findUnique({ where: { id } });
  if (!row) return jsonError(404, "NOT_FOUND", "Report not found");
  const report = parseReport(row);
  if (!report) return jsonError(410, "OUTDATED", "This report was saved in an older format. Generate a new one.");
  return NextResponse.json(report);
}
