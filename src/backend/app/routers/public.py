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
