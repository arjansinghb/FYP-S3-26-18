"""Content Moderator (CM01-13) and System Admin (SA01-14) accounts.

**[ASSUMED]** Staff accounts use their own email/password store (hashed with
the same passlib context as the local-dev parent path — see
app/core/security.py), not Firebase Auth. The PRD/CLAUDE.md schema names a
`staffAccounts` collection but doesn't specify an auth mechanism for it;
Firebase Auth is parent-facing in this build's design (CLAUDE.md §2.2), so a
separate, backend-owned credential store for staff is the simpler read of
"staff (moderator/admin) access ... via custom claims" without introducing a
second Firebase Auth user pool. Confirm with the team before relying on this
for anything beyond a prototype.

There's no public signup for staff — accounts are created via
`scripts/create_staff.py` (bootstrap/admin tooling), not a router.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr

StaffRole = Literal["moderator", "admin"]


class StaffAccount(BaseModel):
    id: str
    email: EmailStr
    role: StaffRole
    password_hash: str
    created_at: datetime


class StaffLogin(BaseModel):
    email: EmailStr
    password: str


class StaffPublic(BaseModel):
    id: str
    email: EmailStr
    role: StaffRole


class StaffLoginResult(BaseModel):
    staff: StaffPublic
    token: str
