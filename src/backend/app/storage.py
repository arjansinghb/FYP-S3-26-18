"""In-memory data store for the prototype.

Everything still LIVES in Python dictionaries at runtime (so nothing about how
routers call `db` changes), but the state is now persisted to Firestore when
it's configured (see app/firestore_store.py, the actual swap point) — loaded
once at startup, saved after every mutating request via main.py's middleware.
With no Firebase project configured this behaves exactly as before: an
in-memory store that resets on restart, fine for a quick local demo.
"""
import hashlib
import secrets
import time
import uuid

from . import firestore_store


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
        # CH17 — was previously acknowledged and discarded ("later this tunes
        # recommendations"); now actually persisted and read back by the
        # brain (see chat.py's `chat()` / brain.py's exclusion logic).
        self.feedback: dict[str, list] = {}      # child_id -> [ {content_id, liked, ts} ]
        self.reports: list[dict] = []
        self.tokens: dict[str, dict] = {}         # token -> {kind, id} — session-only, never persisted
        self.tickets: list[dict] = []             # escalated support tickets (SA14)
        # PA18 — per-child overrides on top of the global catalogue status.
        self.content_overrides: dict[str, dict] = {}   # child_id -> {content_id: "approve"|"hide"}
        # PA20 — in-app notifications.
        self.notifications: list[dict] = []
        # PA23-27 — simulated billing (no real Stripe/payment account exists).
        self.billing_records: list[dict] = []
        # CH04/05 — chat session lifecycle.
        self.chat_sessions: dict[str, dict] = {}
        # PA30 — data-deletion requests (logged, not just silently executed).
        self.deletion_requests: list[dict] = []
        # UV06/PA03 — short-lived, session-like, deliberately NOT persisted
        # (same reasoning as `tokens` above: meant to expire, not survive a restart).
        self.verify_tokens: dict[str, dict] = {}   # token -> {account_id}
        self.reset_tokens: dict[str, dict] = {}    # token -> {account_id, expires}
        # System configuration sections the admin can edit (SA09-SA13). Reflects
        # what's actually configured this run — see config.py's *_configured.
        from .config import settings
        self.system: dict[str, dict] = {
            "settings": {"app_name": "Pip", "maintenance_mode": False, "support_email": "help@pip.local"},
            "integrations": {
                "llm_provider": settings.BRAIN_PROVIDER,
                "openai_enabled": settings.openai_configured,
                "firebase_enabled": settings.firebase_configured,
                "google_books_enabled": bool(settings.GOOGLE_BOOKS_API_KEY),
                "youtube_enabled": bool(settings.YOUTUBE_DATA_API_KEY),
                # URS Design Constraint 5: YouTube content restricted to a
                # curated allowlist. Empty = an editorial decision the team
                # hasn't made yet (see content_sources.search_videos), not
                # something this pass can invent — see SA09 admin UI.
                "youtube_channel_allowlist": [],
            },
            "compliance": {
                "data_retention_days": 365, "pdpa_mode": True, "allow_under_13": True,
                # URS §2.5 Constraint 3 / Assumption 3 — see config.py's
                # ZDR_STATUS docstring. Surfaced here (SA10) so it's a real,
                # visible admin-facing status, not a fact buried in code.
                "openai_zdr_status": settings.ZDR_STATUS,
            },
            "website": {"site_title": "Pip — Reading Buddy", "tagline": "Safe, age-appropriate books & videos for kids", "announcement": ""},
            # One price pair per paid tier (SA13) — used to be a single
            # `monthly_price` covering "Premium" only; `subscribe()` below
            # never actually read it (charged a hardcoded 999/9900 cents
            # regardless of what an admin set here) until the Ultra tier
            # pass (2026-09-07) wired both tiers' real prices through for
            # real, not just displayed them.
            "billing": {
                "provider": "none", "currency": "SGD", "billing_enabled": False,
                "premium_monthly_price": 9.9, "premium_annual_price": 99.0,
                "ultra_monthly_price": 19.9, "ultra_annual_price": 199.0,
            },
        }
        self.started = time.time()

        saved = firestore_store.load_state()
        if saved:
            self._restore(saved)
        else:
            self._seed()
            self.save()  # first run with Firestore configured: persist the seed immediately

    def _restore(self, state: dict) -> None:
        self.accounts = state.get("accounts", {})
        self.children = state.get("children", {})
        self.content = state.get("content", {})
        self.favourites = state.get("favourites", {})
        self.activity = state.get("activity", {})
        self.feedback = state.get("feedback", {})
        # Older saved snapshots predate `feedback` entirely — every existing
        # child needs an entry or the first feedback write for them 404s
        # against a missing key instead of appending.
        for child_id in self.children:
            self.feedback.setdefault(child_id, [])
        self.reports = state.get("reports", [])
        self.tickets = state.get("tickets", [])
        self.content_overrides = state.get("content_overrides", {})
        self.notifications = state.get("notifications", [])
        self.billing_records = state.get("billing_records", [])
        self.chat_sessions = state.get("chat_sessions", {})
        self.deletion_requests = state.get("deletion_requests", [])
        # Merge rather than replace: keeps any new config keys a later code
        # change adds, even if the saved snapshot predates them.
        for section, values in state.get("system", {}).items():
            self.system.setdefault(section, {}).update(values)
        # openai_zdr_status always reflects the CURRENT deployment's env var,
        # never a stale value from an old saved snapshot — a compliance flag
        # that silently shows an out-of-date status is worse than one that
        # doesn't persist across restarts at all.
        from .config import settings as _settings
        self.system["compliance"]["openai_zdr_status"] = _settings.ZDR_STATUS
        # Backfill account fields a saved snapshot predates (e.g. `tier` on
        # accounts created before this pass) so older saved state doesn't
        # crash newer code that expects the field to exist.
        for acc in self.accounts.values():
            acc.setdefault("tier", "free")
            acc.setdefault("consent", None)
            acc.setdefault("privacy_settings", {"retention_preference": "standard"})
            acc.setdefault("notification_preferences", {"channels": {"in_app": True, "email": False, "push": False}})
            acc["notification_preferences"].setdefault("channels", {"in_app": True, "email": False, "push": False})
            acc.setdefault("payment_method", None)
            acc.setdefault("subscription_billing_cycle", None)
            acc.setdefault("subscription_started_at", None)
            acc.setdefault("subscription_cancel_at", None)
        for child in self.children.values():
            child.setdefault("failed_pin_attempts", 0)
            child.setdefault("locked", False)
            # Older saved children may have a random hex linking_code that no
            # longer matches their (unchanged) pin under the new "same value"
            # rule — bring it in line rather than leave a child permanently
            # unable to log in after this change.
            if child.get("linking_code") != child.get("pin"):
                child["linking_code"] = child.get("pin")

    def save(self) -> None:
        """Persist the full prototype state to Firestore (no-op if
        unconfigured). `tokens`/`verify_tokens`/`reset_tokens` are
        deliberately excluded — short-lived, meant to expire, not survive
        a restart."""
        firestore_store.save_state({
            "accounts": self.accounts,
            "children": self.children,
            "content": self.content,
            "favourites": self.favourites,
            "activity": self.activity,
            "feedback": self.feedback,
            "reports": self.reports,
            "tickets": self.tickets,
            "content_overrides": self.content_overrides,
            "notifications": self.notifications,
            "billing_records": self.billing_records,
            "chat_sessions": self.chat_sessions,
            "deletion_requests": self.deletion_requests,
            "system": self.system,
        })

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
            "verified": role != "parent",  # parents verify via email later (UV06); others pre-verified
            "suspended": False,
            "created": time.time(),
            "tier": "free",                                    # PA33/34/35
            "consent": None,                                    # PA28 — {timestamp} once given
            "privacy_settings": {"retention_preference": "standard"},  # PA29
            "notification_preferences": {"channels": {"in_app": True, "email": False, "push": False}},  # PA22
            "payment_method": None,                             # PA26, simulated
            "subscription_billing_cycle": None,                 # PA24
            "subscription_started_at": None,                    # PA24
            "subscription_cancel_at": None,                     # PA25
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
            self.content_overrides.pop(child["id"], None)
            for sid in [s for s, sess in self.chat_sessions.items() if sess["child_id"] == child["id"]]:
                self.chat_sessions.pop(sid, None)
        self.reports[:] = [r for r in self.reports if r["parent_id"] != account_id]
        self.notifications[:] = [n for n in self.notifications if n["parent_id"] != account_id]
        self.billing_records[:] = [b for b in self.billing_records if b["parent_id"] != account_id]
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

    # ---------- UV06 email verification ----------

    def request_email_verification(self, account: dict) -> str:
        token = secrets.token_urlsafe(16)
        self.verify_tokens[token] = {"account_id": account["id"]}
        return token

    def confirm_email_verification(self, token: str) -> dict | None:
        entry = self.verify_tokens.pop(token, None)
        if not entry:
            return None
        account = self.accounts.get(entry["account_id"])
        if account:
            account["verified"] = True
        return account

    # ---------- PA03 password reset ----------

    def request_password_reset(self, email: str) -> str | None:
        account = self.find_account_by_email(email)
        if not account:
            return None
        token = secrets.token_urlsafe(16)
        self.reset_tokens[token] = {"account_id": account["id"], "expires": time.time() + 3600}
        return token

    def confirm_password_reset(self, token: str, new_password: str) -> dict | None:
        entry = self.reset_tokens.pop(token, None)
        if not entry or entry["expires"] < time.time():
            return None
        account = self.accounts.get(entry["account_id"])
        if account:
            self.update_account(account, password=new_password)
        return account

    # ---------- PA28 consent / PA29 privacy / PA30 data deletion ----------

    def give_consent(self, account: dict) -> dict:
        account["consent"] = {"timestamp": time.time(), "version": "1.0"}
        return account

    def update_privacy_settings(self, account: dict, retention_preference: str) -> dict:
        account["privacy_settings"] = {"retention_preference": retention_preference}
        return account

    def request_data_deletion(self, child: dict, days_out: int = 7) -> dict:
        """PA30 — URS Normal Flow: "System confirms scope and deletion
        timeline... system schedules deletion", not an instant wipe. Records
        a "pending" request due `days_out` days out; `apply_due_deletions`
        (called lazily, same no-cron pattern as PA25's subscription
        cancellation) actually clears the data once that date arrives. A
        distinct audit trail from PA09 (Delete Child Profile), which removes
        the whole profile immediately instead."""
        record = {
            "id": _new_id(), "child_id": child["id"], "status": "pending",
            "requested_at": time.time(), "scheduled_for": time.time() + days_out * 86400,
        }
        self.deletion_requests.append(record)
        return record

    def cancel_data_deletion(self, request_id: str) -> dict | None:
        """Alt Flow 3a — parent cancels before it takes effect."""
        record = next((r for r in self.deletion_requests if r["id"] == request_id), None)
        if record and record["status"] == "pending":
            record["status"] = "cancelled"
        return record

    def apply_due_deletions(self) -> None:
        now = time.time()
        for record in self.deletion_requests:
            if record["status"] == "pending" and record["scheduled_for"] <= now:
                child_id = record["child_id"]
                if child_id in self.children:  # child may have been deleted separately (PA09) already
                    self.activity[child_id] = []
                    self.favourites[child_id] = []
                    self.feedback[child_id] = []
                record["status"] = "completed"

    # ---------- PA20/22 notifications ----------

    def add_notification(self, parent_id: str, type_: str, title: str, body: str) -> dict | None:
        account = self.accounts.get(parent_id)
        channels = (account or {}).get("notification_preferences", {}).get("channels", {})
        if not account or not channels.get("in_app", True):
            return None  # respects the parent's own preference (PA22) — only in_app actually delivers
        notif = {
            "id": _new_id(), "parent_id": parent_id, "type": type_, "title": title,
            "body": body, "created_at": time.time(), "read": False,
        }
        self.notifications.append(notif)
        return notif

    def notifications_for(self, parent_id: str) -> list[dict]:
        return sorted(
            (n for n in self.notifications if n["parent_id"] == parent_id),
            key=lambda n: n["created_at"], reverse=True,
        )

    def mark_notification_read(self, notification_id: str) -> dict | None:
        notif = next((n for n in self.notifications if n["id"] == notification_id), None)
        if notif:
            notif["read"] = True
        return notif

    # ---------- PA23-27 billing (simulated) ----------

    def subscribe(self, account: dict, tier: str, billing_cycle: str, payment_method: dict | None = None) -> dict:
        """`tier` is "premium" or "ultra" (SubscribeRequest). Price actually
        comes from `system.billing`'s admin-configured values now — this
        used to charge a hardcoded 999/9900 cents regardless of what SA13's
        own admin panel had set, a real gap found while wiring the Ultra
        tier through (2026-09-07), fixed alongside it rather than left."""
        if payment_method:
            self.set_payment_method(account, payment_method["brand"], payment_method["last4"])
        account["tier"] = tier
        account["subscription_billing_cycle"] = billing_cycle
        account["subscription_started_at"] = time.time()
        account["subscription_cancel_at"] = None
        b = self.system["billing"]
        price = b[f"{tier}_{billing_cycle}_price"]
        self.billing_records.append({
            "id": _new_id(), "parent_id": account["id"],
            "description": f"{tier.capitalize()} subscription ({billing_cycle})",
            "amount_cents": round(price * 100), "ts": time.time(),
        })
        return account

    def cancel_subscription(self, account: dict) -> dict:
        """PA25 — takes effect at the end of the current cycle rather than
        instantly, same simulated-but-realistic shape as the other branch's
        billing flow."""
        days = 30 if account.get("subscription_billing_cycle") == "monthly" else 365
        account["subscription_cancel_at"] = time.time() + days * 86400
        return account

    def apply_pending_cancellation(self, account: dict) -> None:
        """Called on every authenticated parent request (see deps.py) — lazily
        downgrades an account whose cancellation date has passed. No cron
        needed for a prototype this size."""
        cancel_at = account.get("subscription_cancel_at")
        if cancel_at and cancel_at <= time.time():
            account["tier"] = "free"
            account["subscription_billing_cycle"] = None
            account["subscription_started_at"] = None
            account["subscription_cancel_at"] = None

    def set_payment_method(self, account: dict, brand: str, last4: str) -> dict:
        account["payment_method"] = {"brand": brand, "last4": last4}
        return account

    def billing_history_for(self, parent_id: str) -> list[dict]:
        return sorted(
            (b for b in self.billing_records if b["parent_id"] == parent_id),
            key=lambda b: b["ts"], reverse=True,
        )

    # ---------- PA18 per-child content overrides ----------

    def set_content_override(self, child_id: str, content_id: str, action: str) -> None:
        self.content_overrides.setdefault(child_id, {})[content_id] = action

    def clear_content_override(self, child_id: str, content_id: str) -> None:
        self.content_overrides.get(child_id, {}).pop(content_id, None)

    def overrides_for(self, child_id: str) -> dict:
        return self.content_overrides.get(child_id, {})

    # ---------- CH04/05 chat sessions ----------

    def start_chat_session(self, child_id: str) -> dict:
        session = {"id": _new_id(), "child_id": child_id, "started_at": time.time(), "ended_at": None}
        self.chat_sessions[session["id"]] = session
        return session

    def session_history(self, child_id: str, session_id: str, limit: int = 6) -> list[dict]:
        """CH07 — real conversation memory: prior turns *in this session*
        (not the child's whole lifetime history), oldest first, capped to
        the most recent `limit` turns so the prompt sent to OpenAI doesn't
        grow unbounded across a long conversation. Each turn is
        {message, reply} — used to build real multi-turn chat messages, the
        same shape ChatGPT/Claude's own conversation memory takes, not just
        the single latest message."""
        turns = [
            {"message": a["message"], "reply": a["reply"]}
            for a in self.activity.get(child_id, [])
            if a.get("session_id") == session_id
        ]
        return turns[-limit:]

    def end_chat_session(self, session_id: str) -> dict | None:
        session = self.chat_sessions.get(session_id)
        if session:
            session["ended_at"] = time.time()
        return session

    # ---------- children ----------

    def _generate_unique_pin(self) -> str:
        """System-generated, not parent-typed — see the real-collision bug
        this replaces (below). 6 digits = 1,000,000 possible values; retry
        is only ever needed if today's actual collision hits (astronomically
        unlikely at this system's realistic scale), never surfaced to a
        parent as an error."""
        for _ in range(20):
            candidate = f"{secrets.randbelow(1_000_000):06d}"
            if not self.pin_in_use(candidate):
                return candidate
        raise RuntimeError("Could not generate a unique PIN after 20 attempts — the 6-digit space is far more saturated than expected.")

    def create_child(self, parent_id: str, name: str, age_band: str, reading_level=None) -> dict:
        """Real bug found via testing, not hypothetical (see pin_in_use's own
        docstring): letting a PARENT freely type the PIN, while also
        requiring it to double as CH01's globally-unique linking code,
        means two different families can't both pick "123456" even though
        that's a completely reasonable, independent thing for each of them
        to want — and the 1,000,000-value space gets real collision
        pressure as the user base grows, since humans cluster on the same
        "easy" numbers. The system generates it instead: unique by
        construction, no user-facing "PIN already taken" retry loop ever,
        and — as a side benefit — not a predictable parent-chosen number
        (birthdate, "123456") in the first place."""
        pin = self._generate_unique_pin()
        child = {
            "id": _new_id(),
            "parent_id": parent_id,
            "name": name,
            "age_band": age_band,
            "reading_level": reading_level,
            "pin": pin,
            # URS: CH01's "linking code" and PA10's PIN are the same 6-digit
            "linking_code": pin,
            # value — one system-generated code activates the device (CH01)
            # AND is used for every login after that (CH02), not two
            # separate codes a young child would need to keep straight.
            "avatar": "purple",  # avatar colour variant the child can change
            "settings": {
                "allow_books": True,
                "allow_videos": True,
                "block_external_links": True,
            },
            "created": time.time(),
            "first_login_at": None,   # CH01 activation marker
            "failed_pin_attempts": 0,  # CH02 Alt Flow 2a
            "locked": False,           # requires parent intervention once tripped
        }
        self.children[child["id"]] = child
        self.favourites[child["id"]] = []
        self.activity[child["id"]] = []
        self.feedback[child["id"]] = []
        return child

    def children_of(self, parent_id: str) -> list[dict]:
        return [c for c in self.children.values() if c["parent_id"] == parent_id]

    def find_child_by_code(self, code: str):
        code = code.strip()
        return next((c for c in self.children.values() if c["linking_code"] == code), None)

    def regenerate_pin(self, child: dict) -> dict:
        """PA10 — a parent resets the code (lost/shared with the wrong
        person). Same system-generated, unique-by-construction path as
        create_child, not a free-typed replacement value — see
        _generate_unique_pin's docstring for why."""
        new_pin = self._generate_unique_pin()
        child["pin"] = new_pin
        child["linking_code"] = new_pin
        # a fresh code deserves a fresh lockout state too — otherwise a parent
        # regenerating specifically to fix a locked-out child would see the
        # profile still locked against a code that no longer exists.
        child["failed_pin_attempts"] = 0
        child["locked"] = False
        return child

    def pin_in_use(self, pin: str, exclude_child_id: str | None = None) -> bool:
        """Real bug found via testing (not hypothetical): since the linking
        code IS the PIN now (a parent-chosen 6-digit value, not a randomly
        generated one), two different families could pick the same PIN —
        without this check, `find_child_by_code` would nondeterministically
        return whichever child happens to be first in the dict, meaning one
        family's child could land in a *different* family's chat/favourites/
        history. Must be checked globally (across ALL parents), not scoped
        to one parent's own children."""
        return any(
            c["linking_code"] == pin and c["id"] != exclude_child_id
            for c in self.children.values()
        )

    PIN_RETRY_LIMIT = 5  # URS says "limited retries" without a number — [ASSUMED]

    def check_child_pin(self, child: dict, pin: str) -> bool:
        """Shared by CH01 (link) and CH02 (return login) — tracks failed
        attempts and locks the profile after PIN_RETRY_LIMIT, per CH02 Alt
        Flow 2a ("system allows limited retries, then requires parent
        intervention"). Correct PIN resets the counter."""
        if child.get("locked"):
            return False
        if child["pin"] != pin:
            child["failed_pin_attempts"] = child.get("failed_pin_attempts", 0) + 1
            if child["failed_pin_attempts"] >= self.PIN_RETRY_LIMIT:
                child["locked"] = True
            return False
        child["failed_pin_attempts"] = 0
        return True

    def unlock_child(self, child: dict) -> None:
        child["locked"] = False
        child["failed_pin_attempts"] = 0

    # ---------- content ----------

    def add_content(self, data: dict, status: str = "pending") -> dict:
        item = {"id": _new_id(), "status": status, "embedding": None, **data}
        self.content[item["id"]] = item
        return item

    def approved_content(self) -> list[dict]:
        return [c for c in self.content.values() if c["status"] == "approved"]

    def set_embedding(self, content_id: str, embedding: list[float] | None) -> None:
        if content_id in self.content:
            self.content[content_id]["embedding"] = embedding

    def _seed(self):
        """First-run bootstrap only — runs once, when there's no saved
        Firestore state yet (or Firestore isn't configured at all). The
        catalogue fixtures below exist purely so the zero-key/zero-setup
        backend still has *something* to recommend; once Google Books/YouTube
        keys are configured, run `scripts/seed_real_catalogue.py` to replace
        them with genuinely fetched, moderator-reviewed content via the real
        search -> import -> approve pipeline (app/content_sources.py +
        routers/content.py) — same real pipeline a moderator would use by
        hand, not a second hidden data source."""
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
