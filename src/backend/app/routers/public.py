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
    return {
        "currency": b["currency"], "billing_enabled": b["billing_enabled"],
        "premium_monthly_price": b["premium_monthly_price"], "premium_annual_price": b["premium_annual_price"],
        "ultra_monthly_price": b["ultra_monthly_price"], "ultra_annual_price": b["ultra_annual_price"],
    }


@router.get("/catalogue-sample")
def catalogue_sample(limit: int = 6):
    """UV02 — a handful of real, already-moderator-approved catalogue items
    for the landing page's "peek at the catalogue" section. Only ever
    approved content, and only the fields safe to show an unregistered
    visitor (no source_url — that's for staff/parents, not the public site).
    Real data, not a hardcoded landing-page fixture: whatever the moderation
    pipeline has actually approved today is what shows here.

    Thumbnailed items are listed first. Not every approved item has a real
    cover — the handful of hand-typed `_seed()` fixtures (`source: "manual"`
    or `"submission"`, fictional demo titles like "Ricky the Rock That
    Roared") were never real Google Books/YouTube results, so there's no
    real cover art to fetch for them (frontend correctly falls back to a
    generic type icon for those — see Home.jsx's CatalogueCard, not a bug).
    This is the one place that matters cosmetically: a first-impression
    "peek at the catalogue" strip on the public landing page shouldn't lead
    with placeholder icons when 33+ real, thumbnailed items already exist.
    Every OTHER surface (moderator catalogue, parent favourites, child chat
    recs) still shows these fixtures honestly, icon and all — only the
    sampling ORDER changes here, no data is hidden or faked."""
    # No created-at timestamp exists on content items to sort by (see
    # storage.add_content) — natural dict insertion order is the tiebreak
    # within each group, not a fabricated "recency" claim.
    approved = [c for c in db.content.values() if c["status"] == "approved"]
    ordered = sorted(approved, key=lambda c: c.get("thumbnail") is None)
    return [
        {
            "id": c["id"], "type": c["type"], "title": c["title"],
            "description": c.get("description", ""), "thumbnail": c.get("thumbnail"),
            "age_bands": c.get("age_bands", []), "genres": c.get("genres", []),
        }
        for c in ordered[:max(1, min(limit, 12))]
    ]
