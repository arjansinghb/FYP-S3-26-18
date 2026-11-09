"""Child-profile rules that aren't storage or HTTP: date of birth -> age band,
and the articulation level ladder.

Kept separate from storage.py/models.py so both can import it without a cycle.
"""
from __future__ import annotations

from datetime import date

MIN_AGE = 5
MAX_AGE = 12


def age_from_dob(dob: str, today: date | None = None) -> int:
    """Whole years since `dob` (ISO `YYYY-MM-DD`). Raises ValueError on a bad
    or future date."""
    today = today or date.today()
    try:
        born = date.fromisoformat(dob)
    except (TypeError, ValueError):
        raise ValueError("Enter a valid date of birth.")
    if born > today:
        raise ValueError("Date of birth can't be in the future.")
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def band_for_age(age: int) -> str:
    return "5-8" if age <= 8 else "9-12"


def band_from_dob(dob: str, today: date | None = None) -> str:
    """The age band Pip serves for this date of birth. Raises ValueError when
    the child is outside the 5-12 range the product is built for."""
    age = age_from_dob(dob, today)
    if age < MIN_AGE or age > MAX_AGE:
        raise ValueError(f"Pip is made for children aged {MIN_AGE} to {MAX_AGE}.")
    return band_for_age(age)


# ---------- articulation levels ----------

LEVELS = ["explorer", "adventurer", "storyteller"]
CONFIRMATIONS_PER_LEVEL = 3

# `descriptor` is what a parent judges an explanation against: always the
# child's CURRENT level, never the next one.
LEVEL_INFO = {
    "explorer": {
        "label": "Explorer",
        "descriptor": "Names what they noticed: a character, a moment, something they felt.",
    },
    "adventurer": {
        "label": "Adventurer",
        "descriptor": "Says what happened and why it mattered, in an order that makes sense.",
    },
    "storyteller": {
        "label": "Storyteller",
        "descriptor": "Retells it with detail and says what they think about it.",
    },
}


def next_level(level: str) -> str | None:
    i = LEVELS.index(level) if level in LEVELS else 0
    return LEVELS[i + 1] if i + 1 < len(LEVELS) else None


def level_label(level: str) -> str:
    return LEVEL_INFO.get(level, LEVEL_INFO["explorer"])["label"]


# ---------- interests ----------

# The genre vocabulary the catalogue is tagged with (CM09/CM10). Interests are
# a fixed list: they drive "For You" and are given to Pip as background, and
# both only work for words the catalogue actually uses. Free text would also
# put unvetted parent-typed text into an LLM prompt. Keep in sync with
# INTEREST_OPTIONS in frontend/src/pages/ParentDashboard.jsx.
INTEREST_OPTIONS = [
    "funny", "adventure", "science", "animals", "friendship", "cosy",
    "fairytale", "nature", "educational", "mystery", "vehicles", "space",
    "art", "history", "sports", "music", "dinosaur",
]


def clean_interests(values) -> list[str]:
    """Lowercase, de-duplicate and keep only values from the fixed list."""
    seen: list[str] = []
    for v in values or []:
        v = str(v).strip().lower()
        if v in INTEREST_OPTIONS and v not in seen:
            seen.append(v)
    return seen
