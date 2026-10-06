import { NextResponse } from "next/server";
import { GeminiAuthError, GeminiUnavailableError, generateWithFallback } from "@/lib/gemini";
import { jsonError } from "@/lib/http";
import { PING_PROMPT } from "@/lib/prompts";
import { getAiConfig } from "@/lib/settings";
import { pingGeminiSchema, pingSchema } from "@/lib/strategy-schema";

/** Runs a tiny request through the full fallback chain and reports which model answered. */
export async function POST() {
  const cfg = await getAiConfig();
  if (!cfg.apiKey) return jsonError(403, "AI_LOCKED", cfg.keyError ?? "No Gemini API key saved.");

  try {
    const result = await generateWithFallback({
      apiKey: cfg.apiKey,
      models: cfg.models,
      systemInstruction: "You are a connectivity check.",
      prompt: PING_PROMPT,
      responseSchema: pingGeminiSchema,
      validator: pingSchema,
      temperature: 0,
    });
    return NextResponse.json({ ok: true, model: result.model, attempts: result.attempts });
  } catch (err) {
    if (err instanceof GeminiAuthError) {
      return NextResponse.json({ ok: false, reason: "Gemini rejected the API key.", attempts: err.attempts });
    }
    if (err instanceof GeminiUnavailableError) {
      return NextResponse.json({ ok: false, reason: "No model in the chain responded.", attempts: err.attempts });
    }
    throw err;
  }
}
