import { NextResponse } from "next/server";
import { z } from "zod";
import { BackendError, activateLicense, getLicenseStatus } from "@/lib/backend";
import { jsonError, readJson, validationError } from "@/lib/http";

/** Licence status for the UI. In development the backend reports enforced=false. */
export async function GET() {
  try {
    return NextResponse.json(await getLicenseStatus());
  } catch (err) {
    const message = err instanceof BackendError ? err.message : "Licence status unavailable.";
    return NextResponse.json({ enforced: false, state: "unknown", valid: false, message }, { status: 200 });
  }
}

const bodySchema = z.object({ key: z.string().trim().min(10).max(4000) });

/** Enter a new (e.g. renewal) licence key while the current one is still active. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  try {
    return NextResponse.json(await activateLicense(parsed.data.key));
  } catch (err) {
    return jsonError(502, "BACKEND", err instanceof BackendError ? err.message : "Activation failed.");
  }
}
