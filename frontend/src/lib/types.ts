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

export interface LongTerm {
  years_of_data: number;
  sma_50: number | null;
  sma_200: number | null;
  price_vs_sma200_pct: number | null;
  trend: "uptrend" | "downtrend" | "sideways" | "unknown";
  high_52w: number;
  low_52w: number;
  pct_from_52w_high: number;
  pct_from_52w_low: number;
  return_1y_pct: number | null;
  cagr_3y_pct: number | null;
  cagr_5y_pct: number | null;
  momentum_12_1_pct: number | null;
  volatility_1y_pct: number | null;
  max_drawdown_pct: number;
  current_drawdown_pct: number;
  rsi_weekly_14: number | null;
  weekly_support: number[];
  weekly_resistance: number[];
  benchmark: string | null;
  benchmark_return_1y_pct: number | null;
  relative_return_1y_pct: number | null;
  beta_1y: number | null;
}

export interface PiotroskiTest {
  name: string;
  passed: boolean | null;
}

export interface Fundamentals {
  available: boolean;
  sector: string | null;
  industry: string | null;
  market_cap: number | null;
  pe_trailing: number | null;
  pe_forward: number | null;
  price_to_book: number | null;
  peg: number | null;
  roe_pct: number | null;
  roa_pct: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  gross_margin_pct: number | null;
  operating_margin_pct: number | null;
  profit_margin_pct: number | null;
  revenue_growth_pct: number | null;
  earnings_growth_pct: number | null;
  dividend_yield_pct: number | null;
  payout_ratio_pct: number | null;
  free_cash_flow: number | null;
  analyst_target_mean: number | null;
  analyst_target_low: number | null;
  analyst_target_high: number | null;
  analyst_upside_pct: number | null;
  analyst_rating: string | null;
  analyst_count: number | null;
  piotroski_score: number | null;
  piotroski_max: number | null;
  piotroski_tests: PiotroskiTest[];
  fiscal_year: string | null;
  note: string | null;
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
  frequency: "daily" | "weekly";
  horizon_periods: number;
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
  name: string | null;
  currency: string | null;
  as_of: string;
  /** Weekly closes, up to ~5 years. */
  history: PricePoint[];
  long_term: LongTerm;
  fundamentals: Fundamentals;
  /** Daily indicators over the last ~6 months: entry timing only. */
  technicals: Technicals;
  forecast: Forecast;
}

export interface AnalyzeSignals extends PositionSignals {
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
  /** Share of total portfolio market value (same-currency positions only); null if not computable. */
  portfolioWeightPct: number | null;
  portfolioPositions: number;
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
