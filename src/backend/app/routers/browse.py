"""Child browse screen: a second, equal way into the catalogue next to "Ask
Pip" (CH20-style category tiles).

No search endpoint on purpose. The chatbot is already the search, the
catalogue is small and curated, and leaving search out keeps browsing and
talking genuinely different modes.

Everything here goes through the same `_visible_catalogue` filter the chat
uses, so age band, safety settings (PA21) and parent overrides (PA18) apply
exactly as they do to Pip's own picks.

Interests only reorder: they drive the "For You" row and never filter or
hide anything. Gender is deliberately not read anywhere in this module
(PDPA position: stored, never used to filter or rank).
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query

from ..deps import current_child
from ..models import BrowseCategory, BrowseItemsOut, Recommendation
from .chat import _visible_catalogue

router = APIRouter(prefix="/api/browse", tags=["browse"])

PAGE_SIZE = 8
FOR_YOU_LIMIT = 8


def _card(item: dict) -> Recommendation:
    """Same shape as a chat recommendation so the child UI reuses its card.
    `explanation` is the item's synopsis (or a plain genre line), never the
    raw scraped listing text, which must not reach a child."""
    genres = item.get("genres", [])
    blurb = item.get("synopsis") or (
        f"A {item['type']} about {' and '.join(genres[:2])}." if genres else f"A {item['type']} to enjoy."
    )
    return Recommendation(
        id=item["id"], type=item["type"], title=item["title"], explanation=blurb,
        description=item.get("description", ""), synopsis=item.get("synopsis"),
        external_ref=item.get("external_ref"), thumbnail=item.get("thumbnail"), genres=genres,
    )


def _pool(child: dict, type_: Optional[str]) -> list[dict]:
    items = _visible_catalogue(child)
    if type_:
        items = [i for i in items if i["type"] == type_]
    return items


@router.get("/categories", response_model=list[BrowseCategory])
def categories(type: Optional[Literal["book", "video"]] = None, child: dict = Depends(current_child)):
    counts: dict[str, int] = {}
    for item in _pool(child, type):
        for g in {g.lower() for g in item.get("genres", [])}:
            counts[g] = counts.get(g, 0) + 1
    return [BrowseCategory(genre=g, count=n) for g, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


@router.get("/items", response_model=BrowseItemsOut)
def items(
    genre: Optional[str] = None,
    type: Optional[Literal["book", "video"]] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(PAGE_SIZE, ge=1, le=24),
    child: dict = Depends(current_child),
):
    """"Show more" is offset/limit, not numbered pages."""
    pool = _pool(child, type)
    if genre:
        wanted = genre.lower()
        pool = [i for i in pool if wanted in {g.lower() for g in i.get("genres", [])}]
    pool.sort(key=lambda i: i["title"].lower())
    page = pool[offset:offset + limit]
    return BrowseItemsOut(items=[_card(i) for i in page], total=len(pool), has_more=offset + limit < len(pool))


def _interest_score(item: dict, interests: list[str]) -> int:
    genres = {g.lower() for g in item.get("genres", [])}
    haystack = f"{item['title']} {item.get('synopsis') or ''}".lower()
    score = 0
    for interest in interests:
        if interest in genres:
            score += 2
        elif len(interest) >= 3 and interest in haystack:
            score += 1
    return score


@router.get("/for-you", response_model=list[Recommendation])
def for_you(type: Optional[Literal["book", "video"]] = None, child: dict = Depends(current_child)):
    """The "For You" row: items that match what the parent said the child likes.
    Empty when no interests are set or nothing matches; the UI then simply
    doesn't show the row. It never narrows what the rest of Browse shows."""
    interests = [i.strip().lower() for i in child.get("interests", []) if i and i.strip()]
    if not interests:
        return []
    scored = [(s, i) for i in _pool(child, type) if (s := _interest_score(i, interests)) > 0]
    scored.sort(key=lambda si: (-si[0], si[1]["title"].lower()))
    return [_card(i) for _, i in scored[:FOR_YOU_LIMIT]]
