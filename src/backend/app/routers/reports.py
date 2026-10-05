"""Reported-content queue for moderators: review (CM11) and resolve (CM12).

Reports are created by parents (PA16). A moderator can dismiss a report, or
resolve it by removing the content from the catalogue (sets it to 'rejected').
"""
import time

from fastapi import APIRouter, Depends, HTTPException

from ..deps import require_role
from ..models import ReportNote, ReportOut, ResolveReport
from ..storage import db

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _report_out(r: dict) -> ReportOut:
    content = db.content.get(r["content_id"])
    return ReportOut(
        id=r["id"],
        content_id=r["content_id"],
        content_title=content["title"] if content else "(removed content)",
        content_type=content["type"] if content else None,
        thumbnail=content.get("thumbnail") if content else None,
        reason=r["reason"],
        status=r["status"],
        ts=r["ts"],
        resolved_at=r.get("resolved_at"),
        outcome=r.get("outcome"),
        note=r.get("note"),
    )


@router.get("", response_model=list[ReportOut])
def list_reports(mod: dict = Depends(require_role("moderator"))):
    return [_report_out(r) for r in sorted(db.reports, key=lambda r: r["ts"], reverse=True)]


@router.post("/{report_id}/resolve", response_model=ReportOut)
def resolve_report(report_id: str, body: ResolveReport, mod: dict = Depends(require_role("moderator"))):
    report = next((r for r in db.reports if r["id"] == report_id), None)
    if not report:
        raise HTTPException(404, "Report not found")
    report["status"] = "resolved"
    report["resolved_at"] = time.time()
    report["outcome"] = "removed" if body.action == "remove" else "no_change"
    if body.action == "remove":
        content = db.content.get(report["content_id"])
        if content:
            content["status"] = "rejected"
    out = _report_out(report)
    # PA17's status view + PA20's notification are two different ways of
    # surfacing the same event — fire both from the one place it happens.
    db.add_notification(
        report["parent_id"], "flag_resolved", "Your report has been reviewed",
        f'"{out.content_title}" — {("removed from the catalogue" if body.action == "remove" else "reviewed, no change made")}.',
    )
    return out


@router.post("/{report_id}/note", response_model=ReportOut)
def send_report_note(report_id: str, body: ReportNote, mod: dict = Depends(require_role("moderator"))):
    """CM12 — a message back to the parent who reported, while the report is
    still open. It never changes the report's status; sending again replaces
    the note the parent sees and notifies them again. Once a report is
    resolved the outcome speaks for itself, so no further notes."""
    report = next((r for r in db.reports if r["id"] == report_id), None)
    if not report:
        raise HTTPException(404, "Report not found")
    if report["status"] == "resolved":
        raise HTTPException(409, "This report is already resolved.")
    report["note"] = body.note
    report["note_at"] = time.time()
    out = _report_out(report)
    db.add_notification(
        report["parent_id"], "flag_resolved", "A note about your report",
        f'"{out.content_title}" — Note from our team: {body.note}',
    )
    return out
