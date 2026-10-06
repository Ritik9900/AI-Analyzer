import { prisma } from "@/lib/prisma";
import { ConfigError, decrypt } from "@/lib/crypto";

const BUILTIN_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];

export const MODEL_ID_PATTERN = /^[a-zA-Z0-9.\-_]{1,80}$/;

export function defaultModels(): string[] {
  const fromEnv = (process.env.GEMINI_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => MODEL_ID_PATTERN.test(m));
  return fromEnv.length ? fromEnv : BUILTIN_MODELS;
}

export function parseModelList(stored: string | null | undefined): string[] {
  const list = (stored ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => MODEL_ID_PATTERN.test(m));
  return list.length ? list : defaultModels();
}

export interface AiConfig {
  apiKey: string | null;
  keyHint: string | null;
  /** A key is stored but can't be decrypted (APP_SECRET missing/changed). */
  keyUnreadable: boolean;
  keyError: string | null;
  models: string[];
  modelsCustomised: boolean;
}

export async function getAiConfig(): Promise<AiConfig> {
  const row = await prisma.appSettings.findUnique({ where: { id: 1 } });
  let apiKey: string | null = null;
  let keyUnreadable = false;
  let keyError: string | null = null;

  if (row?.geminiApiKeyEnc) {
    try {
      apiKey = decrypt(row.geminiApiKeyEnc);
    } catch (err) {
      keyUnreadable = true;
      keyError =
        err instanceof ConfigError
          ? err.message
          : "Stored key could not be decrypted (APP_SECRET changed?). Re-enter it.";
    }
  }

  return {
    apiKey,
    keyHint: row?.geminiApiKeyHint ?? null,
    keyUnreadable,
    keyError,
    models: parseModelList(row?.geminiModels),
    modelsCustomised: Boolean(row?.geminiModels),
  };
}
