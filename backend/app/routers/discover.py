from fastapi import APIRouter, HTTPException

from app.schemas import DiscoverRequest, DiscoverResponse
from app.services import discover

router = APIRouter(prefix="/discover", tags=["discover"])


@router.get("/options")
def options() -> dict:
    return discover.options()


@router.post("", response_model=DiscoverResponse)
def run(body: DiscoverRequest) -> DiscoverResponse:
    try:
        return discover.run(body)
    except discover.DiscoverError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
