import re

from fastapi import APIRouter, HTTPException

from app.schemas import TICKER_PATTERN, QuotesRequest, QuotesResponse, SearchRequest, SearchResponse
from app.services import market_data

router = APIRouter(tags=["quotes"])
_ticker_re = re.compile(TICKER_PATTERN)


@router.post("/quotes", response_model=QuotesResponse)
def quotes(body: QuotesRequest) -> QuotesResponse:
    bad = [t for t in body.tickers if not _ticker_re.match(t)]
    if bad:
        raise HTTPException(status_code=422, detail=f"Invalid ticker(s): {', '.join(bad[:5])}")
    if not body.tickers:
        return QuotesResponse(quotes=[])
    return QuotesResponse(quotes=market_data.get_quotes(body.tickers))


@router.post("/search", response_model=SearchResponse)
def search(body: SearchRequest) -> SearchResponse:
    return SearchResponse(results=market_data.search_symbols(body.query.strip()))
