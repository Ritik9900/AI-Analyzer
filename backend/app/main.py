"""Signals service: market data, technical indicators and local ML inference.

Stateless by design — it holds no secrets and no database. Only the Next.js
server calls it (server-to-server), so it binds to 127.0.0.1 and needs no CORS.

Packaged builds add two gates (see _build_flags.py):
- a per-launch shared token (PA_TOKEN) so other local programs can't use the service;
- licence enforcement: every data endpoint refuses to work without a valid licence.
"""

import hmac
import logging
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app import _build_flags
from app.config import settings  # first import: sets HF offline env vars
from app.licensing.manager import get_manager
from app.routers import license as license_router
from app.routers import discover, portfolio, quotes, signals
from app.services import forecast, sentiment

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

_packaged = bool(_build_flags.REQUIRE_LICENSE)
app = FastAPI(
    title="Portfolio Analyzer — Signals Service",
    version=_build_flags.BUILD_VERSION,
    # No interactive API docs in packaged builds.
    docs_url=None if _packaged else "/docs",
    redoc_url=None if _packaged else "/redoc",
    openapi_url=None if _packaged else "/openapi.json",
)

_OPEN_PATHS = ("/health", "/license/")


@app.middleware("http")
async def gatekeeper(request: Request, call_next):
    path = request.url.path
    token = os.environ.get("PA_TOKEN")
    if token and path != "/health" and not hmac.compare_digest(request.headers.get("x-pa-token", ""), token):
        return JSONResponse({"detail": "Forbidden"}, status_code=403)

    if get_manager().enforced and not path.startswith(_OPEN_PATHS):
        status = get_manager().status()
        if not status["valid"]:
            return JSONResponse({"detail": status["message"], "code": f"LICENSE_{status['state'].upper()}"}, status_code=403)

    return await call_next(request)


app.include_router(license_router.router)
app.include_router(quotes.router)
app.include_router(signals.router)
app.include_router(portfolio.router)
app.include_router(discover.router)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": _build_flags.BUILD_VERSION,
        "local_models_enabled": settings.enable_local_models,
        "chronos_present": settings.chronos_path.exists(),
        "finbert_present": settings.finbert_path.exists(),
        "chronos": forecast.status(),
        "finbert": sentiment.status(),
    }
