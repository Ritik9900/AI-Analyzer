import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message }, ...extra }, { status });
}

export function validationError(err: ZodError) {
  const first = err.issues[0];
  const path = first?.path.join(".");
  return jsonError(400, "VALIDATION", path ? `${path}: ${first.message}` : (first?.message ?? "Invalid input"));
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
