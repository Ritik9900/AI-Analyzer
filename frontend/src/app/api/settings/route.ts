import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ConfigError, encrypt } from "@/lib/crypto";
import { jsonError, readJson, validationError } from "@/lib/http";
import { MODEL_ID_PATTERN, defaultModels, getAiConfig } from "@/lib/settings";

// The API key itself is never returned — only whether one exists and its last 4 chars.

const updateSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20, "API key looks too short")
    .max(200)
    .regex(/^\S+$/, "API key must not contain spaces")
    .optional(),
  /** Ordered fallback chain. Empty array resets to the default chain. */
  models: z.array(z.string().trim().regex(MODEL_ID_PATTERN, "Invalid model id")).max(10).optional(),
});

async function publicSettings() {
  const cfg = await getAiConfig();
  return {
    hasKey: Boolean(cfg.apiKey),
    keyHint: cfg.keyHint,
    keyUnreadable: cfg.keyUnreadable,
    keyError: cfg.keyError,
    models: cfg.models,
    modelsCustomised: cfg.modelsCustomised,
    defaultModels: defaultModels(),
  };
}

export async function GET() {
  return NextResponse.json(await publicSettings());
}

export async function PUT(req: Request) {
  const parsed = updateSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);
  const { apiKey, models } = parsed.data;

  const data: { geminiApiKeyEnc?: string; geminiApiKeyHint?: string; geminiModels?: string | null } = {};
  if (apiKey !== undefined) {
    try {
      data.geminiApiKeyEnc = encrypt(apiKey);
    } catch (err) {
      if (err instanceof ConfigError) return jsonError(500, "CONFIG", err.message);
      throw err;
    }
    data.geminiApiKeyHint = apiKey.slice(-4);
  }
  if (models !== undefined) {
    const unique = [...new Set(models)];
    data.geminiModels = unique.length ? unique.join(",") : null;
  }

  await prisma.appSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  return NextResponse.json(await publicSettings());
}

export async function DELETE() {
  await prisma.appSettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: { geminiApiKeyEnc: null, geminiApiKeyHint: null },
  });
  return NextResponse.json(await publicSettings());
}
