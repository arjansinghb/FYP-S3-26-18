"""End-to-end smoke test across all five actors' real endpoints.

Not a unit-test suite (this prototype doesn't have pytest fixtures/mocking
set up — see agent-context notes) — this hits a REAL RUNNING backend over
HTTP, the same way the real frontend does, and checks the actual response.
Exit code is non-zero if anything fails, and every check prints PASS/FAIL so
a run is a structured, skimmable report instead of one-off manual curls.

Usage:
    ./.venv/bin/python scripts/smoke_test.py --base-url http://localhost:8010
"""
from __future__ import annotations

import argparse
import sys
import time

import httpx

FAILURES: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {label}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(f"{label}: {detail}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8010")
    args = parser.parse_args()

    c = httpx.Client(base_url=args.base_url, timeout=30)
    stamp = int(time.time())

    # ---------- UV: Unregistered Visitor ----------
    print("\n== Unregistered Visitor ==")
    r = c.get("/api/public/site")
    check("UV01/02 landing content", r.status_code == 200, r.text)
    r = c.get("/api/public/plans")
    check("UV03 subscription plans", r.status_code == 200, r.text)

    email_a = f"smoke-a-{stamp}@example.com"
    r = c.post("/api/auth/signup", json={"email": email_a, "password": "Smoke1234", "name": "Smoke Parent A"})
    check("UV05 signup", r.status_code == 200, r.text)
    signup = r.json()
    parent_token = signup["token"]
    ph = {"Authorization": f"Bearer {parent_token}"}
    check("UV05 account starts unverified", signup["account"]["verified"] is False, str(signup["account"]))

    r = c.post("/api/auth/verify/confirm", json={"token": signup["verify_token"]})
    check("UV06 confirm verification", r.status_code == 200 and r.json()["verified"] is True, r.text)

    r = c.post("/api/auth/signup", json={"email": email_a, "password": "Smoke1234", "name": "Dup"})
    check("UV05 duplicate email rejected", r.status_code == 409, r.text)

    # a second parent, purely to prove PIN uniqueness is enforced ACROSS
    # families (not just within one parent's own children)
    email_b = f"smoke-b-{stamp}@example.com"
    r = c.post("/api/auth/signup", json={"email": email_b, "password": "Smoke1234", "name": "Smoke Parent B"})
    signup_b = r.json()
    bh = {"Authorization": f"Bearer {signup_b['token']}"}
    c.post("/api/auth/verify/confirm", json={"token": signup_b["verify_token"]})
    c.post("/api/account/consent", headers=bh, json={"password": "Smoke1234"})

    # ---------- PA: Parent ----------
    print("\n== Parent ==")
    r = c.post("/api/auth/login", json={"email": email_a, "password": "Smoke1234"})
    check("PA01 login", r.status_code == 200, r.text)

    r = c.get("/api/auth/me", headers=ph)
    check("PA04 view account", r.status_code == 200, r.text)

    r = c.patch("/api/auth/me", headers=ph, json={"name": "Smoke Parent A Updated"})
    check("PA05 update account", r.status_code == 200 and r.json()["name"] == "Smoke Parent A Updated", r.text)

    r = c.post("/api/children", headers=ph, json={"name": "Kid", "age_band": "5-8"})
    check("PA07 blocked before consent", r.status_code == 403, r.text)

    r = c.post("/api/account/consent", headers=ph, json={"password": "wrongpassword"})
    check("PA28 consent rejects wrong password", r.status_code == 401, r.text)
    r = c.post("/api/account/consent", headers=ph, json={"password": "Smoke1234"})
    check("PA28 consent (right password)", r.status_code == 200 and r.json()["given"] is True, r.text)

    r = c.post("/api/children", headers=ph, json={"name": "Kid A1", "age_band": "5-8"})
    check("PA07 create child (after consent)", r.status_code == 201, r.text)
    child_a1 = r.json()
    # login_id (alphanumeric identifier) and pin (numeric secret) are two
    # genuinely separate system-generated values as of 2026-09-09 — see
    # storage.create_child's docstring — not supplied by this test.
    login_id_a = child_a1["login_id"]
    pin_a = child_a1["pin"]
    check("PA07 system-generated login ID is 6 alphanumeric chars",
          bool(login_id_a) and len(login_id_a) == 6 and login_id_a.isalnum(), login_id_a)
    check("PA07 system-generated PIN is 6 digits", bool(pin_a) and len(pin_a) == 6 and pin_a.isdigit(), pin_a)

    # No more "supply a colliding PIN" test — there's no longer a way to:
    # the whole point of generating it server-side is that two families can
    # never collide by construction. Verify that directly instead: a second
    # child (different family) gets a DIFFERENT login ID, not the same one.
    r = c.post("/api/children", headers=bh, json={"name": "Kid B1", "age_band": "5-8"})
    check("PA07 create child for a different family", r.status_code == 201, r.text)
    child_b1 = r.json()
    check("system-generated login IDs differ across families", child_b1["login_id"] != login_id_a,
          f"{child_b1['login_id']} vs {login_id_a}")

    r = c.post(f"/api/children/{child_a1['id']}/regenerate-pin", headers=ph)
    check("PA10 regenerate PIN", r.status_code == 200, r.text)
    regenerated = r.json()
    check("PA10 regenerated PIN actually changes", regenerated["pin"] != pin_a, regenerated["pin"])
    check("PA10 regenerating the PIN doesn't touch login_id", regenerated["login_id"] == login_id_a, regenerated["login_id"])
    pin_a = regenerated["pin"]  # the old one is dead from here on

    r = c.post(f"/api/children/{child_a1['id']}/regenerate-login-id", headers=ph)
    check("PA10 regenerate login ID", r.status_code == 200, r.text)
    regenerated = r.json()
    check("PA10 regenerated login ID actually changes", regenerated["login_id"] != login_id_a, regenerated["login_id"])
    check("PA10 regenerating the login ID doesn't touch pin", regenerated["pin"] == pin_a, regenerated["pin"])
    login_id_a = regenerated["login_id"]  # the old one is dead from here on

    r = c.patch(f"/api/children/{child_a1['id']}", headers=ph, json={"reading_level": "early"})
    check("PA08 edit child", r.status_code == 200, r.text)

    r = c.put(f"/api/children/{child_a1['id']}/settings", headers=ph,
              json={"allow_books": True, "allow_videos": False, "block_external_links": True})
    check("PA21 safety settings", r.status_code == 200, r.text)

    r = c.get(f"/api/children/{child_a1['id']}/activity", headers=ph)
    check("PA14 view activity", r.status_code == 200, r.text)

    r = c.get(f"/api/children/{child_a1['id']}/favourites", headers=ph)
    check("PA15/19 view favourites (with external link)", r.status_code == 200, r.text)

    r = c.get("/api/account/notification-preferences", headers=ph)
    check("PA22 get notification prefs", r.status_code == 200, r.text)
    r = c.patch("/api/account/notification-preferences", headers=ph, json={"in_app": True})
    check("PA22 set notification prefs", r.status_code == 200, r.text)
    r = c.get("/api/account/notifications", headers=ph)
    check("PA20 list notifications", r.status_code == 200, r.text)

    r = c.get("/api/account/privacy-settings", headers=ph)
    check("PA29 get privacy settings", r.status_code == 200, r.text)
    r = c.patch("/api/account/privacy-settings", headers=ph, json={"retention_preference": "minimal"})
    check("PA29 update privacy settings", r.status_code == 200, r.text)

    r = c.get("/api/account/subscription", headers=ph)
    check("PA23 view subscription status", r.status_code == 200 and r.json()["tier"] == "free", r.text)

    r = c.post("/api/account/subscribe", headers=ph, json={"billing_cycle": "monthly"})
    check("PA24 subscribe without payment method is rejected", r.status_code == 400, r.text)
    r = c.put("/api/account/payment-method", headers=ph, json={"brand": "visa", "last4": "4242"})
    check("PA26 set payment method", r.status_code == 200, r.text)
    r = c.post("/api/account/subscribe", headers=ph, json={"billing_cycle": "monthly"})
    check("PA24 subscribe premium (payment method on file)", r.status_code == 200 and r.json()["tier"] == "premium", r.text)

    r = c.get("/api/account/billing-history", headers=ph)
    check("PA27 billing history", r.status_code == 200 and len(r.json()) >= 1, r.text)

    r = c.post("/api/account/cancel-premium", headers=ph)
    check("PA25 cancel premium (scheduled, not instant)", r.status_code == 200 and r.json()["tier"] == "premium" and r.json()["cancel_at"], r.text)
    r = c.post("/api/account/resume-premium", headers=ph)
    check("PA25 resume before cancellation takes effect", r.status_code == 200 and not r.json()["cancel_at"], r.text)

    r = c.post("/api/children", headers=ph, json={"name": "Kid A2", "age_band": "9-12"})
    check("PA33 second child allowed on premium", r.status_code == 201, r.text)
    child_a2 = r.json()
    check("second child in the same family also gets its own distinct login ID",
          child_a2["login_id"] != login_id_a, child_a2["login_id"])

    r = c.get(f"/api/children/{child_a1['id']}/trends", headers=ph)
    check("PA31 child trends (premium)", r.status_code == 200, r.text)
    r = c.get("/api/children/compare", headers=ph)
    check("PA32 multi-child comparison (premium, 2+ children)", r.status_code == 200 and len(r.json()) == 2, r.text)

    real_item_id = c.get("/api/content", headers=ph, params={"status": "approved"}).json()[0]["id"]
    r = c.put(f"/api/children/{child_a1['id']}/content-overrides/{real_item_id}", headers=ph, json={"action": "hide"})
    check("PA18 set content override", r.status_code == 200, r.text)
    r = c.get(f"/api/children/{child_a1['id']}/content-overrides", headers=ph)
    check("PA18 list content overrides", r.status_code == 200 and len(r.json()) == 1, r.text)

    r = c.post(f"/api/account/children/{child_a1['id']}/data-deletion", headers=ph)
    check("PA30 data deletion request", r.status_code == 200, r.text)
    deletion = r.json()
    r = c.get(f"/api/account/children/{child_a1['id']}/data-deletion", headers=ph)
    check("PA30 list data deletion requests", r.status_code == 200 and len(r.json()) == 1, r.text)
    r = c.post(f"/api/account/data-deletion/{deletion['id']}/cancel", headers=ph)
    check("PA30 cancel data deletion (alt flow)", r.status_code == 200, r.text)

    # ---------- CH: Child ----------
    print("\n== Child ==")
    r = c.post("/api/children/link", json={"login_id": login_id_a, "pin": pin_a})
    check("CH01 link with login ID + PIN", r.status_code == 200, r.text)
    ch1 = {"Authorization": f"Bearer {r.json()['token']}"}

    r = c.post("/api/children/link", json={"login_id": login_id_a, "pin": "000000"})
    check("CH01 rejects a login ID with a non-matching PIN", r.status_code in (401, 403), r.text)

    r = c.post(f"/api/children/{child_a1['id']}/login", json={"pin": pin_a})
    check("CH02 return login (PIN only)", r.status_code == 200, r.text)

    # PIN lockout (real security feature — 5 wrong tries locks the profile)
    for _ in range(5):
        c.post(f"/api/children/{child_a1['id']}/login", json={"pin": "000000"})
    r = c.post(f"/api/children/{child_a1['id']}/login", json={"pin": pin_a})  # even the RIGHT pin, once locked
    check("CH02 profile locks after repeated wrong PINs", r.status_code == 403, r.text)
    r = c.post(f"/api/children/{child_a1['id']}/unlock", headers=ph)
    check("parent can unlock a locked profile", r.status_code == 200 and r.json()["locked"] is False, r.text)
    r = c.post(f"/api/children/{child_a1['id']}/login", json={"pin": pin_a})
    check("CH02 login works again after unlock", r.status_code == 200, r.text)
    ch1 = {"Authorization": f"Bearer {r.json()['token']}"}

    r = c.get("/api/child/me", headers=ch1)
    check("child session resolves", r.status_code == 200, r.text)

    r = c.post("/api/chat/sessions", headers=ch1)
    check("CH04 start chat session", r.status_code == 201, r.text)
    session = r.json()

    r = c.post("/api/chat", headers=ch1, json={"message": "a funny book about animals please", "session_id": session["id"]})
    check("CH06/08/09/10 chat returns reply", r.status_code == 200 and r.json().get("reply"), r.text)
    chat_data = r.json()
    check("recs respect allow_videos=False (PA21)", all(x["type"] != "video" for x in chat_data.get("recommendations", [])), str(chat_data))

    if chat_data.get("recommendations"):
        item_id = chat_data["recommendations"][0]["id"]
        r = c.post("/api/chat/favourite", headers=ch1, json={"content_id": item_id, "liked": True})
        check("CH15 save favourite", r.status_code == 201, r.text)
        r = c.get("/api/chat/favourites", headers=ch1)
        check("CH16 view favourites (enriched, no external_ref leak to child)", r.status_code == 200 and len(r.json()) >= 1 and "external_ref" not in r.json()[0], r.text)
        r = c.post("/api/chat/feedback", headers=ch1, json={"content_id": item_id, "liked": True})
        check("CH17 feedback", r.status_code == 200, r.text)

    r = c.post("/api/chat", headers=ch1, json={"message": "something else please", "session_id": session["id"]})
    check("CH18 request alternative", r.status_code == 200, r.text)

    r = c.put("/api/child/avatar", headers=ch1, json={"avatar": "blue"})
    check("CH19/20 choose/edit avatar", r.status_code == 200, r.text)

    r = c.post(f"/api/chat/sessions/{session['id']}/end", headers=ch1)
    check("CH05 end chat session", r.status_code == 200, r.text)

    r = c.delete(f"/api/children/{child_a2['id']}", headers=ph)
    check("PA09 delete child", r.status_code == 204, r.text)

    # ---------- CM: Content Moderator ----------
    print("\n== Content Moderator ==")
    r = c.post("/api/auth/login", json={"email": "moderator@pip.local", "password": "moderator123"})
    check("CM01 moderator login (shared auth mechanism)", r.status_code == 200, r.text)
    mh = {"Authorization": f"Bearer {r.json()['token']}"}

    r = c.get("/api/content", headers=mh, params={"status": "pending"})
    check("CM06/13 browse pending queue", r.status_code == 200, r.text)

    r = c.get("/api/content/search/books", headers=mh, params={"q": "dinosaurs"})
    check("CM03 real Google Books search", r.status_code == 200 and len(r.json()) > 0, r.text)
    book_hit = r.json()[0]

    r = c.get("/api/content/search/videos", headers=mh, params={"q": "science for kids"})
    check("CM03 real YouTube search", r.status_code == 200 and len(r.json()) > 0, r.text)

    r = c.post("/api/content/import", headers=mh, json={
        "type": "book", "title": book_hit["title"], "description": book_hit.get("synopsis", ""),
        "age_bands": ["9-12"], "genres": ["adventure"], "source": "google_books",
        "external_ref": book_hit.get("source_url"), "thumbnail": book_hit.get("thumbnail"),
    })
    check("CM03/06 import a real search result (lands pending)", r.status_code == 201 and r.json()["status"] == "pending", r.text)
    imported = r.json()

    r = c.post(f"/api/content/{imported['id']}/approve", headers=mh)
    check("CM07 approve content", r.status_code == 200 and r.json()["status"] == "approved", r.text)
    r = c.post(f"/api/content/{imported['id']}/reject", headers=mh)
    check("CM08 reject content", r.status_code == 200 and r.json()["status"] == "rejected", r.text)
    r = c.patch(f"/api/content/{imported['id']}", headers=mh, json={**imported, "reading_level": "middle"})
    check("CM09/10 edit age-band/genre/reading-level tags", r.status_code == 200, r.text)
    r = c.delete(f"/api/content/{imported['id']}", headers=mh)
    check("CM05 remove entry", r.status_code == 204, r.text)

    r = c.get("/api/reports", headers=mh)
    check("CM11 review reported content queue", r.status_code == 200, r.text)

    # ---------- SA: System Admin ----------
    print("\n== System Admin ==")
    r = c.post("/api/auth/login", json={"email": "admin@pip.local", "password": "admin123"})
    check("SA01 admin login (shared auth mechanism)", r.status_code == 200, r.text)
    ah = {"Authorization": f"Bearer {r.json()['token']}"}

    r = c.get("/api/admin/users", headers=ah, params={"q": f"smoke-a-{stamp}"})
    check("SA04 search user", r.status_code == 200 and len(r.json()) == 1, r.text)

    r = c.get(f"/api/admin/users/{signup['account']['id']}", headers=ah)
    check("SA05 view user details", r.status_code == 200, r.text)

    r = c.post(f"/api/admin/users/{signup['account']['id']}/suspend", headers=ah)
    check("SA06 suspend user", r.status_code == 200, r.text)
    r = c.post("/api/auth/login", json={"email": email_a, "password": "Smoke1234"})
    check("suspended account actually blocked from login", r.status_code == 403, r.text)
    r = c.post(f"/api/admin/users/{signup['account']['id']}/unsuspend", headers=ah)
    check("SA07 unsuspend user", r.status_code == 200, r.text)

    r = c.post(f"/api/admin/users/{signup['account']['id']}/reset-password", headers=ah, json={"new_password": "SmokeReset123"})
    check("SA03 admin reset password", r.status_code == 200, r.text)

    r = c.get("/api/admin/stats", headers=ah)
    check("SA08 system health/stats", r.status_code == 200, r.text)

    r = c.get("/api/admin/config/compliance", headers=ah)
    check("SA10 get compliance config", r.status_code == 200, r.text)
    check("SA10 ZDR status visible in compliance config", "openai_zdr_status" in r.json(), r.text)
    r = c.get("/api/admin/config/website", headers=ah)
    check("SA12 get website config", r.status_code == 200, r.text)
    original_website_config = r.json()  # this is shared, live site config, not
    # test-scoped data — must be restored, unlike the throwaway accounts this
    # script creates and deletes itself (see Cleanup below).
    r = c.put("/api/admin/config/website", headers=ah, json={**original_website_config, "announcement": "smoke-test"})
    check("SA12 update website config", r.status_code == 200 and r.json()["announcement"] == "smoke-test", r.text)
    r = c.put("/api/admin/config/website", headers=ah, json=original_website_config)
    check("SA12 website config restored after test", r.status_code == 200 and r.json()["announcement"] == original_website_config["announcement"], r.text)

    r = c.get("/api/admin/tickets", headers=ah)
    check("SA14 view support tickets", r.status_code == 200, r.text)
    if r.json():
        r = c.post(f"/api/admin/tickets/{r.json()[0]['id']}/resolve", headers=ah)
        check("SA14 resolve a support ticket", r.status_code == 200, r.text)

    # ---------- cleanup ----------
    print("\n== Cleanup ==")
    r = c.post("/api/auth/login", json={"email": email_a, "password": "SmokeReset123"})
    if r.status_code == 200:
        t = {"Authorization": f"Bearer {r.json()['token']}"}
        r2 = c.delete("/api/auth/me", headers=t)
        check("PA06 delete account A (cleanup)", r2.status_code == 204, r2.text)
    else:
        check("PA06 delete account A (cleanup)", False, "could not log back in: " + r.text)
    r = c.delete("/api/auth/me", headers=bh)
    check("PA06 delete account B (cleanup)", r.status_code == 204, r.text)

    print(f"\n{'=' * 50}")
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S):")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
