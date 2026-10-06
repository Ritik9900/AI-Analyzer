from fastapi import APIRouter

from app.schemas import PortfolioAnalytics, PortfolioRequest
from app.services import portfolio

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.post("/analytics", response_model=PortfolioAnalytics)
def analytics(body: PortfolioRequest) -> PortfolioAnalytics:
    return portfolio.analyze(body.holdings, body.window_days)
