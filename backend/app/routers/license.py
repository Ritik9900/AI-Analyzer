from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.licensing.manager import get_manager

router = APIRouter(prefix="/license", tags=["license"])


class ActivateRequest(BaseModel):
    key: str = Field(min_length=10, max_length=4000)


@router.get("/status")
def status() -> dict:
    return get_manager().status(force=True)


@router.post("/activate")
def activate(body: ActivateRequest) -> dict:
    return get_manager().activate(body.key)
