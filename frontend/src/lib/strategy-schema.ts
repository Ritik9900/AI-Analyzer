import { Type, type Schema } from "@google/genai";
import { z } from "zod";

// Each strategy has two mirrored definitions:
//   - a Gemini responseSchema (constrains generation)
//   - a zod schema (validates what actually came back, since models don't always comply)

const nullableNumber = z.number().nullish().transform((v) => v ?? null);
const confidence = z.enum(["LOW", "MEDIUM", "HIGH"]);
const priceLevel = z.object({ label: z.string(), price: z.number() });
const zone = z
  .object({ low: z.number(), high: z.number() })
  .transform((v) => (v.low <= v.high ? v : { low: v.high, high: v.low }));

// --- Position (portfolio "AI Strategy") -----------------------------------------------

export const POSITION_STANCES = ["AVERAGE_DOWN", "HOLD", "CUT_LOSS", "TRAIL_STOP", "TAKE_PARTIAL_PROFIT", "EXIT"] as const;

export const positionStrategySchema = z.object({
  stance: z.enum(POSITION_STANCES),
  confidence,
  summary: z.string().min(1),
  actions: z
    .array(
      z.object({
        action: z.string(),
        price: nullableNumber,
        quantity: nullableNumber,
        rationale: z.string(),
      }),
    )
    .min(1),
  stopLoss: nullableNumber,
  trailingStopPct: nullableNumber,
  averageDownZone: zone.nullish().transform((v) => v ?? null),
  targets: z.array(priceLevel).default([]),
  reviewInDays: z.number().int().positive().default(7),
  risks: z.array(z.string()).default([]),
});

export type PositionStrategy = z.infer<typeof positionStrategySchema>;

const geminiPriceLevel: Schema = {
  type: Type.OBJECT,
  properties: { label: { type: Type.STRING }, price: { type: Type.NUMBER } },
  required: ["label", "price"],
};

const geminiZone = (nullable: boolean): Schema => ({
  type: Type.OBJECT,
  nullable,
  properties: { low: { type: Type.NUMBER }, high: { type: Type.NUMBER } },
  required: ["low", "high"],
});

const geminiConfidence: Schema = { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH"] };

export const positionGeminiSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    stance: { type: Type.STRING, enum: [...POSITION_STANCES] },
    confidence: geminiConfidence,
    summary: { type: Type.STRING, description: "2-4 sentences, plain institutional language" },
    actions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, description: "e.g. 'Buy', 'Sell', 'Set stop-loss', 'Trail stop'" },
          price: { type: Type.NUMBER, nullable: true },
          quantity: { type: Type.NUMBER, nullable: true },
          rationale: { type: Type.STRING },
        },
        required: ["action", "rationale"],
      },
    },
    stopLoss: { type: Type.NUMBER, nullable: true },
    trailingStopPct: { type: Type.NUMBER, nullable: true },
    averageDownZone: geminiZone(true),
    targets: { type: Type.ARRAY, items: geminiPriceLevel },
    reviewInDays: { type: Type.INTEGER },
    risks: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["stance", "confidence", "summary", "actions", "targets", "reviewInDays", "risks"],
};

// --- Analyzer (single stock entry strategy) -------------------------------------------

export const ANALYZER_STANCES = ["BUY", "ACCUMULATE_ON_DIPS", "WAIT", "AVOID"] as const;

export const analyzerStrategySchema = z.object({
  stance: z.enum(ANALYZER_STANCES),
  confidence,
  summary: z.string().min(1),
  buyZone: zone,
  stopLoss: z.number(),
  targets: z.array(priceLevel).min(1),
  holdDuration: z.string(),
  rationale: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});

export type AnalyzerStrategy = z.infer<typeof analyzerStrategySchema>;

export const analyzerGeminiSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    stance: { type: Type.STRING, enum: [...ANALYZER_STANCES] },
    confidence: geminiConfidence,
    summary: { type: Type.STRING, description: "2-4 sentences, plain institutional language" },
    buyZone: geminiZone(false),
    stopLoss: { type: Type.NUMBER },
    targets: { type: Type.ARRAY, items: geminiPriceLevel },
    holdDuration: { type: Type.STRING, description: "e.g. '2-3 weeks'" },
    rationale: { type: Type.ARRAY, items: { type: Type.STRING } },
    risks: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["stance", "confidence", "summary", "buyZone", "stopLoss", "targets", "holdDuration", "rationale", "risks"],
};

// --- Connection test ------------------------------------------------------------------

export const pingSchema = z.object({ ok: z.boolean() });
export const pingGeminiSchema: Schema = {
  type: Type.OBJECT,
  properties: { ok: { type: Type.BOOLEAN } },
  required: ["ok"],
};
