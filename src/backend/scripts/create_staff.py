"""Bootstrap a Content Moderator or System Admin account. There's no public
signup for staff (see app/models/staff.py) — this script is the only way to
create one.

Usage (from src/backend/):

    python -m scripts.create_staff moderator@example.com secretpass123 moderator
    python -m scripts.create_staff admin@example.com secretpass123 admin
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.security import hash_secret  # noqa: E402
from app.repositories import staff as staff_repo  # noqa: E402


def main() -> None:
    if len(sys.argv) != 4 or sys.argv[3] not in ("moderator", "admin"):
        print(__doc__)
        sys.exit(1)

    email, password, role = sys.argv[1], sys.argv[2], sys.argv[3]
    if staff_repo.get_staff_by_email(email) is not None:
        print(f"A staff account with email {email} already exists.")
        sys.exit(1)

    account = staff_repo.create_staff(email, role, hash_secret(password))
    print(f"Created {role} account: {account.email} (id: {account.id})")


if __name__ == "__main__":
    main()
