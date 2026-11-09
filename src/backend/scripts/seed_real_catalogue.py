"""One-off: replace the zero-key fixture catalogue with real, genuinely
fetched Google Books/YouTube content, imported through the actual moderation
API — not a second hidden data path. Run this once against a running backend
that has GOOGLE_BOOKS_API_KEY/YOUTUBE_DATA_API_KEY configured.

What it does, all through real HTTP calls to the running backend:
1. Logs in as the seeded demo moderator (moderator@pip.local).
2. Removes the old static fixture content (source == "manual"/"submission",
   from storage.py's _seed()) so nothing hardcoded is left mixed in.
3. For a curated list of (age_band, type, query, genres) tuples, calls the
   real GET /api/content/search/books or /search/videos (2 pages each) and
   keeps only results Google Books itself categorises as Juvenile
   Fiction/Nonfiction with a real synopsis (a first pass at "funny picture
   book kids animals" pulled in plenty of unrelated adult/reference titles
   that happened to match on keywords alone — the category field is a much
   more reliable real signal than trusting free-text relevance ranking).
   age_bands/genres on the imported item come from the query that was
   deliberately run — e.g. a search under the "5-8" bucket tags
   age_bands=["5-8"] because that's the band this item was searched *for*,
   not a guess made about the item itself.
4. Approves each import (POST /api/content/{id}/approve) — same CM06->CM07
   human-in-the-loop step a moderator would do by hand; only items that
   passed the category filter above ever reach this step.

Usage:
    cd src/backend
    ./.venv/bin/uvicorn app.main:app --port 8000 &   # backend must be running
    ./.venv/bin/python scripts/seed_real_catalogue.py [--base-url http://localhost:8000]
"""
from __future__ import annotations

import argparse
import re
import sys
import time

import httpx

MODERATOR_EMAIL = "moderator@pip.local"
MODERATOR_PASSWORD = "moderator123"

# A handful of generic reference/guide-book title patterns that occasionally
# slip through Google Books' own "Juvenile Fiction/Nonfiction" categorisation
# (e.g. a librarian's reading-list guide gets tagged Juvenile Nonfiction even
# though it's a book *for adults about* children's books, not a book for a
# child to read) — a light final filter on top of the category check, not a
# replacement for it.
_TITLE_DENYLIST = re.compile(
    r"sourcebook|reading list|read next|for dummies|\bguide to\b|bibliography|"
    r"\bcatalog(ue)?\b|book review|publishers?( 'weekly| circular)?",
    re.I,
)

# (age_band, type, query, genres)
PLAN: list[tuple[str, str, str, list[str]]] = [
    ("5-8", "book", "funny picture book for kids animals", ["funny", "animals"]),
    ("5-8", "book", "calming story for children sleep", ["cosy", "animals"]),
    ("5-8", "book", "dinosaurs for kids", ["dinosaur"]),
    ("5-8", "book", "dinosaur adventure story", ["dinosaur", "adventure"]),
    ("9-12", "book", "space adventure kids", ["adventure", "space"]),
    ("9-12", "book", "kids detective story", ["funny", "mystery"]),
    ("9-12", "book", "science for curious kids", ["science"]),
    ("5-8", "video", "amazing animals rainforest for kids", ["animals", "nature"]),
    ("5-8", "video", "dinosaurs 101 for kids educational", ["dinosaur", "science"]),
    ("9-12", "video", "how rockets fly for kids science", ["space", "science"]),
    ("9-12", "video", "funny science experiments for kids", ["funny", "science"]),
]

PER_QUERY_LIMIT = 2


def _search_books(client: httpx.Client, query: str) -> list[dict]:
    """Two pages (Google's public API caps a single page well under 20
    regardless of maxResults), filtered to items Google itself categorises as
    Juvenile Fiction/Nonfiction with a real synopsis."""
    good = []
    for start_index in (0, 20):
        resp = client.get("/api/content/search/books", params={"q": query, "start_index": start_index})
        resp.raise_for_status()
        for r in resp.json():
            title = (r.get("title") or "").strip()
            description = (r.get("description") or "").strip()
            categories = r.get("categories") or []
            is_juvenile = any("juvenile" in c.lower() for c in categories)
            if title and description and is_juvenile and not _TITLE_DENYLIST.search(title):
                good.append(r)
    return good


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()

    client = httpx.Client(base_url=args.base_url, timeout=20.0)

    print(f"Logging in as {MODERATOR_EMAIL} ...")
    resp = client.post("/api/auth/login", json={"email": MODERATOR_EMAIL, "password": MODERATOR_PASSWORD})
    resp.raise_for_status()
    token = resp.json()["token"]
    client.headers["Authorization"] = f"Bearer {token}"

    print("Removing old fixture content (source: manual/submission) ...")
    existing = client.get("/api/content").json()
    removed = 0
    for item in existing:
        if item.get("source") in ("manual", "submission", "google_books", "youtube"):
            client.delete(f"/api/content/{item['id']}")
            removed += 1
    print(f"  removed {removed} previous item(s)")

    seen_titles: set[str] = set()
    imported = 0
    for age_band, type_, query, genres in PLAN:
        if type_ == "book":
            candidates = _search_books(client, query)
        else:
            resp = client.get("/api/content/search/videos", params={"q": query})
            resp.raise_for_status()
            candidates = [
                r for r in resp.json()
                if (r.get("title") or "").strip() and (r.get("description") or "").strip()
                and not _TITLE_DENYLIST.search(r.get("title", ""))
            ]

        if not candidates:
            print(f"  [warn] no usable results for {query!r} (missing API key, or nothing passed the filter)")
            continue

        picked = 0
        for r in candidates:
            if picked >= PER_QUERY_LIMIT:
                break
            title = r["title"].strip()
            if title.lower() in seen_titles:
                continue
            body = {
                "type": type_,
                "title": title,
                "description": r["description"].strip()[:600],
                "age_bands": [age_band],
                "genres": genres,
                "reading_level": None,
                "source": "google_books" if type_ == "book" else "youtube",
                "external_ref": r.get("external_ref"),
                "thumbnail": r.get("thumbnail"),  # CH14 "cover"
            }
            imp = client.post("/api/content/import", json=body)
            if imp.status_code != 201:
                print(f"  [warn] import failed for {title!r}: {imp.status_code} {imp.text}")
                continue
            content_id = imp.json()["id"]
            appr = client.post(f"/api/content/{content_id}/approve")
            appr.raise_for_status()
            seen_titles.add(title.lower())
            imported += 1
            picked += 1
            print(f"  + [{type_}/{age_band}] {title}")
            time.sleep(0.15)  # be polite to the source APIs

    print(f"\nDone: {imported} real catalogue item(s) imported and approved.")
    stats = client.get("/api/content").json()
    print(f"Catalogue now has {len(stats)} item(s) total "
          f"({sum(1 for i in stats if i['status'] == 'approved')} approved).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
