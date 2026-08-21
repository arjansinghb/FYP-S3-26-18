"""In-memory data store for the prototype.

Everything lives in Python dictionaries, so the backend runs instantly with no
database setup. Data resets when the server restarts — that's fine for a
prototype/demo.

LATER: this whole file gets replaced by Firebase (Firestore + Authentication).
The rest of the app only calls the `db` methods below, so swapping the storage
does not touch the routers or the brain.
"""
import hashlib
import os
import secrets
import time
import uuid


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()


class Database:
    def __init__(self):
        self.accounts: dict[str, dict] = {}
        self.children: dict[str, dict] = {}
        self.content: dict[str, dict] = {}
        self.favourites: dict[str, list] = {}   # child_id -> [ {content_id, ts} ]
        self.activity: dict[str, list] = {}      # child_id -> [ {ts, message, reply, rec_ids} ]
        self.reports: list[dict] = []
        self.tokens: dict[str, dict] = {}         # token -> {kind, id}
        self.tickets: list[dict] = []             # escalated support tickets (SA14)
        # System configuration sections the admin can edit (SA09-SA13).
        self.system: dict[str, dict] = {
            "settings": {"app_name": "Pip", "maintenance_mode": False, "support_email": "help@pip.local"},
            "integrations": {"llm_provider": "placeholder", "openai_enabled": False,
                             "firebase_enabled": False, "google_books_enabled": False, "youtube_enabled": False},
            "compliance": {"data_retention_days": 365, "pdpa_mode": True, "allow_under_13": True},
            "website": {"site_title": "Pip — Reading Buddy", "tagline": "Safe, age-appropriate books & videos for kids", "announcement": ""},
            "billing": {"provider": "none", "currency": "SGD", "monthly_price": 9.9, "billing_enabled": False},
        }
        self.started = time.time()
        self._seed()

    # ---------- accounts ----------

    def create_account(self, email: str, password: str, name: str, role: str = "parent") -> dict:
        email = email.strip().lower()
        if self.find_account_by_email(email):
            raise ValueError("email already registered")
        salt = secrets.token_hex(8)
        acc = {
            "id": _new_id(),
            "email": email,
            "name": name,
            "role": role,
            "salt": salt,
            "password_hash": _hash_password(password, salt),
            "verified": role != "parent",  # parents verify via email later; others pre-verified
            "suspended": False,
            "created": time.time(),
        }
        self.accounts[acc["id"]] = acc
        return acc

    def find_account_by_email(self, email: str):
        email = email.strip().lower()
        return next((a for a in self.accounts.values() if a["email"] == email), None)

    def check_password(self, account: dict, password: str) -> bool:
        return _hash_password(password, account["salt"]) == account["password_hash"]

    def update_account(self, account: dict, name=None, email=None, password=None):
        if name is not None:
            account["name"] = name
        if email is not None:
            email = email.strip().lower()
            existing = self.find_account_by_email(email)
            if existing and existing["id"] != account["id"]:
                raise ValueError("email already registered")
            account["email"] = email
        if password is not None:
            account["password_hash"] = _hash_password(password, account["salt"])
        return account

    def delete_account(self, account_id: str):
        """Remove the account and everything belonging to it (PA06)."""
        for child in [c for c in self.children.values() if c["parent_id"] == account_id]:
            self.children.pop(child["id"], None)
            self.favourites.pop(child["id"], None)
            self.activity.pop(child["id"], None)
        self.reports[:] = [r for r in self.reports if r["parent_id"] != account_id]
        for tok, entry in list(self.tokens.items()):
            if entry["kind"] == "account" and entry["id"] == account_id:
                self.tokens.pop(tok, None)
        self.accounts.pop(account_id, None)

    # ---------- tokens ----------

    def issue_token(self, kind: str, id_: str) -> str:
        token = secrets.token_urlsafe(24)
        self.tokens[token] = {"kind": kind, "id": id_}
        return token

    def revoke_token(self, token: str):
        self.tokens.pop(token, None)

    def resolve_token(self, token: str):
        return self.tokens.get(token)

    # ---------- children ----------

    def create_child(self, parent_id: str, name: str, age_band: str, pin: str, reading_level=None) -> dict:
        child = {
            "id": _new_id(),
            "parent_id": parent_id,
            "name": name,
            "age_band": age_band,
            "reading_level": reading_level,
            "pin": pin,
            "linking_code": secrets.token_hex(3).upper(),  # 6-char code
            "avatar": "purple",  # avatar colour variant the child can change
            "settings": {
                "allow_books": True,
                "allow_videos": True,
                "block_external_links": True,
            },
            "created": time.time(),
        }
        self.children[child["id"]] = child
        self.favourites[child["id"]] = []
        self.activity[child["id"]] = []
        return child

    def children_of(self, parent_id: str) -> list[dict]:
        return [c for c in self.children.values() if c["parent_id"] == parent_id]

    def find_child_by_code(self, code: str):
        code = code.strip().upper()
        return next((c for c in self.children.values() if c["linking_code"] == code), None)

    # ---------- content ----------

    def add_content(self, data: dict, status: str = "pending") -> dict:
        item = {"id": _new_id(), "status": status, **data}
        self.content[item["id"]] = item
        return item

    def approved_content(self) -> list[dict]:
        return [c for c in self.content.values() if c["status"] == "approved"]

    def _seed(self):
        # a moderator account so the moderation endpoints can be tried out
        self.create_account("moderator@pip.local", "moderator123", "Demo Moderator", role="moderator")
        # a system admin account
        self.create_account("admin@pip.local", "admin123", "Demo Admin", role="admin")

        # a couple of escalated support tickets to review (SA14)
        self.tickets = [
            {"id": _new_id(), "subject": "Child can't log in with code", "from_email": "parent_a@example.com",
             "message": "My daughter's linking code says invalid.", "status": "open", "ts": time.time()},
            {"id": _new_id(), "subject": "Voice not working on Firefox", "from_email": "parent_b@example.com",
             "message": "The microphone button does nothing in Firefox.", "status": "open", "ts": time.time()},
        ]

        seed_items = [
            ("book", "The Dragon Who Couldn't Stop Sneezing", "A giggly story about a clumsy dragon.", ["5-8"], ["funny", "animals"], "early"),
            ("book", "Ricky the Rock That Roared", "A brave little rock discovers its voice.", ["5-8", "9-12"], ["adventure", "dinosaur"], "early"),
            ("book", "Luna's Trip to the Moon", "A curious girl builds a rocket to the moon.", ["9-12"], ["space", "adventure"], "middle"),
            ("book", "The Lion Who Was Afraid of the Dark", "A cosy bedtime tale about being brave.", ["5-8"], ["animals", "cosy"], "early"),
            ("book", "Detective Mia and the Missing Cookies", "A funny mystery in a busy kitchen.", ["9-12"], ["funny", "mystery"], "middle"),
            ("video", "How Rockets Fly (for kids)", "A short, colourful explainer about rockets.", ["9-12"], ["space", "science"], None),
            ("video", "Amazing Animals of the Rainforest", "Meet friendly creatures of the jungle.", ["5-8", "9-12"], ["animals", "nature"], None),
            ("video", "Dinosaurs 101 for Curious Kids", "A gentle intro to the giant reptiles.", ["5-8", "9-12"], ["dinosaur", "science"], None),
            ("video", "Silly Science Experiments at Home", "Fun, safe experiments that make you laugh.", ["9-12"], ["funny", "science"], None),
        ]
        for typ, title, desc, bands, genres, level in seed_items:
            self.add_content(
                {
                    "type": typ,
                    "title": title,
                    "description": desc,
                    "age_bands": bands,
                    "genres": genres,
                    "reading_level": level,
                    "source": "manual",
                    "external_ref": None,
                },
                status="approved",
            )

        # A few NEW submissions awaiting moderator review (CM06/CM07/CM08).
        pending_items = [
            ("book", "Whiskers the Space Cat", "A cat who dreams of visiting the stars.", ["5-8"], ["space", "animals"], "early"),
            ("video", "Volcanoes for Curious Kids", "A short clip about how volcanoes erupt.", ["9-12"], ["science"], None),
            ("book", "The Giggle Machine", "A silly inventor builds a laughter machine.", ["5-8", "9-12"], ["funny"], "early"),
        ]
        for typ, title, desc, bands, genres, level in pending_items:
            self.add_content(
                {
                    "type": typ,
                    "title": title,
                    "description": desc,
                    "age_bands": bands,
                    "genres": genres,
                    "reading_level": level,
                    "source": "submission",
                    "external_ref": None,
                },
                status="pending",
            )


# single shared instance for the whole app
db = Database()
