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

from . import firestore_store, profile


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
        # Topics children asked Pip for that the catalogue couldn't serve —
        # [{key, topic, count, formats: {book, video, any}, first_at, last_at}].
        # Deliberately holds NO child id, session or message text: it is
        # aggregate demand, so nothing here needs cleaning up when a child or
        # parent deletes their data.
        self.topic_misses: list[dict] = []
        # token -> {kind, id}. Persisted (see save()/_restore()) — Vercel can
        # route consecutive requests to different warm instances, each with
        # its own copy of this dict; without persistence, a token issued by
        # the instance that handled login is invisible to whichever instance
        # handles the very next request (see resolve_token()'s reload-on-miss
        # fallback, the other half of this fix).
        self.tokens: dict[str, dict] = {}
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
        # UV04 — parent-submitted reviews for the public landing page.
        # {id, parent_id, parent_name, rating, text, status, created_at,
        # rejection_reason}. See models.ReviewCreate's docstring for the
        # two-layer moderation this goes through before ever going public.
        self.reviews: dict[str, dict] = {}
        # CH21/PA34-35 — what a child said when explaining a saved item to
        # Pip, waiting for (or already given) the parent's verdict. {id,
        # child_id, content_id, text, input_mode, level_at, pip_reply,
        # status, created_at, decided_at}.
        self.explanations: dict[str, dict] = {}
        # UV06/PA03 — same cross-instance reasoning as `tokens` above, and
        # persisted for the same reason (a reset/verify link can just as
        # easily be requested and confirmed against two different instances).
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
                # Bulk import's trust boost (app/bulk_import.py): a channel here
                # is already trusted enough to be SEARCHED (see
                # content_sources.search_videos), so its videos also get an
                # easier auto-approve bar. Publishers are matched separately
                # (books aren't search-scoped) against Google Books' own
                # `publisher` field, case-insensitive substring match.
                "trusted_book_publishers": [],
            },
            "compliance": {
                "data_retention_days": 365, "pdpa_mode": True, "allow_under_13": True,
                # URS §2.5 Constraint 3 / Assumption 3 — see config.py's
                # ZDR_STATUS docstring. Surfaced here (SA10) so it's a real,
                # visible admin-facing status, not a fact buried in code.
                "openai_zdr_status": settings.ZDR_STATUS,
            },
            "website": {"site_title": "Pip — Reading Buddy", "tagline": "Safe, age-appropriate books & videos for kids", "announcement": ""},
            # Premium's real price (SA13) — used to be a single
            # `monthly_price`; `subscribe()` below never actually read it
            # (charged a hardcoded 999/9900 cents regardless of what an
            # admin set here) until a later pass wired it through for real,
            # not just displayed it.
            "billing": {
                "provider": "none", "currency": "SGD", "billing_enabled": False,
                "premium_monthly_price": 9.9, "premium_annual_price": 99.0,
            },
        }
        self.started = time.time()

        # See firestore_store.LoadFailed's docstring for the exact incident
        # this branch closes: a transient Firestore read error used to look
        # identical to "no state saved yet" here, so a single unlucky
        # cold-start network hiccup would seed fresh defaults AND
        # immediately persist them, permanently overwriting a real
        # snapshot. Now a real read failure seeds THIS PROCESS in memory
        # only (so it can still serve requests) but never calls save() —
        # nothing gets written to Firestore until a future request's
        # load actually succeeds and there's real state to persist.
        try:
            saved = firestore_store.load_state()
        except firestore_store.LoadFailed:
            self._seed()
            return
        if saved:
            self._restore(saved)
        else:
            self._seed()
            self.save()  # first run with Firestore configured: persist the seed immediately

    def record_topic_miss(self, topic: str, fmt: str = "any") -> None:
        """Tally one unmet request. Grouped by a singular key so "pirate" and
        "pirates" count together."""
        key = topic.rstrip("s") or topic
        now = time.time()
        row = next((r for r in self.topic_misses if r["key"] == key), None)
        if row is None:
            row = {"key": key, "topic": topic, "count": 0, "formats": {"book": 0, "video": 0, "any": 0},
                   "first_at": now, "last_at": now}
            self.topic_misses.append(row)
        row["count"] += 1
        row["formats"][fmt if fmt in ("book", "video") else "any"] += 1
        row["last_at"] = now

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
        self.topic_misses = state.get("topic_misses", [])
        self.tickets = state.get("tickets", [])
        self.content_overrides = state.get("content_overrides", {})
        self.notifications = state.get("notifications", [])
        self.billing_records = state.get("billing_records", [])
        self.chat_sessions = state.get("chat_sessions", {})
        self.deletion_requests = state.get("deletion_requests", [])
        self.reviews = state.get("reviews", {})
        self.explanations = state.get("explanations", {})
        self.tokens = state.get("tokens", {})
        self.verify_tokens = state.get("verify_tokens", {})
        self.reset_tokens = state.get("reset_tokens", {})
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
        # The merge above brings back ANY key an old saved snapshot has, even
        # one this code no longer defines. Scrub the two price fields of a
        # tier that no longer exists so they get cleaned out of stored data.
        self.system["billing"].pop("ultra_monthly_price", None)
        self.system["billing"].pop("ultra_annual_price", None)
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
            # GET /api/chat/resolved-topics — topics Pip once told THIS
            # child "no" to that a moderator/auto-import has since covered,
            # already mentioned once so it's never repeated on a later login.
            child.setdefault("notified_resolved_topics", [])
            # Articulation level (see profile.py) — every existing child
            # starts as an Explorer, no exceptions.
            child.setdefault("dob", None)
            child.setdefault("articulation_level", "explorer")
            child.setdefault("articulation_progress", 0)
            child.setdefault("level_up_pending", None)
            child.setdefault("level_history", [{"level": "explorer", "at": child.get("created", time.time())}])
            # A child with a date of birth keeps ageing: refresh the stored
            # band so the catalogue filter never serves a stale one.
            if child["dob"]:
                try:
                    child["age_band"] = profile.band_from_dob(child["dob"])
                except ValueError:
                    pass  # aged out of 5-12: keep the last band rather than lock them out
            # 2026-09-09 — login_id/pin split (see create_child's docstring).
            # A snapshot saved before this change has `linking_code` (the old
            # single value) but no `login_id` yet — backfill a real, unique
            # one now rather than leave an existing child (e.g. the demo
            # account) unable to activate a new device. `pin` itself needs
            # no migration — it already existed as its own field and this
            # change only removed a uniqueness constraint on it, not the
            # field.
            if "login_id" not in child:
                child["login_id"] = self._generate_unique_login_id()
            child.pop("linking_code", None)

    def save(self) -> None:
        """Persist the full prototype state to Firestore (no-op if
        unconfigured). `tokens`/`verify_tokens`/`reset_tokens` ARE included
        (see the 2026-09-08 fix below, resolve_token()'s docstring) — an
        earlier version of this deliberately excluded them as "short-lived,
        meant to expire, not survive a restart," which was true for a
        restart but missed the real failure mode on Vercel: multiple warm
        instances running *concurrently*, not sequentially, each with its
        own copy of this dict. A token issued by whichever instance handled
        login was invisible to whichever instance handled the very next
        request — reproduced live (login succeeds, the immediate follow-up
        `/api/children` call 401s "Invalid or expired token", and a page
        reload seconds later logs the user out entirely)."""
        firestore_store.save_state({
            "accounts": self.accounts,
            "children": self.children,
            "content": self.content,
            "favourites": self.favourites,
            "activity": self.activity,
            "feedback": self.feedback,
            "reports": self.reports,
            "topic_misses": self.topic_misses,
            "tickets": self.tickets,
            "content_overrides": self.content_overrides,
            "notifications": self.notifications,
            "billing_records": self.billing_records,
            "chat_sessions": self.chat_sessions,
            "deletion_requests": self.deletion_requests,
            "reviews": self.reviews,
            "explanations": self.explanations,
            "system": self.system,
            "tokens": self.tokens,
            "verify_tokens": self.verify_tokens,
            "reset_tokens": self.reset_tokens,
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

    def _clear_child_data(self, child_id: str, *, full: bool) -> None:
        """Wipes every collection keyed/filtered by this child_id. Shared by
        delete_child (PA09, full=True — the profile is gone right after
        this call, so dict entries are popped outright) and
        apply_due_deletions below (PA30, full=False — the profile stays
        usable afterward, so favourites/activity/feedback must stay
        present as *empty* containers instead of missing keys: several
        call sites index them directly — e.g. chat.py's `save_favourite`
        does `db.favourites[child["id"]]`, not `.get(...)` — and would
        KeyError on a still-living child whose entry had been popped)."""
        if full:
            self.favourites.pop(child_id, None)
            self.activity.pop(child_id, None)
            self.feedback.pop(child_id, None)
        else:
            self.favourites[child_id] = []
            self.activity[child_id] = []
            self.feedback[child_id] = []
        self.content_overrides.pop(child_id, None)
        for eid in [e for e, ex in self.explanations.items() if ex["child_id"] == child_id]:
            self.explanations.pop(eid, None)
        for sid in [s for s, sess in self.chat_sessions.items() if sess["child_id"] == child_id]:
            self.chat_sessions.pop(sid, None)
        self.reports[:] = [r for r in self.reports if r["child_id"] != child_id]

    def delete_child(self, child_id: str) -> None:
        """PA09 — full profile removal, distinct from PA30's "erase this
        child's data but keep the profile" flow (apply_due_deletions
        below). Found missing chat_sessions/feedback/reports cleanup here
        2026-09-11 (same pass that found delete_account's own review gap,
        prompted by a parent noticing a leftover test review in the admin
        queue) — none of these crash anything downstream (every read path
        already goes through `.get()` or `_owned_child`), but they're
        genuinely orphaned rows with no way to reach or clean up
        afterward, same shape as the review bug."""
        self.children.pop(child_id, None)
        self._clear_child_data(child_id, full=True)
        for tok, entry in list(self.tokens.items()):
            if entry["kind"] == "child" and entry["id"] == child_id:
                self.tokens.pop(tok, None)

    def delete_account(self, account_id: str):
        """Remove the account and everything belonging to it (PA06)."""
        for child in [c for c in self.children.values() if c["parent_id"] == account_id]:
            self.delete_child(child["id"])
        self.reports[:] = [r for r in self.reports if r["parent_id"] != account_id]
        self.notifications[:] = [n for n in self.notifications if n["parent_id"] != account_id]
        self.billing_records[:] = [b for b in self.billing_records if b["parent_id"] != account_id]
        # UV04 reviews — real gap found 2026-09-11 (during cleanup of
        # throwaway test accounts, not by a code audit): this method's own
        # docstring says "everything belonging to it," but a submitted
        # review kept `parent_id`/`parent_name` pointing at an account that
        # no longer existed once deleted here, leaving an orphaned review
        # (still shown in the admin queue, attributed to a deleted account)
        # behind with no way to clean it up except by hand.
        for rid in [r for r, rev in self.reviews.items() if rev["parent_id"] == account_id]:
            self.reviews.pop(rid, None)
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

    def _reload_from_firestore(self) -> bool:
        """Shared by resolve_token/refresh_account/refresh_child below — one
        cheap single-document Firestore read (see firestore_store.py's own
        docstring: the whole prototype state is one snapshot, not
        per-record documents), no-op in local dev where Firebase isn't
        configured (`load_state()` returns None).

        A transient read failure (`LoadFailed`) is swallowed here on
        purpose, same "don't take the request down over it" posture the
        old code had — the difference (see `__init__` and
        `firestore_store.LoadFailed`'s docstring) is this call site was
        never the dangerous one: it only ever *restores* on success, it
        never seeds-and-saves on failure, so skipping the reload and
        carrying on with whatever's already in memory was always safe."""
        try:
            saved = firestore_store.load_state()
        except firestore_store.LoadFailed:
            return False
        if saved:
            self._restore(saved)
        return bool(saved)

    def resolve_token(self, token: str):
        entry = self.tokens.get(token)
        if entry is not None:
            return entry
        # Cross-instance fallback (2026-09-08 fix — see save()'s docstring
        # for the bug this closes). This instance's own in-memory `tokens`
        # doesn't have it, but another concurrently-warm instance may have
        # issued it and already saved it to Firestore (issuing a token
        # always happens inside a mutating POST, which main.py's
        # persist_state middleware saves right after). Reload once before
        # concluding the token is genuinely invalid.
        if self._reload_from_firestore():
            entry = self.tokens.get(token)
        return entry

    def refresh_account(self, account_id: str):
        """2026-09-09 fix — the OTHER half of the cross-instance problem
        `resolve_token`'s reload-on-miss above only closes for the token
        itself, not for what it points to. Real bug reproduced: a parent
        verifies their email (write served + persisted by instance A), then
        a *different*, already-warm instance B — which cached this same
        account token earlier and so never takes resolve_token's miss/
        reload path at all — keeps answering `current_account()` calls from
        its own now-stale in-memory `accounts` snapshot, so PA07's
        `parent.get("verified")` check still sees the old `False` and
        rejects "Create profile" with "please verify your email" even
        though the account genuinely is verified. Logging out and back in
        "worked around" it (a fresh request has a decent chance of landing
        on a different/fresher instance) without actually fixing anything.

        Real fix: reload the full snapshot on every authenticated request,
        not only when a token lookup misses — see deps.py's
        `current_account`. Cheap enough at this prototype's scale (a
        handful of users/children) to not worry about the extra read."""
        self._reload_from_firestore()
        return self.accounts.get(account_id)

    def refresh_child(self, child_id: str):
        """Same fix as refresh_account, for the child-session side of auth
        (deps.py's `current_child`) — e.g. a PA18 safety-setting change or a
        PA21/lock-state update made via one instance should be visible to
        the very next chat request even if it lands on a different one."""
        self._reload_from_firestore()
        return self.children.get(child_id)

    def refresh_public(self) -> None:
        """2026-09-10 — the same cross-instance staleness class as
        refresh_account/refresh_child above, but for routers/public.py's
        no-login endpoints, which never went through either of those (no
        token to resolve at all). Real symptom: an admin approves a new
        review, but the live landing page — served by a different, already-
        warm instance that has no reason to ever reload on its own — keeps
        showing the old, review-less state indefinitely. Same fix, applied
        here explicitly since there's no auth flow to piggyback on."""
        self._reload_from_firestore()

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
                    # Used to only reset activity/favourites/feedback —
                    # chat_sessions and content_overrides survived a PA30
                    # "erase my child's data" request untouched, which
                    # undersells what this compliance-facing action
                    # actually claims to do. Same _clear_child_data helper
                    # delete_child (PA09) uses, full=False since this
                    # request explicitly keeps the profile itself alive.
                    self._clear_child_data(child_id, full=False)
                record["status"] = "completed"

    # ---------- UV04 reviews ----------

    def add_review(self, parent_id: str, parent_name: str, rating: int, text: str,
                    status: str, rejection_reason: str | None = None,
                    ai_recommend: bool | None = None, ai_reason: str | None = None) -> dict:
        review = {
            "id": _new_id(), "parent_id": parent_id, "parent_name": parent_name,
            "rating": rating, "text": text, "status": status,
            "created_at": time.time(), "rejection_reason": rejection_reason,
            "ai_recommend": ai_recommend, "ai_reason": ai_reason,
        }
        self.reviews[review["id"]] = review
        return review

    def review_by_parent(self, parent_id: str) -> dict | None:
        """A parent's own latest review (any status) — their own status
        view, not the public listing. A rejected review doesn't block a
        fresh submission; this just always reports the most recent one."""
        mine = [r for r in self.reviews.values() if r["parent_id"] == parent_id]
        return max(mine, key=lambda r: r["created_at"]) if mine else None

    def public_reviews(self, limit: int = 10) -> list[dict]:
        """UV04 — only ever reviews an admin has explicitly approved (see
        ReviewCreate's docstring for the AI-screen-then-admin-approve gate
        this already went through before landing here). "Best" first:
        highest star rating, most recent as the tiebreak — capped at 10,
        same ceiling the landing page's own request asked for."""
        approved = [r for r in self.reviews.values() if r["status"] == "approved"]
        ordered = sorted(approved, key=lambda r: (-r["rating"], -r["created_at"]))
        return ordered[:max(1, min(limit, 10))]

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
        """`tier` is "premium" (SubscribeRequest). Price actually comes from
        `system.billing`'s admin-configured values, not a hardcoded
        constant."""
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

    # Excludes visually-ambiguous characters (0/O, 1/I/L) — this gets
    # read off a screen and typed back in by a young child, so every
    # character needs to survive that round-trip unambiguously.
    _LOGIN_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

    def _generate_unique_login_id(self) -> str:
        """CH01's device-activation identifier (2026-09-09 — replaces the
        earlier "linking code IS the PIN" design). Alphanumeric, not
        numeric-only: it only has to be typed once, during a parent-assisted
        one-time device setup, never independently by the child day-to-day
        (see PinOnlyLogin/CH02, which never asks for this again) — so it can
        afford to be a real, separate, non-secret identifier instead of
        doubling as the login credential itself. Kept unique across ALL
        children (not just one parent's own), same reasoning pin_in_use used
        to have: it's the lookup key CH01 resolves a child from."""
        for _ in range(20):
            candidate = "".join(secrets.choice(self._LOGIN_ID_ALPHABET) for _ in range(6))
            if not self.login_id_in_use(candidate):
                return candidate
        raise RuntimeError("Could not generate a unique login ID after 20 attempts — the code space is far more saturated than expected.")

    def _generate_pin(self) -> str:
        """The actual secret, checked only ever alongside a specific child's
        own login_id (never used on its own to look a child up) — so unlike
        login_id, this does NOT need to be globally unique. Two different
        families' children can perfectly reasonably land on the same 6-digit
        PIN, the same way two people can share a 4-digit ATM PIN once it's
        paired with a distinguishing account number."""
        return f"{secrets.randbelow(1_000_000):06d}"

    def create_child(self, parent_id: str, name: str, age_band: str, reading_level=None, gender=None, interests=None, dob=None) -> dict:
        """PA07/PA10/CH01. Two separate system-generated values, not one
        doing double duty (see _generate_unique_login_id's docstring for why
        this changed from the original single-code design): `login_id`
        identifies the child (shown on the parent dashboard, typed once at
        CH01 device setup — usually parent-assisted); `pin` is the actual
        secret, typed by the child on every login (CH01 and CH02 alike).
        Neither is parent-chosen, for the same reason as before: nothing
        about either needs to be memorable to the parent, and system
        generation avoids predictable values (birthdates, "123456")."""
        child = {
            "id": _new_id(),
            "parent_id": parent_id,
            "name": name,
            "age_band": age_band,
            "reading_level": reading_level,
            "gender": gender,
            "interests": interests or [],
            "dob": dob,
            "articulation_level": "explorer",
            "articulation_progress": 0,
            "level_up_pending": None,  # {"from","to"} until Pip has told the child
            "level_history": [{"level": "explorer", "at": time.time()}],
            "login_id": self._generate_unique_login_id(),
            "pin": self._generate_pin(),
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
            "notified_resolved_topics": [],  # GET /api/chat/resolved-topics
        }
        self.children[child["id"]] = child
        self.favourites[child["id"]] = []
        self.activity[child["id"]] = []
        self.feedback[child["id"]] = []
        return child

    # ---------- CH21 / PA34-35: explanations and articulation level ----------

    def explanations_for(self, child_id: str) -> list[dict]:
        """Newest first."""
        rows = [e for e in self.explanations.values() if e["child_id"] == child_id]
        return sorted(rows, key=lambda e: e["created_at"], reverse=True)

    def explanation_blocks_item(self, child_id: str, content_id: str) -> bool:
        """A pending or confirmed explanation uses the item up, but only for the
        level the child is at right now: once they move up, the same book can
        be told again in more detail, and the parent judges it against the new
        level. That keeps a Free child (5 favourites) from running out of
        things to explain before the top level. A declined explanation never
        uses an item up. It lives on the explanation, not the favourite, so
        un-saving and re-saving a book doesn't reset it."""
        child = self.children.get(child_id) or {}
        level = child.get("articulation_level", "explorer")
        return any(
            e["child_id"] == child_id and e["content_id"] == content_id
            and e["status"] in ("pending", "confirmed") and e["level_at"] == level
            for e in self.explanations.values()
        )

    def pending_explanation_count(self, child_id: str) -> int:
        return sum(1 for e in self.explanations.values() if e["child_id"] == child_id and e["status"] == "pending")

    def add_explanation(self, child: dict, content_id: str, text: str, input_mode: str, pip_reply: str) -> dict:
        exp = {
            "id": _new_id(),
            "child_id": child["id"],
            "content_id": content_id,
            "text": text,
            "input_mode": input_mode,
            "level_at": child.get("articulation_level", "explorer"),
            "pip_reply": pip_reply,
            "status": "pending",
            "created_at": time.time(),
            "decided_at": None,
        }
        self.explanations[exp["id"]] = exp
        return exp

    def decide_explanation(self, explanation_id: str, confirm: bool) -> tuple[dict, bool] | None:
        """PA35. Returns (explanation, leveled_up), or None when it doesn't
        exist or was already decided. Three confirmations promote the child
        one level; Storyteller is the top, after which explanations are still
        reviewed but nothing counts."""
        exp = self.explanations.get(explanation_id)
        if not exp or exp["status"] != "pending":
            return None
        exp["status"] = "confirmed" if confirm else "declined"
        exp["decided_at"] = time.time()
        leveled_up = False
        child = self.children.get(exp["child_id"])
        if confirm and child and profile.next_level(child["articulation_level"]):
            child["articulation_progress"] = child.get("articulation_progress", 0) + 1
            if child["articulation_progress"] >= profile.CONFIRMATIONS_PER_LEVEL:
                old = child["articulation_level"]
                new = profile.next_level(old)
                child["articulation_level"] = new
                child["articulation_progress"] = 0
                child["level_up_pending"] = {"from": old, "to": new}
                child.setdefault("level_history", []).append({"level": new, "at": time.time()})
                leveled_up = True
        return exp, leveled_up

    def children_of(self, parent_id: str) -> list[dict]:
        return [c for c in self.children.values() if c["parent_id"] == parent_id]

    def find_child_by_login_id(self, login_id: str):
        login_id = login_id.strip().upper()
        return next((c for c in self.children.values() if c["login_id"] == login_id), None)

    def regenerate_login_id(self, child: dict) -> dict:
        """PA10 — a parent resets the ID (lost, or handed to the wrong
        device). Same system-generated, unique-by-construction path as
        create_child."""
        child["login_id"] = self._generate_unique_login_id()
        # A fresh ID deserves a fresh lockout state too, same reasoning as
        # regenerate_pin below — a parent regenerating specifically to fix a
        # locked-out child shouldn't still see it locked afterward.
        child["failed_pin_attempts"] = 0
        child["locked"] = False
        return child

    def regenerate_pin(self, child: dict) -> dict:
        """PA10 — a parent resets the PIN (lost/shared with the wrong
        person). Same system-generated path as create_child."""
        child["pin"] = self._generate_pin()
        child["failed_pin_attempts"] = 0
        child["locked"] = False
        return child

    def login_id_in_use(self, login_id: str, exclude_child_id: str | None = None) -> bool:
        """Must be checked globally (across ALL parents), not scoped to one
        parent's own children — this is CH01's lookup key, so a collision
        would mean `find_child_by_login_id` nondeterministically resolves to
        whichever child happens to be first in the dict, letting one
        family's child land in a *different* family's chat/favourites/
        history. (The PIN itself has no equivalent check — see
        _generate_pin's docstring for why it doesn't need one.)"""
        return any(
            c.get("login_id") == login_id and c["id"] != exclude_child_id
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
        item = {"id": _new_id(), "status": status, "embedding": None, "created_at": time.time(), **data}
        self.content[item["id"]] = item
        return item

    def approved_content(self) -> list[dict]:
        return [c for c in self.content.values() if c["status"] == "approved"]

    def set_embedding(self, content_id: str, embedding: list[float] | None) -> None:
        if content_id in self.content:
            self.content[content_id]["embedding"] = embedding

    def remove_content(self, content_id: str) -> None:
        """CM05 — real gap found 2026-09-11 (same pass as delete_child/
        delete_account's review gap): removing a catalogue item used to
        just `db.content.pop(content_id, None)` and stop there, leaving
        every child's `favourites` entry for it behind. Both
        chat.py's/oversight.py's favourites-listing endpoints already
        guard with `if item:` so a removed item's favourite just silently
        stops rendering — no crash — but `save_favourite`'s free-tier cap
        (`len(favs) >= FREE_FAVOURITES_LIMIT`) counts the *raw* list
        length, phantom entries included. A free-tier child who favourited
        5 items, one of which later got removed from the catalogue, was
        permanently stuck reporting "5 favourites used" while only 4 ever
        showed — with no favourite visibly there to unsave and free the
        slot back up. Also clears any PA18 content_overrides pointing at
        this item, which are otherwise just inert clutter, not a bug."""
        self.content.pop(content_id, None)
        for child_id, favs in self.favourites.items():
            self.favourites[child_id] = [f for f in favs if f["content_id"] != content_id]
        for overrides in self.content_overrides.values():
            overrides.pop(content_id, None)

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
