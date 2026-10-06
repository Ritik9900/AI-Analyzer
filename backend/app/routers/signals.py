"""Signal pipelines.

POST /signals/position — 6mo history -> RSI/MACD/ATR/S&R -> Chronos 14-day forecast
POST /signals/analyze  — the above + FinBERT sentiment over recent headlines
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.schemas import AnalyzeSignals, PositionSignals, PricePoint, TickerRequest
from app.services import forecast, market_data, sentiment, technicals

router = APIRouter(prefix="/signals", tags=["signals"])


def _base_signals(ticker: str) -> dict:
    try:
        df = market_data.get_history(ticker)
        tech = technicals.compute_technicals(df)
    except market_data.TickerNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except technicals.InsufficientHistory as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "ticker": ticker,
        "currency": market_data.get_currency(ticker),
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "history": [
            PricePoint(date=idx.strftime("%Y-%m-%d"), close=round(float(c), 4)) for idx, c in df["Close"].items()
        ],
        "technicals": tech,
        "forecast": forecast.forecast(df),
    }


@router.post("/position", response_model=PositionSignals)
def position_signals(body: TickerRequest) -> PositionSignals:
    return PositionSignals(**_base_signals(body.ticker.upper()))


@router.post("/analyze", response_model=AnalyzeSignals)
def analyze_signals(body: TickerRequest) -> AnalyzeSignals:
    ticker = body.ticker.upper()
    base = _base_signals(ticker)
    return AnalyzeSignals(
        **base,
        name=market_data.get_name(ticker),
        sentiment=sentiment.analyze(market_data.get_headlines(ticker)),
    )
