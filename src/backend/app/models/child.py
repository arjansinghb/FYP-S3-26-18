"""Child profile models. Matches agent-context/CLAUDE.md §6
`parents/{parentId}/childProfiles/{childId}`.

PIN handling: PA10 ("Set Child Profile PIN") is a real, distinct use case from
PA07 ("Create Child Profile"), but per CLAUDE.md §2.2 point 2 the team's own flow
description bundles them into one form during creation rather than a separate
screen — `ChildProfileCreate` below takes the PIN inline for that reason. Age-band
derivation from DOB happens as part of PA07's own normal flow (system suggests,
parent confirms/adjusts) — there's no separate "Set/Adjust Age-Band" use case in
the PRD (PA11/PA12 are a numbering gap, not a hidden use case), so treat any later
age-band change as folded into PA08 "Edit Child Profile".

Child login: the PRD models this as **two** use cases — CH01 "Enter Linking Code
to Activate Profile" (first time, on a new device) and CH02 "Log In (PIN)"
(subsequent times). Per CLAUDE.md §2.2 point 3 [ASSUMED], both use the same
6-digit PIN value; `ChildPinLogin` below is one endpoint that reports back which
of the two just happened (`activated=True` the first time a given child profile
is ever logged into) rather than forcing a second, separate "linking" screen the
team hasn't designed yet.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

AgeBand = Literal["5-8", "9-12"]

_PIN_RE = re.compile(r"^\d{6}$")


def derive_age_band(dob: date, *, today: date | None = None) -> AgeBand:
    """PA07 — suggest an age band from date of birth, during Create Child Profile.

    The PRD only defines two bands (5-8, 9-12); a child outside that range still
    gets the nearest band (parent can adjust via PA08, Edit Child Profile) rather
    than the API erroring out on a child who's, say, 4 or 13.
    """
    today = today or date.today()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    return "5-8" if age <= 8 else "9-12"


class ChildProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    dob: date
    pin: str  # PA10, bundled into this same form — see module docstring
    avatar_id: str | None = None
    age_band_override: AgeBand | None = None  # parent can confirm/adjust the suggested band (PA07 step 3)

    @field_validator("pin")
    @classmethod
    def _validate_pin(cls, v: str) -> str:
        if not _PIN_RE.match(v):
            raise ValueError("PIN must be exactly 6 digits")
        return v


class ChildProfileUpdate(BaseModel):
    """PA08 — Edit Child Profile. Age band can be adjusted here too (see module
    docstring — there's no separate PA for it in the PRD)."""

    name: str | None = None
    age_band: AgeBand | None = None
    avatar_id: str | None = None
    reading_level_guidance: str | None = None


class SafetySettings(BaseModel):
    """PA21 — Adjust Safety Settings. Distinct from PA18 (Hide Specific
    Content, a per-item override) and PA13 (Reading-Level Guidance, informal
    text): this is catalogue-wide filtering the parent sets once per child.
    Actually enforced at retrieval time — see
    app/services/recommendation_service.py."""

    blocked_topics: list[str] = Field(default_factory=list)  # e.g. "scary", "violence" — matches CatalogueItem.topics
    strict_age_filtering: bool = False  # if True, PA18 "approve" overrides can no longer pull in an adjacent age band


class SafetySettingsUpdate(BaseModel):
    blocked_topics: list[str] | None = None
    strict_age_filtering: bool | None = None


class PinUpdate(BaseModel):
    """PA10 — Set Child Profile PIN, as a standalone later change (e.g. parent
    resets a forgotten PIN) rather than the inline-at-creation path."""

    pin: str

    @field_validator("pin")
    @classmethod
    def _validate_pin(cls, v: str) -> str:
        if not _PIN_RE.match(v):
            raise ValueError("PIN must be exactly 6 digits")
        return v


class ChildPinLogin(BaseModel):
    """CH01 (first login for this profile) / CH02 (every login after) — see
    module docstring for why one model/endpoint covers both."""

    pin: str


class AvatarUpdate(BaseModel):
    """CH19 (Choose Avatar, first time) / CH20 (Edit Avatar, any time after) —
    same endpoint, picking again just changes it."""

    avatar_id: str = Field(min_length=1, max_length=40)


class ReadingLevelUpdate(BaseModel):
    """PA13 — Set Reading-Level Guidance. Also settable via PA08's general
    ChildProfileUpdate; this is the PRD-named dedicated endpoint."""

    reading_level_guidance: str = Field(min_length=1, max_length=100)


class ChildProfile(BaseModel):
    id: str
    parent_id: str
    name: str
    dob: date
    age_band: AgeBand
    pin_hash: str
    avatar_id: str | None = None
    reading_level_guidance: str | None = None
    created_at: datetime
    favourites_count: int = 0
    first_login_at: datetime | None = None  # set on the CH01 (activation) login; None until then
    safety_settings: SafetySettings = Field(default_factory=SafetySettings)  # PA21

    def public(self) -> "ChildProfilePublic":
        return ChildProfilePublic(
            id=self.id,
            parent_id=self.parent_id,
            name=self.name,
            age_band=self.age_band,
            avatar_id=self.avatar_id,
            reading_level_guidance=self.reading_level_guidance,
            created_at=self.created_at,
            favourites_count=self.favourites_count,
            safety_settings=self.safety_settings,
        )


class ChildProfilePublic(BaseModel):
    """What parents/children ever see back — never `pin_hash` or raw `dob`."""

    id: str
    parent_id: str
    name: str
    age_band: AgeBand
    avatar_id: str | None
    reading_level_guidance: str | None
    created_at: datetime
    favourites_count: int
    safety_settings: SafetySettings


class ChildLoginResult(BaseModel):
    """Response for POST /children/{id}/login."""

    profile: ChildProfilePublic
    session_token: str
    activated: bool  # True => this was CH01 (first login/device activation), False => CH02
