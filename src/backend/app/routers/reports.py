"""Reported-content queue for moderators: review (CM11) and resolve (CM12).

Reports are created by parents (PA16). A moderator can dismiss a report, or
resolve it by removing the content from the catalogue (sets it to 'rejected').
"""
from fastapi import APIRouter, Depends, HTTPException

from ..deps import require_role
from ..models import ReportOut, ResolveReport
from ..storage import db

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _report_out(r: dict) -> ReportOut:
    content = db.content.get(r["content_id"])
    return ReportOut(
        id=r["id"],
        content_id=r["content_id"],
        content_title=content["title"] if content else "(removed content)",
        reason=r["reason"],
        status=r["status"],
        ts=r["ts"],
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
    if body.action == "remove":
        content = db.content.get(report["content_id"])
        if content:
            content["status"] = "rejected"
    return _report_out(report)
