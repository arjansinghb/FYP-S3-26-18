"""UV05 signup email validation (app/email_validation.py) — format AND a
real DNS check on the domain, not format alone. The whole point: a
made-up domain like "fajndkan.anc" is syntactically a perfectly fine
email ("local@domain.tld"), so format-only validation would wave it
through — a real, reproduced case: that exact address signed up and even
ended up "VERIFIED" (see auth.py's signup() docstring for why — Resend's
free-tier sandbox can't actually deliver to it, and the fallback that
exists for a genuine delivery failure doesn't know the difference from
"there was never a real inbox here").

The DNS check queries MX, not A — see email_validation.py's own module
docstring's 2026-09-23 addendum for the real, reproduced follow-up gap: a
domain can be genuinely registered/resolving (so an A-record check waves
it through) while still explicitly declaring via a Null MX record (RFC
7505) that it never accepts mail — "kadnkandkan@nakna.com" was the real
case that surfaced this. It's a DNS-over-HTTPS request (`httpx.get`), not
a raw `socket.getaddrinfo()` call — see that same docstring for the real,
reproduced Vercel-sandbox incompatibility that ruled sockets out. It's OFF
by default in this suite (see conftest.py — no real network calls from a
free, deterministic test run); this file re-enables it via monkeypatch and
fakes `httpx.get` so the DNS logic is still fully exercised without ever
touching the network.
"""
import httpx
import pytest
from fastapi.testclient import TestClient

from app import email_validation
from app.config import settings


class _FakeResponse:
    """Just enough of httpx.Response's surface for is_plausible_email:
    `.raise_for_status()` and `.json()`."""
    def __init__(self, status_code=200, dns_status=0, answers=None):
        self.status_code = status_code
        self._dns_status = dns_status
        self._answers = answers

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=None, response=self)

    def json(self):
        body = {"Status": self._dns_status}
        if self._answers is not None:
            body["Answer"] = self._answers
        return body


@pytest.fixture(autouse=True)
def dns_check_on(monkeypatch):
    """Every test in this file wants the real logic path, not the
    suite-wide default of skipping the DNS half entirely."""
    monkeypatch.setattr(settings, "EMAIL_DOMAIN_CHECK_ENABLED", True)


# ---- format alone (no DNS call should even happen) ----

@pytest.mark.parametrize("bad", [
    "", "   ", "not-an-email", "missing-at.example.com", "@example.com",
    "spaces in@example.com", "no-domain@", "no-tld@example", "two@@example.com",
])
def test_malformed_addresses_are_rejected_without_touching_dns(bad, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("a malformed address must never reach the DNS check")

    monkeypatch.setattr(httpx, "get", boom)
    assert email_validation.is_plausible_email(bad) is False


# ---- the DNS half ----

def test_a_domain_with_real_mx_records_passes(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(
        dns_status=0, answers=[{"data": "10 mail.example.com."}],
    ))
    assert email_validation.is_plausible_email("parent@example.com") is True


def test_a_domain_with_no_mx_answer_at_all_still_passes(monkeypatch):
    """NOERROR with an empty Answer (no explicit MX either way) is still
    technically deliverable via SMTP's A-record fallback — see the module
    docstring's 2026-09-23 addendum. Not enough to reject on."""
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(dns_status=0, answers=[]))
    assert email_validation.is_plausible_email("parent@example.com") is True


def test_null_mx_domain_is_rejected(monkeypatch):
    """The exact reproduced follow-up case: "nakna.com" is a real,
    DNS-resolving, registered domain (an A-record-only check waves it
    through) that explicitly declares via a Null MX record (RFC 7505,
    priority 0, exchange ".") that it will never accept mail."""
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(
        dns_status=0, answers=[{"data": "0 ."}],
    ))
    assert email_validation.is_plausible_email("kadnkandkan@nakna.com") is False


def test_nxdomain_is_rejected(monkeypatch):
    """The exact reproduced case: "fajndkan.anc" is a well-formed local@domain.tld
    shape, but the domain simply does not exist — DNS Status 3 = NXDOMAIN."""
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(dns_status=3))
    assert email_validation.is_plausible_email("bajdbajdbaj@fajndkan.anc") is False


def test_a_non_nxdomain_status_still_passes(monkeypatch):
    """Only Status 3 (NXDOMAIN) means "this domain doesn't exist" — any
    other DNS status (e.g. 2 = SERVFAIL, a resolver-side hiccup) says
    nothing about the address itself."""
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(dns_status=2))
    assert email_validation.is_plausible_email("parent@example.com") is True


def test_a_request_failure_fails_open_not_closed(monkeypatch):
    """Any failure reaching the DNS-over-HTTPS endpoint itself (network
    trouble, a non-2xx response, anything) is infrastructure trouble, not
    a verdict on the address — must never block a genuine signup over
    this backend's own network having a bad moment."""
    def broken(*a, **k):
        raise httpx.ConnectError("connection failed")

    monkeypatch.setattr(httpx, "get", broken)
    assert email_validation.is_plausible_email("parent@example.com") is True


def test_a_non_2xx_response_fails_open(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(status_code=500))
    assert email_validation.is_plausible_email("parent@example.com") is True


def test_disabled_flag_skips_the_dns_call_entirely(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_DOMAIN_CHECK_ENABLED", False)

    def boom(*a, **k):
        raise AssertionError("DNS must not be checked while the flag is off")

    monkeypatch.setattr(httpx, "get", boom)
    assert email_validation.is_plausible_email("anyone@completely-made-up-xyz123.test") is True


# ---- the actual signup endpoint ----

def test_signup_rejects_an_unreal_domain(client: TestClient, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(dns_status=3))
    r = client.post("/api/auth/signup", json={
        "email": "bajdbajdbaj@fajndkan.anc", "password": "TestPass123", "name": "test",
    })
    assert r.status_code == 422
    assert "valid email" in r.json()["detail"].lower()

    # and no account was actually created for it
    login = client.post("/api/auth/login", json={"email": "bajdbajdbaj@fajndkan.anc", "password": "TestPass123"})
    assert login.status_code == 401


def test_signup_rejects_a_null_mx_domain(client: TestClient, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(
        dns_status=0, answers=[{"data": "0 ."}],
    ))
    r = client.post("/api/auth/signup", json={
        "email": "kadnkandkan@nakna.com", "password": "TestPass123", "name": "test",
    })
    assert r.status_code == 422
    assert "valid email" in r.json()["detail"].lower()


def test_signup_rejects_a_malformed_address(client: TestClient):
    r = client.post("/api/auth/signup", json={
        "email": "not-an-email", "password": "TestPass123", "name": "test",
    })
    assert r.status_code == 422


def test_signup_still_works_for_a_real_looking_domain(client: TestClient, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _FakeResponse(dns_status=0))
    r = client.post("/api/auth/signup", json={
        "email": "genuinely.real.parent@example.com", "password": "TestPass123", "name": "Real Parent",
    })
    assert r.status_code == 200
