"""Email address validation for UV05 signup — format AND a real DNS check
on the domain, not format alone.

Format-only validation (the usual approach) accepts anything *shaped* like
local@domain.tld, including a domain that's simply made up —
"bajdbajdbaj@fajndkan.anc" is syntactically fine (".anc" isn't even a real
TLD, but a format regex has no way to know that). Real, reproduced case:
exactly that address signed up, sailed straight through, and even ended up
"VERIFIED" — see auth.py's signup() docstring: when Resend can't actually
deliver (its free-tier sandbox only sends to the developer's own verified
address, see the Resend-limits note in project memory), the verification
token deliberately falls back to riding along in the signup API response
itself, so a real delivery failure never locks a genuine parent out. That
fallback is meant for "the email service legitimately couldn't reach a
real inbox," not "there was no real inbox to begin with" — a domain check
here closes that gap at the door, before an account (or a fallback token)
ever exists for an address that could never receive anything in the first
place.

Checked over DNS-over-HTTPS (a plain HTTPS GET, via `httpx` — already a
dependency this project uses for every other outbound check, Google Books/
YouTube/Resend included), NOT `socket.getaddrinfo()`. That's not a style
preference: raw socket DNS resolution was tried twice first (once with
`socket.setdefaulttimeout()`, once running the lookup in a background
thread) and both failed identically in Vercel's Python serverless sandbox,
real and reproduced (2026-09-23) — a genuinely nonexistent domain came back
as `OSError: [Errno 16] Device or resource busy`, indistinguishable at the
exception level from a transient environmental hiccup (a real domain, by
contrast, resolved fine every time). Since this code's whole fail-open
design hinges on telling "the domain doesn't exist" apart from "something
about this environment misbehaved," and the sandbox collapses that
distinction for raw sockets specifically, the check silently passed EVERY
email in production while looking completely correct in local testing (no
such sandbox restriction there). DNS-over-HTTPS sidesteps it entirely: it's
just another HTTPS call, exactly like the OpenAI/Google Books/Resend calls
already proven to work fine in this same environment, and it returns an
unambiguous JSON `Status` code (3 = NXDOMAIN) instead of an exception type
to sniff.

**2026-09-23 addendum — checks MX, not A.** The original version queried the
A record, which only proves "this domain exists" — not "this domain accepts
mail." Real, reproduced gap: "kadnkandkan@nakna.com" sailed straight through,
because nakna.com is a real, registered, DNS-resolving domain (parked, not
actually used for email) — the exact same shape of problem this file already
solved for fajndkan.anc, one level deeper. Now queries MX instead: a real
mail-accepting domain answers with one or more real mail-server hostnames;
a domain that explicitly wants to say "I will never accept mail" answers
with a single **Null MX** record (RFC 7505 — priority 0, exchange "."), which
is exactly the case nakna.com turned out to have. A Null MX is treated the
same as NXDOMAIN. A domain with no MX answer at all (NOERROR, empty Answer)
is NOT rejected — SMTP's ancient A-record mail-delivery fallback (RFC 5321
§5.1) means that's still technically deliverable, just unusually configured;
rejecting it would risk false-positiving a real domain, which this file's
whole fail-open philosophy exists to avoid.
"""
from __future__ import annotations

import logging
import re

import httpx

from .config import settings

logger = logging.getLogger("pip")

# local@domain.tld — a domain needs at least one dot and a 2+ char final
# label; deliberately not RFC 5322-exact (that grammar is famously more
# permissive than useful here) — good enough to catch "not shaped like an
# email at all" before the DNS check even looks at the domain part.
_FORMAT_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")

_DOH_URL = "https://dns.google/resolve"
_NXDOMAIN = 3  # RFC 2308 RCODE 3 — the domain genuinely does not exist


def _is_null_mx(answers: list) -> bool:
    """RFC 7505 Null MX — a domain's own explicit "I do not accept mail"
    declaration: exactly one MX record, priority 0, exchange ".". Any other
    shape (real hostnames, multiple records) is a normal mail-accepting
    answer, not this special case."""
    return len(answers) == 1 and answers[0].get("data", "").strip() == "0 ."


def is_plausible_email(email: str) -> bool:
    """False only when we're reasonably sure the address can't be real —
    either it isn't shaped like an email, its domain's DNS answer is a
    clean NXDOMAIN, or the domain has explicitly opted out of receiving
    mail via a Null MX record. True for a well-formed address whose domain
    has any other MX answer (including none at all — see module docstring's
    2026-09-23 addendum on the SMTP A-record fallback), AND for anything the
    DNS check itself couldn't get a real answer on (fails open on any
    request/parsing trouble — a check that can't run says nothing about the
    address, and must never block a genuine signup over this backend's own
    network having a bad moment)."""
    email = (email or "").strip()
    if not _FORMAT_RE.match(email):
        return False
    if not settings.EMAIL_DOMAIN_CHECK_ENABLED:
        return True
    domain = email.rsplit("@", 1)[-1]

    try:
        resp = httpx.get(_DOH_URL, params={"name": domain, "type": "MX"}, timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
        status = data.get("Status")
        if status == _NXDOMAIN:
            logger.info("email_validation: %r is NXDOMAIN", domain)
            return False
        if _is_null_mx(data.get("Answer") or []):
            logger.info("email_validation: %r has a Null MX record (RFC 7505) — explicitly rejects mail", domain)
            return False
        return True
    except Exception as e:
        logger.warning("email_validation: DNS-over-HTTPS check errored for %r (%s: %s)", domain, type(e).__name__, e)
        return True
