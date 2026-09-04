"""Public, no-login endpoints for the landing page an unregistered visitor sees
(UV01/UV02/UV03). The content is driven by the admin's Website (SA12) and
Billing (SA13) config, so admin edits show up on the public site.
"""
from fastapi import APIRouter

from ..storage import db

router = APIRouter(prefix="/api/public", tags=["public"])


@router.get("/site")
def site():
    w = db.system["website"]
    return {"site_title": w["site_title"], "tagline": w["tagline"], "announcement": w["announcement"]}


@router.get("/plans")
def plans():
    b = db.system["billing"]
    return {"currency": b["currency"], "monthly_price": b["monthly_price"], "billing_enabled": b["billing_enabled"]}


@router.get("/catalogue-sample")
def catalogue_sample(limit: int = 6):
    """UV02 — a handful of real, already-moderator-approved catalogue items
    for the landing page's "peek at the catalogue" section. Only ever
    approved content, and only the fields safe to show an unregistered
    visitor (no source_url — that's for staff/parents, not the public site).
    Real data, not a hardcoded landing-page fixture: whatever the moderation
    pipeline has actually approved today is what shows here."""
    # No created-at timestamp exists on content items to sort by (see
    # storage.add_content) — natural dict insertion order is what's used,
    # not a fabricated "recency" claim.
    approved = [c for c in db.content.values() if c["status"] == "approved"]
    return [
        {
            "id": c["id"], "type": c["type"], "title": c["title"],
            "description": c.get("description", ""), "thumbnail": c.get("thumbnail"),
            "age_bands": c.get("age_bands", []), "genres": c.get("genres", []),
        }
        for c in approved[:max(1, min(limit, 12))]
    ]
