"""SA03-SA11, SA13 — System Admin. All routes here require the "admin" role
(see `require_admin`) — a moderator token gets 403. SA01/SA02 (login/logout)
are shared with Content Moderator at /moderation/login|logout (see
app/routers/moderation.py) since both roles use the same staff credential
store. SA13 (Manage Billing System Configuration) doesn't get its own
route — it's the `premium_monthly_price_cents`/`premium_annual_price_cents`/
`youtube_channel_allowlist` fields on the same GET/PATCH /system-settings
below as SA10/SA11, see app/models/admin.py's SystemSettings docstring.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.core import metrics
from app.core.config import get_settings
from app.core.deps import get_current_staff, require_admin
from app.models.admin import AdminUserDetail, AdminUserSummary, IntegrationStatus, SystemHealth, SystemSettings
from app.models.staff import StaffAccount
from app.repositories import catalogue as catalogue_repo
from app.repositories import children as children_repo
from app.repositories import parents as parents_repo
from app.repositories.store import COLLECTION_SYSTEM_SETTINGS, get_store

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(staff: StaffAccount) -> StaffAccount:
    require_admin(staff)
    return staff


@router.get("/users", response_model=list[AdminUserSummary])
def search_users(q: str | None = None, staff: StaffAccount = Depends(get_current_staff)) -> list[AdminUserSummary]:
    """SA04 — Search User Account. `q` matches email or display name
    (case-insensitive substring); omitted `q` lists everyone."""
    _require_admin(staff)
    parents = parents_repo.list_all_parents()
    if q:
        needle = q.lower()
        parents = [p for p in parents if needle in p.email.lower() or needle in p.display_name.lower()]
    return [
        AdminUserSummary(
            id=p.id,
            email=p.email,
            display_name=p.display_name,
            subscription_tier=p.subscription_tier,
            status=p.status,
            created_at=p.created_at,
        )
        for p in parents
    ]


@router.get("/users/{parent_id}", response_model=AdminUserDetail)
def get_user_detail(parent_id: str, staff: StaffAccount = Depends(get_current_staff)) -> AdminUserDetail:
    """SA05 — View User Account Details."""
    _require_admin(staff)
    parent = parents_repo.get_parent(parent_id)
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    children = [c.public() for c in children_repo.list_children_for_parent(parent_id)]
    return AdminUserDetail(parent=parent, children=children)


@router.post("/users/{parent_id}/suspend", response_model=AdminUserSummary)
def suspend_user(parent_id: str, staff: StaffAccount = Depends(get_current_staff)) -> AdminUserSummary:
    """SA06 — Suspend User Account. Blocks future logins — see
    app/services/auth_service.py's login_parent status check."""
    _require_admin(staff)
    parent = parents_repo.get_parent(parent_id)
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    parents_repo.update_parent(parent_id, status="suspended")
    updated = parents_repo.get_parent(parent_id)
    return AdminUserSummary(**updated.model_dump())


@router.post("/users/{parent_id}/unsuspend", response_model=AdminUserSummary)
def unsuspend_user(parent_id: str, staff: StaffAccount = Depends(get_current_staff)) -> AdminUserSummary:
    """SA07 — Unsuspend User Account."""
    _require_admin(staff)
    parent = parents_repo.get_parent(parent_id)
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    parents_repo.update_parent(parent_id, status="active")
    updated = parents_repo.get_parent(parent_id)
    return AdminUserSummary(**updated.model_dump())


@router.post("/users/{parent_id}/reset-password", status_code=status.HTTP_202_ACCEPTED)
def admin_reset_password(parent_id: str, staff: StaffAccount = Depends(get_current_staff)) -> dict:
    """SA03 — Reset User Password (admin-triggered, on behalf of a user who
    can't self-serve — distinct from PA03's self-service path)."""
    _require_admin(staff)
    parent = parents_repo.get_parent(parent_id)
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    from app.services.auth_service import request_password_reset

    request_password_reset(parent.email)
    return {"message": f"Password reset triggered for {parent.email}."}


@router.get("/system-health", response_model=SystemHealth)
def system_health(staff: StaffAccount = Depends(get_current_staff)) -> SystemHealth:
    """SA08 — View System Health/Monitoring. Uptime/error-rate/NLP-latency
    fields come from app/core/metrics.py's real request timing (URS-required,
    see that module's docstring), not hardcoded."""
    _require_admin(staff)
    settings = get_settings()
    m = metrics.snapshot()
    return SystemHealth(
        status="ok",
        firebase_configured=settings.firebase_configured,
        openai_configured=settings.openai_configured,
        catalogue_item_count=len(catalogue_repo.list_all_items()),
        parent_count=parents_repo.count_all_parents(),
        child_profile_count=children_repo.count_all_children(),
        uptime_seconds=m["uptime_seconds"],
        window_seconds=m["window_seconds"],
        request_count_window=m["request_count_window"],
        error_count_window=m["error_count_window"],
        error_rate_window=m["error_rate_window"],
        avg_latency_ms=m["avg_latency_ms"],
        nlp_avg_latency_ms=m["nlp_avg_latency_ms"],
        nlp_sample_count_window=m["nlp_sample_count_window"],
    )


@router.get("/integrations", response_model=IntegrationStatus)
def get_integrations(staff: StaffAccount = Depends(get_current_staff)) -> IntegrationStatus:
    """SA09 — Manage API Integrations (read-only status; see
    app/models/admin.py's IntegrationStatus docstring for why there's no
    write path here)."""
    _require_admin(staff)
    settings = get_settings()
    return IntegrationStatus(
        firebase=settings.firebase_configured,
        openai=settings.openai_configured,
        google_books=bool(settings.google_books_api_key),
        youtube_data=bool(settings.youtube_data_api_key),
    )


@router.get("/system-settings", response_model=SystemSettings)
def get_system_settings(staff: StaffAccount = Depends(get_current_staff)) -> SystemSettings:
    """SA10/SA11/SA13 — Compliance & Data-Retention / System Settings / Billing
    System Configuration (GET half)."""
    _require_admin(staff)
    doc = get_store().get(COLLECTION_SYSTEM_SETTINGS, "default")
    return SystemSettings(**doc) if doc else SystemSettings()


@router.patch("/system-settings", response_model=SystemSettings)
def update_system_settings(data: SystemSettings, staff: StaffAccount = Depends(get_current_staff)) -> SystemSettings:
    """SA10/SA11/SA13 — Compliance & Data-Retention / System Settings / Billing
    System Configuration (PATCH half)."""
    _require_admin(staff)
    data.updated_at = datetime.now(timezone.utc)
    store = get_store()
    doc = data.model_dump()
    if store.get(COLLECTION_SYSTEM_SETTINGS, "default") is not None:
        store.update(COLLECTION_SYSTEM_SETTINGS, "default", doc)
    else:
        store.create(COLLECTION_SYSTEM_SETTINGS, "default", doc)
    return data
