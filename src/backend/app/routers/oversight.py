"""Parent oversight of a child: view activity (PA14), view saved favourites
(PA15, extended for PA19), report content from history (PA16), view report
status (PA17), and Premium insights (PA31/PA32)."""
import time
import uuid
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException

from ..deps import require_role
from ..models import ChildComparisonOut, ChildTrendsOut, ReportOut, ReportRequest
from ..storage import db

router = APIRouter(prefix="/api/children", tags=["oversight"])


def _owned_child(child_id: str, parent: dict) -> dict:
    child = db.children.get(child_id)
    if not child or child["parent_id"] != parent["id"]:
        raise HTTPException(404, "Child profile not found")
    return child


def _report_out(r: dict) -> ReportOut:
    content = db.content.get(r["content_id"])
    return ReportOut(
        id=r["id"], content_id=r["content_id"],
        content_title=content["title"] if content else "(removed content)",
        reason=r["reason"], status=r["status"], ts=r["ts"],
    )


@router.get("/{child_id}/activity")
def child_activity(child_id: str, parent: dict = Depends(require_role("parent"))):
    _owned_child(child_id, parent)
    return list(reversed(db.activity.get(child_id, [])))


@router.get("/{child_id}/favourites")
def child_favourites(child_id: str, parent: dict = Depends(require_role("parent"))):
    """PA15, extended for PA19: books carry `external_ref` (retailer/library
    link) so the parent can offer "Access Options" without exposing it to
    the child at all — the child-facing favourites endpoint in chat.py
    intentionally does NOT include this field."""
    _owned_child(child_id, parent)
    out = []
    for f in db.favourites.get(child_id, []):
        item = db.content.get(f["content_id"])
        # See chat.py's list_favourites for why this checks status, not
        # just existence — a rejected-after-the-fact item shouldn't stay
        # visible here either.
        if item and item["status"] == "approved":
            out.append({
                "id": item["id"], "title": item["title"], "type": item["type"],
                "description": item.get("description", ""),
                "thumbnail": item.get("thumbnail"),
                "external_ref": item.get("external_ref") if item["type"] == "book" else None,
            })
    return out


@router.post("/{child_id}/report", status_code=201)
def report_content(child_id: str, body: ReportRequest, parent: dict = Depends(require_role("parent"))):
    _owned_child(child_id, parent)
    if body.content_id not in db.content:
        raise HTTPException(404, "Content not found")
    report = {
        "id": uuid.uuid4().hex[:12],
        "parent_id": parent["id"],
        "child_id": child_id,
        "content_id": body.content_id,
        "reason": body.reason,
        "status": "open",
        "ts": time.time(),
    }
    db.reports.append(report)
    return {"ok": True, "report_id": report["id"]}


# ---------- PA17: view reported content status ----------

@router.get("/{child_id}/reports", response_model=list[ReportOut])
def child_reports(child_id: str, parent: dict = Depends(require_role("parent"))):
    _owned_child(child_id, parent)
    mine = [r for r in db.reports if r["child_id"] == child_id]
    return [_report_out(r) for r in sorted(mine, key=lambda r: r["ts"], reverse=True)]


@router.get("/reports", response_model=list[ReportOut])
def my_reports(parent: dict = Depends(require_role("parent"))):
    """All of this parent's reports across every child, in one place."""
    mine = [r for r in db.reports if r["parent_id"] == parent["id"]]
    return [_report_out(r) for r in sorted(mine, key=lambda r: r["ts"], reverse=True)]


# ---------- PA31: trend insights (Premium) ----------

def _genre_counts(child_id: str) -> Counter:
    counts = Counter()
    for entry in db.activity.get(child_id, []):
        for rec_id in entry.get("rec_ids", []):
            item = db.content.get(rec_id)
            if item:
                counts.update(item.get("genres", []))
    return counts


@router.get("/{child_id}/trends", response_model=ChildTrendsOut)
def child_trends(child_id: str, parent: dict = Depends(require_role("parent"))):
    if parent.get("tier", "free") == "free":  # Premium AND Ultra both get insights
        raise HTTPException(403, "Insights are a Premium feature.")
    child = _owned_child(child_id, parent)
    activity = db.activity.get(child_id, [])
    total_recs = sum(len(a.get("rec_ids", [])) for a in activity)
    genre_counts = _genre_counts(child_id)
    return ChildTrendsOut(
        child_id=child["id"],
        total_messages=len(activity),
        total_recommendations=total_recs,
        favourites_count=len(db.favourites.get(child_id, [])),
        top_genres=[g for g, _ in genre_counts.most_common(5)],
    )


# ---------- PA32: multi-child comparison (Premium, 2+ children) ----------

@router.get("/compare", response_model=list[ChildComparisonOut])
def compare_children(parent: dict = Depends(require_role("parent"))):
    if parent.get("tier", "free") == "free":  # Premium AND Ultra both get comparison
        raise HTTPException(403, "Comparing children is a Premium feature.")
    children = db.children_of(parent["id"])
    if len(children) < 2:
        raise HTTPException(400, "Add a second child profile to compare.")
    out = []
    for c in children:
        activity = db.activity.get(c["id"], [])
        out.append(ChildComparisonOut(
            child_id=c["id"], name=c["name"],
            total_messages=len(activity),
            total_recommendations=sum(len(a.get("rec_ids", [])) for a in activity),
            favourites_count=len(db.favourites.get(c["id"], [])),
            top_genres=[g for g, _ in _genre_counts(c["id"]).most_common(3)],
        ))
    return out
