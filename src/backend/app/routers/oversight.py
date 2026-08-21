"""Parent oversight of a child: view activity (PA14), view saved favourites
(PA15), and report content from history (PA16)."""
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException

from ..deps import require_role
from ..models import ReportRequest
from ..storage import db

router = APIRouter(prefix="/api/children", tags=["oversight"])


def _owned_child(child_id: str, parent: dict) -> dict:
    child = db.children.get(child_id)
    if not child or child["parent_id"] != parent["id"]:
        raise HTTPException(404, "Child profile not found")
    return child


@router.get("/{child_id}/activity")
def child_activity(child_id: str, parent: dict = Depends(require_role("parent"))):
    _owned_child(child_id, parent)
    return list(reversed(db.activity.get(child_id, [])))


@router.get("/{child_id}/favourites")
def child_favourites(child_id: str, parent: dict = Depends(require_role("parent"))):
    _owned_child(child_id, parent)
    out = []
    for f in db.favourites.get(child_id, []):
        item = db.content.get(f["content_id"])
        if item:
            out.append({"id": item["id"], "title": item["title"], "type": item["type"]})
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
