import { NextResponse } from "next/server";
import { z } from "zod";
import { BackendError, backendStatus, searchSymbols } from "@/lib/backend";
import { jsonError, readJson, validationError } from "@/lib/http";

const bodySchema = z.object({ query: z.string().trim().min(1).max(60) });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  try {
    return NextResponse.json({ results: await searchSymbols(parsed.data.query) });
  } catch (err) {
    if (err instanceof BackendError) return jsonError(backendStatus(err), "BACKEND", err.message);
    throw err;
  }
}
