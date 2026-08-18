"""Seeds the test-fixture catalogue titles from agent-context/CLAUDE.md §10 into
whichever store is active (local JSON dev store, or real Firestore if
configured — see app/repositories/store.py).

**These are placeholder test fixtures only** — clearly marked as such in
CLAUDE.md §10 — never real moderated content. Real catalogue entries must go
through the moderation pipeline (CM03 -> CM06/CM07 -> CM09/CM10) instead of
this script. This script exists purely to unblock retrieval-pipeline
development/testing (task: "Build chat/recommendation pipeline") without
needing the moderator console built first.

Run from src/backend/:

    python -m scripts.seed_catalogue
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # allow `python scripts/seed_catalogue.py` too

from app.models.catalogue import CatalogueItem  # noqa: E402
from app.repositories import catalogue as catalogue_repo  # noqa: E402
from app.repositories.store import get_store  # noqa: E402
from app.services import openai_service  # noqa: E402

SEED_TITLES = [
    dict(
        title="The Very Hungry Caterpillar",
        type="book",
        synopsis="A tiny caterpillar eats through all sorts of food before turning into a beautiful butterfly.",
        age_bands=["5-8"],
        genre="picture book",
        topics=["nature", "calming", "growing up"],
        reading_level="early reader",
    ),
    dict(
        title="Dog Man",
        type="book",
        synopsis="Part dog, part man, all hero — a comic-book series about a dog-headed police officer solving silly crimes.",
        age_bands=["5-8", "9-12"],
        genre="humor, comic",
        topics=["humor", "comic", "adventure"],
        reading_level="early chapter book",
    ),
    dict(
        title="Percy Jackson: The Lightning Thief",
        type="book",
        synopsis="A boy discovers he's the son of a Greek god and must recover Zeus's stolen lightning bolt.",
        age_bands=["9-12"],
        genre="adventure, mythology",
        topics=["adventure", "mythology", "friendship"],
        reading_level="middle grade",
    ),
    dict(
        title="Numberblocks",
        type="video",
        synopsis="Colourful number-shaped characters sing and play their way through simple math ideas.",
        age_bands=["5-8"],
        genre="educational",
        topics=["educational", "math", "counting"],
        reading_level=None,
    ),
    dict(
        title="Wild Kratts",
        type="video",
        synopsis="Two brothers use animal-powered suits to explore habitats and learn about wildlife around the world.",
        age_bands=["5-8", "9-12"],
        genre="nature",
        topics=["nature", "animals", "adventure"],
        reading_level=None,
    ),
    dict(
        title="SciShow Kids",
        type="video",
        synopsis="Short, friendly episodes answering everyday science questions kids actually ask.",
        age_bands=["5-8", "9-12"],
        genre="educational",
        topics=["educational", "science"],
        reading_level=None,
    ),
]


def seed() -> None:
    store = get_store()
    created, skipped = 0, 0
    for entry in SEED_TITLES:
        existing = [i for i in catalogue_repo.list_all_items() if i.title == entry["title"]]
        if existing:
            skipped += 1
            continue
        embedding_text = f"{entry['title']} {entry['synopsis']} {entry['genre']} {' '.join(entry['topics'])}"
        item = CatalogueItem(
            id=f"seed-{entry['title'].lower().replace(' ', '-').replace(':', '')}",
            title=entry["title"],
            type=entry["type"],
            synopsis=entry["synopsis"],
            age_bands=entry["age_bands"],
            genre=entry["genre"],
            topics=entry["topics"],
            reading_level=entry["reading_level"],
            embedding=openai_service.embed_text(embedding_text),
            status="live",  # test fixture only — real content must go through CM03->CM06/07->CM09/10
            moderator_id="seed-script",
            created_at=datetime.now(timezone.utc),
        )
        catalogue_repo.create_item(item)
        created += 1
    print(f"Seeded {created} catalogue item(s), skipped {skipped} already present.")
    print(f"Store in use: {type(store).__name__}")


if __name__ == "__main__":
    seed()
