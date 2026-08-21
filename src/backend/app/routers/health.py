from fastapi import APIRouter

from ..config import settings

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health():
    return {"status": "ok", "brain": settings.BRAIN_PROVIDER}
