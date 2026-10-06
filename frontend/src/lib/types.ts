// Mirrors backend/app/schemas.py — keep in sync.

export interface Quote {
  ticker: string;
  price: number | null;
  previous_close: number | null;
  currency: string | null;
  error: string | null;
}

export interface SymbolMatch {
  symbol: string;
  name: string | null;
  exchange: string | null;
  type: string | null;
}

export interface PricePoint {
  date: string;
  close: number;
}

export interface Technicals {
  indicator_engine: "pandas-ta" | "pandas";
  last_close: number;
  sma_20: number | null;
  sma_50: number | null;
  rsi_14: number | null;
  rsi_state: "overbought" | "oversold" | "neutral" | "unknown";
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  macd_trend: "bullish" | "bearish" | "unknown";
  macd_crossover: "bullish" | "bearish" | "none";
  macd_crossover_bars_ago: number | null;
  atr_14: number | null;
  volatility_annual_pct: number | null;
  support: number[];
  resistance: number[];
  high_period: number;
  low_period: number;
  change_period_pct: number;
}

export interface ForecastPoint {
  date: string;
  p10: number;
  p50: number;
  p90: number;
}

export interface Forecast {
  model: string;
  is_mock: boolean;
  horizon_trading_days: number;
  points: ForecastPoint[];
  expected_return_pct: number;
  p10_end: number;
  p90_end: number;
  note: string | null;
}

export interface Headline {
  title: string;
  publisher: string | null;
  published_at: string | null;
  link: string | null;
  label: "positive" | "negative" | "neutral";
  score: number;
}

export interface Sentiment {
  model: string;
  is_mock: boolean;
  score: number;
  label: "positive" | "negative" | "neutral";
  headlines: Headline[];
  note: string | null;
}

export interface PositionSignals {
  ticker: string;
  currency: string | null;
  as_of: string;
  history: PricePoint[];
  technicals: Technicals;
  forecast: Forecast;
}

export interface AnalyzeSignals extends PositionSignals {
  name: string | null;
  sentiment: Sentiment;
}

// --- Next.js API shapes ---------------------------------------------------------------

export interface PositionRow {
  id: number;
  ticker: string;
  avgBuyPrice: number;
  quantity: number;
  price: number | null;
  currency: string | null;
  costBasis: number;
  marketValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  dayChangePct: number | null;
}

export interface PositionFacts {
  ticker: string;
  quantity: number;
  avgBuyPrice: number;
  lastPrice: number;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  status: "PROFIT" | "LOSS" | "FLAT";
}

export interface GeminiAttempt {
  model: string;
  ok: boolean;
  error?: string;
}

export interface StrategyMeta {
  source: "gemini" | "rule-based";
  model: string | null;
  attempts: GeminiAttempt[];
  fallbackReason?: string;
  reportId?: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
  /** Present on UNKNOWN_TICKER / 404 errors. */
  suggestions?: SymbolMatch[];
}
