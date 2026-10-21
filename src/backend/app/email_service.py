"""Real email delivery for UV06 (email verification) and PA03 (password
reset), via Resend's REST API (https://resend.com — a real signed-up account
+ API key is required, see `settings.RESEND_API_KEY`; the previous dev-mode
default, where the token was returned straight in the API response instead
of being emailed, is preserved untouched for anyone running the backend
without a Resend key — see this module's two functions both returning
`False` immediately in that case, and each router call site's own
dev-mode-vs-real branch).

No new dependency: this reuses `httpx`, already a dependency for
app/content_sources.py's Google Books/YouTube calls, same synchronous-call,
`raise_for_status()`-then-let-the-caller-decide style.

Best-effort, not a hard dependency of the request it's called from: a
Resend outage or misconfigured key logs a warning and returns False rather
than raising — email delivery failing shouldn't turn into a 500 for a
signup or password-reset-request call that otherwise succeeded. Don't
silently swallow this without the log line, though (see
firestore_store.py's save_state() docstring for why a silent except here
already bit this project once, for an unrelated integration).
"""
from __future__ import annotations

import html as _html
import logging
from urllib.parse import quote

import httpx

from .config import settings

logger = logging.getLogger("pip")

_RESEND_URL = "https://api.resend.com/emails"


def _send(to_email: str, subject: str, html: str) -> bool:
    if not settings.resend_configured:
        return False
    try:
        resp = httpx.post(
            _RESEND_URL,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json={"from": settings.RESEND_FROM, "to": [to_email], "subject": subject, "html": html},
            timeout=10.0,
        )
        resp.raise_for_status()
        return True
    except Exception:
        logger.warning("email_service: send to %s failed", to_email, exc_info=True)
        return False


def _wrap(title: str, body_html: str) -> str:
    # One shared, minimal template — no external CSS/images (keeps it
    # rendering identically across email clients), just enough to not look
    # like a bare unstyled dev email.
    return f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                max-width:480px;margin:0 auto;padding:32px 24px;color:#241F36">
      <p style="font-size:22px;font-weight:700;color:#5B3A8F;margin:0 0 20px">Pip</p>
      <h1 style="font-size:18px;margin:0 0 14px">{title}</h1>
      {body_html}
      <p style="font-size:12px;color:#746a87;margin-top:32px">
        Pip — safe, age-appropriate books &amp; videos for kids. FYP-26-S3-18 prototype.
      </p>
    </div>
    """


def verification_link(token: str) -> str:
    """The page in the web app that confirms the token (works signed in or not)."""
    return f"{settings.FRONTEND_URL.rstrip('/')}/parent/verify?token={quote(token, safe='')}"


def send_verification_email(to_email: str, token: str) -> bool:
    """UV06. The email carries a link to the app's confirmation page
    (/parent/verify?token=...), which calls POST /api/auth/verify/confirm — that
    endpoint needs no login, so the link works from any browser."""
    link = verification_link(token)
    html = _wrap(
        "Verify your email",
        f"""
        <p style="font-size:14px;line-height:1.6">
          Confirm {to_email} to finish setting up your Pip account:
        </p>
        <p style="text-align:center;margin:22px 0">
          <a href="{link}" style="display:inline-block;background:#6A2EA0;color:#ffffff;text-decoration:none;
                     font-weight:700;padding:12px 26px;border-radius:999px">Verify my email</a>
        </p>
        <p style="font-size:12px;color:#746a87;word-break:break-all">
          Or paste this link into your browser: {link}
        </p>
        <p style="font-size:13px;color:#746a87">
          Didn't sign up for Pip? You can safely ignore this email.
        </p>
        """,
    )
    return _send(to_email, "Verify your Pip account", html)


def send_password_reset_email(to_email: str, token: str) -> bool:
    """PA03. Same "type the code back into the app" pattern as verification
    — see send_verification_email's docstring."""
    html = _wrap(
        "Reset your password",
        f"""
        <p style="font-size:14px;line-height:1.6">
          Enter this code in the app to set a new password for {to_email}:
        </p>
        <p style="font-size:28px;font-weight:700;letter-spacing:2px;background:#EFE7FA;
                   color:#452c70;padding:14px 18px;border-radius:10px;text-align:center;margin:18px 0">
          {token}
        </p>
        <p style="font-size:13px;color:#746a87">
          Didn't request this? You can safely ignore this email — your password won't change.
        </p>
        """,
    )
    return _send(to_email, "Reset your Pip password", html)


def send_notification_email(to_email: str, title: str, body: str) -> bool:
    """PA20/PA22 email channel: the same text a parent sees in the in-app bell,
    for parents who switched the Email channel on. Best-effort like the others."""
    html = _wrap(
        _html.escape(title),
        f'<p style="font-size:14px;line-height:1.6">{_html.escape(body)}</p>'
        '<p style="font-size:13px;color:#746a87">You are getting this because the Email channel is on in your Pip '
        "notification settings. You can turn it off there at any time.</p>",
    )
    return _send(to_email, title, html)
