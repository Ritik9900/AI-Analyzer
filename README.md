# Portfolio Analyzer & AI Advisor

A local-first stock portfolio tracker for **long-term equity investors**. It combines fundamentals
(including a Piotroski F-Score), multi-year trend and risk metrics, CPU-friendly Hugging Face models and
Google Gemini to produce position reviews and new-investment cases with staggered buying plans, plus
a **Portfolio Insights** dashboard (allocation, sector mix, P/L, performance vs the index, risk and
correlation).

> **Disclaimer:** This software is for informational and educational purposes only and is not
> financial advice. Forecasts and AI-generated strategies can be wrong. Consult a qualified financial
> adviser before making investment decisions.

---

## Architecture

```
 Browser ──► Next.js (App Router, :3000) ──────────────► Google Gemini API
              │  • UI (Tailwind, lucide-react)
              │  • Route handlers (server-side only)
              │  • Prisma ► SQLite (positions, encrypted API key, report audit log)
              │
              └──► FastAPI signals service (127.0.0.1:8000, server-to-server)
                     • yfinance        – 5y prices, index, financials, headlines
                     • long-term       – 200-DMA trend, CAGR, drawdown, beta, relative return
                     • fundamentals    – valuation, quality, Piotroski F-Score
                     • pandas-ta       – daily RSI/MACD (tranche timing only)
                     • Chronos-Bolt    – 26-week projection on weekly closes (mock if not loaded)
                     • FinBERT         – headline sentiment      (mock if not loaded)
                     • portfolio       – risk contribution, correlation, HRP, vs-index series
```

- **FastAPI is stateless.** It holds no secrets and no database. It returns numbers only.
- **Next.js owns the data and the Gemini call.** It reads the encrypted Gemini key from SQLite,
  calls FastAPI for signals, sends those signals to Gemini, and stores both in `StrategyReport`
  for auditability. The API key never reaches the browser.
- **Mock mode:** with `ENABLE_LOCAL_MODELS=false` (the default), or when model files are missing,
  the backend returns clearly-flagged mock forecast/sentiment (`"is_mock": true`). The UI shows a
  "mock data" badge and the Gemini prompt is told the forecast is synthetic.
- **No runtime downloads:** the backend sets `HF_HUB_OFFLINE=1` and loads models only from local
  folders under `backend/models/`. It will never fetch weights from the internet on its own. You
  download them once, explicitly, with the commands in Step 4.
