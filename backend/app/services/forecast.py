"""Chronos-Bolt 14-trading-day quantile forecast, with a clearly-flagged statistical mock.

The model is loaded lazily, once, from a local directory only. Any failure (toggle off,
files missing, torch not installed, inference error) degrades to the mock — never a 500.
"""

import logging
import math
import threading

import numpy as np
import pandas as pd

from app.config import settings
from app.schemas import Forecast, ForecastPoint

logger = logging.getLogger(__name__)

QUANTILES = [0.1, 0.5, 0.9]
Z_90 = 1.2816  # z-score of the 90th percentile

_pipeline = None
_load_error: str | None = None
_lock = threading.Lock()


def _load_pipeline():
    global _pipeline, _load_error
    if not settings.enable_local_models:
        return None
    if _pipeline is not None or _load_error is not None:
        return _pipeline
    with _lock:
        if _pipeline is None and _load_error is None:
            try:
                if not settings.chronos_path.exists():
                    raise FileNotFoundError(f"{settings.chronos_path} not found (see README step 4)")
                import torch
                from chronos import BaseChronosPipeline

                torch.set_num_threads(settings.torch_num_threads)
                _pipeline = BaseChronosPipeline.from_pretrained(str(settings.chronos_path), device_map="cpu")
                logger.info("Chronos loaded from %s", settings.chronos_path)
            except Exception as exc:  # noqa: BLE001
                _load_error = f"{type(exc).__name__}: {exc}"
                logger.warning("Chronos unavailable, using mock forecast: %s", _load_error)
    return _pipeline


def status() -> dict:
    return {"loaded": _pipeline is not None, "error": _load_error}


def _future_dates(last_date: pd.Timestamp, horizon: int) -> list[str]:
    start = pd.Timestamp(last_date).tz_localize(None).normalize() + pd.Timedelta(days=1)
    return [d.strftime("%Y-%m-%d") for d in pd.bdate_range(start, periods=horizon)]


def _chronos_quantiles(pipeline, closes: np.ndarray, horizon: int) -> np.ndarray:
    import torch

    context = torch.tensor(closes, dtype=torch.float32)
    quantiles, _mean = pipeline.predict_quantiles(context, prediction_length=horizon, quantile_levels=QUANTILES)
    arr = quantiles[0].detach().cpu().numpy() if hasattr(quantiles[0], "detach") else np.asarray(quantiles[0])
    arr = np.squeeze(np.asarray(arr, dtype=float))
    if arr.shape == (len(QUANTILES), horizon):
        arr = arr.T
    if arr.shape != (horizon, len(QUANTILES)):
        raise ValueError(f"Unexpected Chronos output shape {arr.shape}")
    return np.sort(arr, axis=1)  # guard against quantile crossing


def _mock_quantiles(closes: np.ndarray, horizon: int) -> np.ndarray:
    """Deterministic drift + volatility baseline (dampened 20-day drift, lognormal bands)."""
    log_ret = np.diff(np.log(closes))
    drift = float(np.mean(log_ret[-20:])) * 0.5 if len(log_ret) else 0.0
    sigma = float(np.std(log_ret[-60:])) if len(log_ret) > 1 else 0.02
    last = float(closes[-1])
    out = np.empty((horizon, 3))
    for i in range(horizon):
        t = i + 1
        median = last * math.exp(drift * t)
        spread = Z_90 * sigma * math.sqrt(t)
        out[i] = (median * math.exp(-spread), median, median * math.exp(spread))
    return out


def forecast(df: pd.DataFrame, horizon: int | None = None) -> Forecast:
    horizon = horizon or settings.forecast_horizon_days
    closes = df["Close"].to_numpy(dtype=float)
    last = float(closes[-1])

    pipeline = _load_pipeline()
    note = None
    if pipeline is not None:
        try:
            q = _chronos_quantiles(pipeline, closes, horizon)
            model, is_mock = "amazon/chronos-bolt-small", False
        except Exception as exc:  # noqa: BLE001
            logger.exception("Chronos inference failed; using mock")
            q, model, is_mock = _mock_quantiles(closes, horizon), "mock-drift-volatility", True
            note = f"Chronos inference failed ({type(exc).__name__}); synthetic baseline shown."
    else:
        q, model, is_mock = _mock_quantiles(closes, horizon), "mock-drift-volatility", True
        note = (
            "Local models disabled (ENABLE_LOCAL_MODELS=false); synthetic baseline shown."
            if not settings.enable_local_models
            else f"Chronos not loaded ({(_load_error or '').split(':', 1)[0]}); synthetic baseline shown. See /health."
        )

    dates = _future_dates(df.index[-1], horizon)
    points = [
        ForecastPoint(date=d, p10=round(row[0], 4), p50=round(row[1], 4), p90=round(row[2], 4))
        for d, row in zip(dates, q)
    ]
    return Forecast(
        model=model,
        is_mock=is_mock,
        horizon_trading_days=horizon,
        points=points,
        expected_return_pct=round((points[-1].p50 / last - 1) * 100, 2),
        p10_end=points[-1].p10,
        p90_end=points[-1].p90,
        note=note,
    )
