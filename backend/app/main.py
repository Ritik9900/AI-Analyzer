"""Signals service: market data, technical indicators and local ML inference.

Stateless by design — it holds no secrets and no database. Only the Next.js
server calls it (server-to-server), so it binds to 127.0.0.1 and needs no CORS.
"""

import logging

from fastapi import FastAPI

from app.config import settings  # first import: sets HF offline env vars
from app.routers import portfolio, quotes, signals
from app.services import forecast, sentiment

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Portfolio Analyzer — Signals Service", version="0.2.0")
app.include_router(quotes.router)
app.include_router(signals.router)
app.include_router(portfolio.router)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "local_models_enabled": settings.enable_local_models,
        "chronos_present": settings.chronos_path.exists(),
        "finbert_present": settings.finbert_path.exists(),
        "chronos": forecast.status(),
        "finbert": sentiment.status(),
    }