- **Gemini fallback chain:** see [Gemini reliability](#gemini-reliability-model-fallback) below.

## Investment approach

The advisor is built for **buy-and-hold investors in cash equities**, not traders. It never suggests
leverage, F&O, intraday or swing trades, and it uses thesis-based exits instead of tight stop-losses.

| Input (priority order) | What is used                                                                  |
|------------------------|-------------------------------------------------------------------------------|
| 1. Business quality    | Piotroski F-Score (9 tests on annual statements), ROE/ROA, margins, debt, FCF  |
| 2. Valuation           | Trailing/forward P/E, P/B, PEG, analyst target range and upside                |
| 3. Long-term trend     | Price vs 200-day average, 52-week range, 1y/3y/5y returns, 12-1 momentum, return vs NIFTY 50 / S&P 500 |
| 4. Risk                | 1y volatility, max drawdown, beta, **your portfolio weight** in the stock      |
| Timing only            | Daily RSI/MACD and support levels, used to place buy tranches                   |
| Weak context           | Chronos 26-week projection, FinBERT headline sentiment                          |

Outputs are a stance (Accumulate / Hold / Review thesis / Trim / Exit, or Buy / Accumulate gradually /
Watchlist / Avoid for new ideas), a scorecard, staggered buy tranches or rebalancing steps, the condition
that would break the thesis, a 12-24 month view and a review trigger (e.g. next quarterly results).

Notes on the data:
- Returns are **price returns** and exclude dividends. Dividend yield is shown separately.
- Yahoo data for some Indian stocks, especially banks, is incomplete. The F-Score is shown as
  `score / tests-with-data`, and bank-irrelevant ratios are hidden.
- Price forecasts from time-series foundation models barely beat a random walk for stock prices
  ([Noguer i Alonso & Franklin, 2026](https://ideas.repec.org/p/arx/papers/2606.27100.html)), so the
  forecast is deliberately a minor input.

## Portfolio Insights

The **Insights** page (`/insights`) analyses all holdings together. A period switch (3M / 6M / 1Y) at the
top scopes every period-based chart.

| Section | What it shows |
|---|---|
| Key figures | Market value, unrealised and today's P/L, return vs the index, volatility, beta, max drawdown, effective number of holdings, estimated dividends |
| Key observations | Rule-based findings (no AI): concentration, sector overweight, holdings that add outsized risk, highly correlated pairs, under/over-performance, biggest loss contributor, how many holdings sit below their 200-day average |
| Allocation | Share of each stock or sector, by current value or by amount invested, with a concentration ceiling line |
| Profit / loss by holding | Diverging bars of unrealised gain/loss |
| Portfolio vs index | Today's holdings vs NIFTY 50 / S&P 500, both indexed to 100 |
| Where your risk comes from | Share of value vs share of portfolio volatility per holding |
| How holdings move together | Correlation heatmap of daily returns |
| Risk-balanced reference weights | Hierarchical Risk Parity weights vs current weights (a reference, not advice) |
| Holdings detail | Sortable table with return, volatility, beta, distance from the 200-day average, dividend yield and risk share |

Every chart has hover/keyboard tooltips and a table equivalent. Holdings in a currency other than the
main one are listed as excluded (no FX conversion).

## Project structure

```
.
├── README.md
├── backend/                      FastAPI signals service
│   ├── requirements.txt          core deps (no torch)
│   ├── requirements-ml.txt       ML deps (install only where you run the models)
│   ├── .env.example
│   ├── models/                   (git-ignored) downloaded HF weights live here
│   └── app/
│       ├── main.py               app + /health
│       ├── config.py             env-driven settings, model toggle
│       ├── schemas.py            request/response contracts
│       ├── routers/              quotes.py, signals.py, portfolio.py
│       └── services/             market_data.py, technicals.py, longterm.py, fundamentals.py,
│                                 forecast.py, sentiment.py, portfolio.py
└── frontend/                     Next.js app
    ├── package.json
    ├── .env.example
    ├── prisma/schema.prisma      AppSettings, Position, StrategyReport
    └── src/
        ├── app/                  / (portfolio), /insights, /analyze, /settings, /api/*
        ├── components/           PortfolioTable, InsightsView, StrategyDrawer, StrategyView,
        │                         SignalsPanel, ForecastChart, AnalyzeView, SettingsForm, ui
        │   └── charts/           BarList, DivergingBars, PairedBars, Dumbbell, LineCompare, Heatmap
        └── lib/
            ├── gemini.ts         model fallback chain + model discovery
            ├── prompts.ts        system instruction + position/analyzer prompts
            ├── strategy-schema.ts  Gemini responseSchema + zod validation
            ├── fallback-strategy.ts  rule-based strategy when all models fail
            ├── ai-pipeline.ts    lock check → Gemini → fallback → audit log
            ├── insights.ts       portfolio KPIs, sectors and rule-based observations
            ├── reports.ts        reading saved strategies back (skips outdated formats)
            ├── crypto.ts         AES-256-GCM for the API key
            └── backend.ts        FastAPI client
```

## API reference

**FastAPI (127.0.0.1:8000)**: interactive docs at http://127.0.0.1:8000/docs

| Method | Path                | Returns                                                     |
|--------|---------------------|-------------------------------------------------------------|
| GET    | `/health`           | Model toggle, files present, load status / errors            |
| POST   | `/search`           | `{query}` → fuzzy symbol search by name or ticker            |
| POST   | `/quotes`           | `{tickers: [...]}` → latest price, previous close, currency   |
| POST   | `/signals/position` | `{ticker}` → long-term metrics, fundamentals, timing, forecast |
| POST   | `/signals/analyze`  | `{ticker}` → the above + name + FinBERT headline sentiment    |
| POST   | `/portfolio/analytics` | `{holdings, window_days}` → series vs index, risk share, correlation, HRP |

**Next.js (localhost:3000)**

| Method             | Path                    | Purpose                                         |
|--------------------|-------------------------|-------------------------------------------------|
| GET / POST         | `/api/positions`        | List with live P/L / add position               |
| PATCH / DELETE     | `/api/positions/:id`    | Edit avg price & quantity / remove              |
| GET / PUT / DELETE | `/api/settings`         | Key status (never the key) / save key or model chain / remove key |
| POST               | `/api/settings/test`    | Run a ping through the model chain              |
| GET                | `/api/settings/models`  | Discover Gemini models available to your key    |
| POST               | `/api/strategy/:id`     | Portfolio AI Strategy for one position          |
| POST               | `/api/analyze`          | Single-stock long-term investment case          |
| GET                | `/api/insights?window=1y` | Portfolio insights for 3m / 6m / 1y           |
| GET                | `/api/reports`          | Saved strategies (filter by kind / positionId)  |
| GET                | `/api/reports/:id`      | One saved strategy with the signals behind it   |

## Gemini reliability (model fallback)

Gemini model IDs get retired, rate-limited (429) or overloaded (503) fairly often. Each AI request
goes through a fallback chain in [frontend/src/lib/gemini.ts](frontend/src/lib/gemini.ts):

1. **Ordered chain.** Models are tried in order. The default is
   `gemini-2.5-flash → gemini-2.5-flash-lite → gemini-2.0-flash`. Change it in **Settings → Model
   fallback chain** or with `GEMINI_MODELS` in `frontend/.env`.
2. **Per-error handling:**

   | Error                                              | Action                                  |
   |----------------------------------------------------|-----------------------------------------|
   | 429 / 5xx / timeout / network                      | Retry same model once (backoff), then next |
   | 404 / 403 / "not found" / "not supported"          | Skip to next model immediately           |
   | Invalid JSON or schema-invalid output, empty/blocked | Skip to next model                      |
   | Invalid API key (401 / `API_KEY_INVALID`)          | Stop and ask you to fix the key in Settings |

3. **Auto-discovery.** If *every* configured model ID is unavailable (retired), the app calls
   `models.list()` with your key and tries up to two of the newest stable Flash/Pro models.
4. **Rule-based last resort.** If all of that fails, you still get a strategy computed from fixed
   rules (MACD, forecast direction, RSI, ATR, support/resistance). It is clearly labelled
   **"Rule-based fallback"**, always `LOW` confidence.
5. **Transparency.** Every result shows which model answered. Expand **Model fallback log** to see
   each attempt and why it failed. Use **Settings → Test connection** to check the chain at any time.

The whole chain has a 120-second budget. Every result, Gemini or rule-based, is stored in the
`StrategyReport` table together with the exact signals that produced it. Browse it with
`npm run db:studio`.

---

## Setup

### Prerequisites

| Tool    | Version                                  |
|---------|------------------------------------------|
| Node.js | 20.9 or newer                            |
| Python  | **3.12** recommended (3.11 also works)   |
| Disk    | ~2 GB free if you install torch + models |

Python 3.13/3.14 may not yet have wheels for every dependency (notably torch). Use 3.12 to avoid
build issues.

### Step 1: Backend core environment

**Windows (PowerShell)**
```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

**macOS / Linux**
```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

At this point the backend runs in **mock ML mode**. You can stop here on any machine where you
can't or don't want to download models.

### Step 2: Run the backend

```bash
# from backend/, with the venv active
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Check it: open http://127.0.0.1:8000/health. Expected output in mock mode:
```json
{"status":"ok","local_models_enabled":false,"chronos_present":false,"finbert_present":false,
 "chronos":{"loaded":false,"error":null},"finbert":{"loaded":false,"error":null}}
```
Models load lazily on the first forecast/sentiment request, so `loaded` stays `false` until then.

### Step 3: Install ML dependencies (personal laptop only)

Install the **CPU-only** build of PyTorch first. It is much smaller than the default CUDA build:

```bash
# from backend/, with the venv active
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-ml.txt
```

Verify:
```bash
python -c "import torch, transformers, chronos; print(torch.__version__, transformers.__version__)"
```

### Step 4: Download the Hugging Face models (personal laptop only)

Both models are public, so no Hugging Face token is required. Sizes are approximate.

| Model                        | Purpose                    | Size    |
|------------------------------|----------------------------|---------|
| `amazon/chronos-bolt-small`  | 26-week price projection   | ~190 MB |
| `ProsusAI/finbert`           | Financial news sentiment   | ~440 MB |

Run from `backend/` with the venv active. `hf` is the CLI installed by `huggingface_hub`.

```bash
hf download amazon/chronos-bolt-small --local-dir models/chronos-bolt-small

# FinBERT: skip the TensorFlow/Flax weights, since only the PyTorch weights are needed
hf download ProsusAI/finbert --local-dir models/finbert --include "*.json" "*.txt" "*.bin" "*.safetensors"
```

> On older `huggingface_hub` versions, use `huggingface-cli download ...` with the same arguments.

Expected layout:
```
backend/models/
├── chronos-bolt-small/   config.json, model.safetensors, ...
└── finbert/              config.json, vocab.txt, pytorch_model.bin (or model.safetensors), ...
```

### Step 5: Enable the local models

Edit `backend/.env`:
```
ENABLE_LOCAL_MODELS=true
```

Restart uvicorn and check `/health`. You should see `true` for all three flags. On first request,
each model takes a few seconds to load into memory. After that, inference on CPU typically takes
well under a second per ticker for Chronos-Bolt-Small. If a model fails to load, the service logs the
error and falls back to mock output, so the app never hard-fails.

### Step 6: Frontend

**Windows (PowerShell)**
```powershell
cd frontend
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# paste the output into APP_SECRET in frontend/.env
npm install
npx prisma migrate dev --name init
npm run dev
```

**macOS / Linux**
```bash
cd frontend
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# paste the output into APP_SECRET in frontend/.env
npm install
npx prisma migrate dev --name init
npm run dev
```

Open http://localhost:3000.

### Step 7: Add your Gemini API key

1. Create a key at https://aistudio.google.com/apikey.
2. In the app, go to **Settings**, paste the key and click **Save**.
3. The key is encrypted with `APP_SECRET` (AES-256-GCM) before it is written to SQLite. Only the
   last 4 characters are ever shown in the UI.

The **AI Strategy** and **Analyze** features stay locked until a key is saved.

> If you lose or change `APP_SECRET`, the stored key can no longer be decrypted. Re-enter it in
> Settings.

---

## Running day-to-day

Use two terminals:

```bash
# Terminal 1: backend
cd backend && .venv/Scripts/activate   # or: source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal 2: frontend
cd frontend && npm run dev
```

## Updating after `git pull`

Run these on any machine that already has the app set up, every time you pull new code. Each step is
safe to re-run even when nothing changed.

**1. Stop both servers**, then pull:
```bash
git pull
```

**2. Backend dependencies** (new Python packages, if any):

Windows (PowerShell)
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# only on the machine that runs the local models:
pip install -r requirements-ml.txt
```
macOS / Linux
```bash
cd backend && source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-ml.txt   # local-models machine only
```

**3. Compare `backend/.env` with `backend/.env.example`** and copy over any new keys. Settings you
leave out fall back to safe defaults.

**4. Frontend dependencies and database migrations:**
```bash
cd frontend
cp prisma/dev.db prisma/dev.db.bak        # optional backup (PowerShell: Copy-Item prisma\dev.db prisma\dev.db.bak)
npm install                               # also runs `prisma generate` (postinstall)
npx prisma migrate deploy                 # applies any new migrations in prisma/migrations
```
- `prisma migrate deploy` applies only migrations that have not run yet. It never deletes data or
  resets the database, and it prints `No pending migrations to apply` when the schema is unchanged.
- Use `npx prisma migrate dev` only when **you** change `schema.prisma` yourself. It creates a new
  migration and may offer to reset the database if it detects drift.
- If `npm install` fails while downloading Prisma engines on a corporate network, see
  [Corporate networks](#corporate-networks-tls-inspection).

**5. Compare `frontend/.env` with `frontend/.env.example`** for new keys. Keep your existing
`APP_SECRET`: if it changes, the saved Gemini key can no longer be decrypted.

**6. Restart both servers** (see [Running day-to-day](#running-day-to-day)). Restart the backend after
every pull, because a failed model load is cached until restart.

**Quick check:** open http://127.0.0.1:8000/health and http://localhost:3000. If a page shows
stale data, hard-refresh the browser (Ctrl+Shift+R).

## Configuration reference

**backend/.env**

| Variable                | Default              | Meaning                                       |
|-------------------------|----------------------|-----------------------------------------------|
| `ENABLE_LOCAL_MODELS`   | `false`              | Load Chronos/FinBERT from `MODELS_DIR`         |
| `MODELS_DIR`            | `models`             | Relative to `backend/`                         |
| `CHRONOS_MODEL_SUBDIR`  | `chronos-bolt-small` |                                                |
| `FINBERT_MODEL_SUBDIR`  | `finbert`            |                                                |
| `FORECAST_HORIZON_WEEKS`| `26`                 | Weekly forecast horizon                        |
| `LOOKBACK_PERIOD`       | `5y`                 | yfinance period string for price history       |
| `TORCH_NUM_THREADS`     | `4`                  | CPU threads for inference                      |

**frontend/.env**

| Variable        | Meaning                                                  |
|-----------------|----------------------------------------------------------|
| `DATABASE_URL`  | SQLite path, relative to `prisma/`                        |
| `BACKEND_URL`   | FastAPI base URL (server-side only)                       |
| `APP_SECRET`    | Base64 32-byte key used to encrypt the Gemini key         |
| `GEMINI_MODELS` | Default comma-separated model fallback chain (Settings overrides it) |

## Corporate networks (TLS inspection)

If you see `unable to get local issuer certificate` or `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, your
network re-signs HTTPS traffic with a corporate root certificate. The OS trusts that certificate, but
Node's bundled certificate list does not. This affects Prisma engine downloads and Gemini API calls
made by the Next.js server.

**Fix (Node 22.15+ / 23.8+):** tell Node to also trust the OS certificate store. Certificate
verification stays fully enabled.

```bash
# once per machine: applies to npm install, npm run dev/build, and npx
npm config set node-options=--use-system-ca
```

Do **not** use `NODE_TLS_REJECT_UNAUTHORIZED=0` or `strict-ssl=false`. Those disable certificate
checking entirely.

## Troubleshooting

- **`pandas-ta` fails to install:** remove it from `requirements.txt`. The backend computes RSI and
  MACD with built-in pandas formulas when `pandas_ta` cannot be imported.
- **yfinance returns empty data:** Yahoo occasionally changes its endpoints. Run
  `pip install -U yfinance`. Corporate proxies may also block Yahoo Finance.
- **`/health` shows `*_present: false` after downloading:** check that the folder names under
  `backend/models/` match `CHRONOS_MODEL_SUBDIR` / `FINBERT_MODEL_SUBDIR`.
- **Prisma errors after a pull:** run `npm install` then `npx prisma migrate deploy` (see
  [Updating after git pull](#updating-after-git-pull)).
- **Every strategy says "Rule-based fallback":** open **Model fallback log** under the strategy.
  - All `model_unavailable`: use **Settings → Discover models** and add a current model ID.
  - All `retryable` (429): you've hit the free-tier quota. Wait, or add a different model to the chain.
- **"Gemini rejected the API key":** re-create the key in Google AI Studio and save it again.
- **"Stored key could not be decrypted":** `APP_SECRET` changed since the key was saved. Re-enter the key.
- **Model loaded but still mock:** `/health` shows the load error. Fix it, then restart uvicorn,
  because a failed load is cached until restart.
