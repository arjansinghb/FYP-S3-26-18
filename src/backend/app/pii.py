"""Best-effort PII scrubbing for text sent to OpenAI (chat + embeddings).

This is NOT a substitute for a real Zero Data Retention agreement (see
config.py's ZDR_STATUS docstring) — it's a separate, narrower mitigation:
regardless of ZDR status, reduce the odds that a child accidentally typing
their email, phone number, or home address ever leaves this backend at all.
Pattern-based and imperfect by nature (a child's own name, school, or a
street name without a number won't be caught) — real ZDR is still the actual
fix for the underlying compliance question; this just lowers the blast
radius in the meantime.
"""
from __future__ import annotations

import re

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE = re.compile(r"(?:\+?\d[\d\-\s()]{6,}\d)")
# "123 Main Street" / "45 Orchard Road" style street-address fragments.
_STREET_ADDRESS = re.compile(
    r"\b\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+"
    r"(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|court|ct)\b",
    re.IGNORECASE,
)


def scrub(text: str) -> str:
    if not text:
        return text
    text = _EMAIL.sub("[email removed]", text)
    text = _STREET_ADDRESS.sub("[address removed]", text)
    text = _PHONE.sub("[number removed]", text)
    return text
