"""Catalogue item model. Matches agent-context/CLAUDE.md §6 `catalogueItems/{itemId}`.

Moderation pipeline (Content Moderator actor): an item can enter the queue either
via CM03 (Add Catalogue Entry, moderator-authored) or an external submission that
lands directly in CM06's review queue — either way it starts `pendingReview`, then
CM06 (Review New Content Submission) -> CM07 (Approve) or CM08 (Reject) -> if
approved, CM09 (Apply Age-Band Tag) + CM10 (Apply Reading-Level/Genre Metadata) ->
`live`. CM04/CM05 (Edit/Remove Catalogue Entry) act on items already in the
catalogue at any status. Only `status == "live"` items are ever eligible for
retrieval — see app/services/recommendation_service.py. This is the "curated
catalogue is the primary control" rule from CLAUDE.md §3 point 1.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.child import AgeBand

ContentType = Literal["book", "video"]
CatalogueStatus = Literal["pendingReview", "pendingTagging", "live", "rejected", "removed"]


class CatalogueItemCreate(BaseModel):
    title: str
    type: ContentType
    synopsis: str
    genre: str | None = None
    topics: list[str] = Field(default_factory=list)
    reading_level: str | None = None
    source_url: str | None = None  # parent-only; never sent to the child client


class CatalogueItem(BaseModel):
    id: str
    title: str
    type: ContentType
    synopsis: str
    age_bands: list[AgeBand] = Field(default_factory=list)
    genre: str | None = None
    topics: list[str] = Field(default_factory=list)
    reading_level: str | None = None
    source_url: str | None = None
    embedding: list[float] | None = None
    status: CatalogueStatus = "pendingReview"
    moderator_id: str | None = None
    created_at: datetime


class CatalogueItemPublic(BaseModel):
    """Child-safe view — no `source_url` (that's parent-facing only, PA19 View
    External Access Options for Saved Book)."""

    id: str
    title: str
    type: ContentType
    synopsis: str
    genre: str | None
    topics: list[str]

    @classmethod
    def from_item(cls, item: CatalogueItem) -> "CatalogueItemPublic":
        return cls(
            id=item.id,
            title=item.title,
            type=item.type,
            synopsis=item.synopsis,
            genre=item.genre,
            topics=item.topics,
        )


class CatalogueItemUpdate(BaseModel):
    """CM04 — Edit Catalogue Entry."""

    title: str | None = None
    synopsis: str | None = None
    genre: str | None = None
    topics: list[str] | None = None
    reading_level: str | None = None
    source_url: str | None = None


class AgeBandTagUpdate(BaseModel):
    """CM09 — Apply Age-Band Tag."""

    age_bands: list[AgeBand] = Field(min_length=1)


class MetadataUpdate(BaseModel):
    """CM10 — Apply Reading-Level/Genre Metadata."""

    genre: str | None = None
    topics: list[str] = Field(default_factory=list)
    reading_level: str | None = None


class RejectRequest(BaseModel):
    """CM08 — Reject Content."""

    reason: str = Field(min_length=1, max_length=500)


class ContentSearchResult(BaseModel):
    """A candidate from Google Books / YouTube search — not yet in the
    catalogue. See app/services/content_source_service.py."""

    external_id: str
    title: str
    synopsis: str
    thumbnail: str | None = None
    source_url: str | None = None
    extra: str | None = None  # authors (books) or channel (videos), joined for display


class ImportContentRequest(BaseModel):
    """CM03 — Add Catalogue Entry, sourced from a search result. Re-sends the
    candidate's own fields rather than re-fetching by ID — one API round trip
    total for the search, not a second one per import."""

    external_id: str
    type: ContentType
    title: str
    synopsis: str
    source_url: str | None = None
