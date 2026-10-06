import { NextResponse } from "next/server";
import { listGenerativeModels } from "@/lib/gemini";
import { jsonError } from "@/lib/http";
import { getAiConfig } from "@/lib/settings";

/** Stable Gemini text models this key can use, newest first — for building the fallback chain. */
export async function GET() {
  const cfg = await getAiConfig();
  if (!cfg.apiKey) return jsonError(403, "AI_LOCKED", cfg.keyError ?? "No Gemini API key saved.");
  try {
    return NextResponse.json({ models: await listGenerativeModels(cfg.apiKey) });
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/AIza[0-9A-Za-z_\-]{20,}/g, "[redacted]") : "Unknown error";
    return jsonError(502, "GEMINI_LIST_FAILED", `Could not list models: ${message.slice(0, 200)}`);
  }
}
