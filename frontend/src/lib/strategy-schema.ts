import { Type, type Schema } from "@google/genai";
import { z } from "zod";

// Long-term equity investing strategies. Each has two mirrored definitions:
//   - a Gemini responseSchema (constrains generation)
//   - a zod schema (validates what actually came back, since models don't always comply)

const nullableNumber = z.number().nullish().transform((v) => v ?? null);
const confidence = z.enum(["LOW", "MEDIUM", "HIGH"]);
const priceLevel = z.object({ label: z.string(), price: z.number() });
const zone = z
  .object({ low: z.number(), high: z.number() })
  .transform((v) => (v.low <= v.high ? v : { low: v.high, high: v.low }));

export const VERDICTS = ["POSITIVE", "NEUTRAL", "NEGATIVE", "UNKNOWN"] as const;
const scorecard = z.array(z.object({ area: z.string(), verdict: z.enum(VERDICTS), note: z.string() })).default([]);
const invalidation = z.object({ price: nullableNumber, condition: z.string() });

// --- Position (portfolio "AI Strategy") -----------------------------------------------

export const POSITION_STANCES = ["ACCUMULATE", "HOLD", "REVIEW_THESIS", "TRIM", "EXIT"] as const;

export const positionStrategySchema = z.object({
  stance: z.enum(POSITION_STANCES),
  confidence,
  summary: z.string().min(1),
  scorecard,
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
  thesisInvalidation: invalidation,
  fairValue: zone.nullish().transform((v) => v ?? null),
  targets: z.array(priceLevel).default([]),
  horizon: z.string(),
  reviewTrigger: z.string(),
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

const geminiScorecard: Schema = {
  type: Type.ARRAY,
  description: "One row each for: Business quality, Valuation, Long-term trend, Risk (and News sentiment if provided)",
  items: {
    type: Type.OBJECT,
    properties: {
      area: { type: Type.STRING },
      verdict: { type: Type.STRING, enum: [...VERDICTS] },
      note: { type: Type.STRING, description: "One sentence citing the specific numbers" },
    },
    required: ["area", "verdict", "note"],
  },
};

const geminiInvalidation: Schema = {
  type: Type.OBJECT,
  description: "What would prove the investment thesis wrong. A long-term exit condition, not a tight stop-loss.",
  properties: {
    price: { type: Type.NUMBER, nullable: true, description: "Price level, if the condition is price-based" },
    condition: { type: Type.STRING, description: "e.g. 'Monthly close below the 52-week low AND F-Score falls below 4'" },
  },
  required: ["condition"],
};

export const positionGeminiSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    stance: { type: Type.STRING, enum: [...POSITION_STANCES] },
    confidence: geminiConfidence,
    summary: { type: Type.STRING, description: "3-5 sentences, plain institutional language" },
    scorecard: geminiScorecard,
    actions: {
      type: Type.ARRAY,
      description: "1-4 concrete steps. For accumulation, staggered tranches at different price levels.",
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, description: "e.g. 'Buy tranche 1', 'Hold', 'Sell partial', 'Rebalance'" },
          price: { type: Type.NUMBER, nullable: true },
          quantity: { type: Type.NUMBER, nullable: true, description: "Whole shares" },
          rationale: { type: Type.STRING },
        },
        required: ["action", "rationale"],
      },
    },
    thesisInvalidation: geminiInvalidation,
    fairValue: { ...geminiZone(true), description: "12-24 month fair value range, if the inputs support one" },
    targets: { type: Type.ARRAY, items: geminiPriceLevel, description: "12-24 month price levels, nearest first" },
    horizon: { type: Type.STRING, description: "e.g. '3-5 years'" },
    reviewTrigger: { type: Type.STRING, description: "When to revisit, e.g. 'After the next quarterly results'" },
    risks: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["stance", "confidence", "summary", "scorecard", "actions", "thesisInvalidation", "targets", "horizon", "reviewTrigger", "risks"],
};

// --- Analyzer (single stock, new long-term investment) --------------------------------

export const ANALYZER_STANCES = ["BUY", "ACCUMULATE_GRADUALLY", "WATCHLIST", "AVOID"] as const;

export const analyzerStrategySchema = z.object({
  stance: z.enum(ANALYZER_STANCES),
  confidence,
  summary: z.string().min(1),
  scorecard,
  accumulationZone: zone,
  tranches: z.array(z.object({ price: z.number(), allocationPct: z.number(), note: z.string() })).min(1),
  thesisInvalidation: invalidation,
  fairValue: zone.nullish().transform((v) => v ?? null),
  targets: z.array(priceLevel).default([]),
  horizon: z.string(),
  maxPortfolioWeightPct: z.number().positive().max(100),
  reviewTrigger: z.string(),
  rationale: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});

export type AnalyzerStrategy = z.infer<typeof analyzerStrategySchema>;

export const analyzerGeminiSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    stance: { type: Type.STRING, enum: [...ANALYZER_STANCES] },
    confidence: geminiConfidence,
    summary: { type: Type.STRING, description: "3-5 sentences, plain institutional language" },
    scorecard: geminiScorecard,
    accumulationZone: { ...geminiZone(false), description: "Price range in which to build the position" },
    tranches: {
      type: Type.ARRAY,
      description: "2-4 staggered buys; allocationPct values sum to 100",
      items: {
        type: Type.OBJECT,
        properties: {
          price: { type: Type.NUMBER },
          allocationPct: { type: Type.NUMBER },
          note: { type: Type.STRING },
        },
        required: ["price", "allocationPct", "note"],
      },
    },
    thesisInvalidation: geminiInvalidation,
    fairValue: { ...geminiZone(true), description: "12-24 month fair value range, if the inputs support one" },
    targets: { type: Type.ARRAY, items: geminiPriceLevel, description: "12-24 month price levels, nearest first" },
    horizon: { type: Type.STRING, description: "e.g. '3-5 years'" },
    maxPortfolioWeightPct: { type: Type.NUMBER, description: "Suggested cap for this stock as % of portfolio, e.g. 5" },
    reviewTrigger: { type: Type.STRING },
    rationale: { type: Type.ARRAY, items: { type: Type.STRING } },
    risks: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    "stance",
    "confidence",
    "summary",
    "scorecard",
    "accumulationZone",
    "tranches",
    "thesisInvalidation",
    "targets",
    "horizon",
    "maxPortfolioWeightPct",
    "reviewTrigger",
    "rationale",
    "risks",
  ],
};

// --- Connection test ------------------------------------------------------------------

export const pingSchema = z.object({ ok: z.boolean() });
export const pingGeminiSchema: Schema = {
  type: Type.OBJECT,
  properties: { ok: { type: Type.BOOLEAN } },
  required: ["ok"],
};
