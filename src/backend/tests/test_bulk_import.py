"""Bulk import with auto-triage (app/bulk_import.py, POST /api/content/bulk-import).

The property under test is that an item can only be auto-approved when EVERY
gate passes — deterministic source flags, moderation, and a HIGH-confidence,
on-topic AI verdict — and that anything uncertain, or any AI outage, leaves the
item for a human. Google Books/YouTube and OpenAI are all faked; nothing here
touches the network.
"""
import pytest
from fastapi.testclient import TestClient

from app import ai_assist, bulk_import, content_sources, embeddings, moderation

LONG = "A warm, well told picture book about a curious little octopus who explores the reef with friends."


def book(n, **over):
    return {"external_id": f"g{n}", "type": "book", "title": f"Octopus Book {n}", "description": LONG,
            "authors": ["A. Writer"], "thumbnail": f"https://img.example/{n}.jpg",
            "external_ref": f"https://books.example/{n}", "categories": ["Juvenile Fiction"],
            "maturity": "NOT_MATURE", **over}


def video(n, **over):
    return {"external_id": f"y{n}", "type": "video", "title": f"Octopus Video {n}", "description": LONG,
            "channel": "Kids TV", "thumbnail": f"https://img.example/v{n}.jpg", "external_ref": f"vid{n}",
            "made_for_kids": True, "embeddable": True, **over}


def good(**over):
    return {"decision": "approve", "confidence": "high", "on_topic": True, "reason": "A gentle reef story.",
            "age_bands": ["5-8"], "genres": ["ocean"], **over}


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    """Sensible defaults; each test overrides what it cares about."""
    state = {"found": [], "verdicts": None, "flagged": set()}
    monkeypatch.setattr(content_sources, "search_for_import", lambda topic, media_type, limit: state["found"])
    monkeypatch.setattr(ai_assist, "triage_candidates",
                        lambda cands, media_type, topic, vocab: state["verdicts"] if state["verdicts"] is not None else [None] * len(cands))
    monkeypatch.setattr(moderation, "flagged_many",
                        lambda texts: [any(f in t for f in state["flagged"]) for t in texts])
    monkeypatch.setattr(embeddings, "embed_texts", lambda texts: [[0.1, 0.2]] * len(texts))
    return state


@pytest.fixture()
def catalogue(client: TestClient):
    """A clean catalogue per test (the shared db singleton is module-scoped)."""
    from app.storage import db

    before = dict(db.content)
    before_integrations = dict(db.system["integrations"])
    yield db
    db.content.clear()
    db.content.update(before)
    db.system["integrations"] = before_integrations


def outcomes(result):
    return {i["title"]: i["outcome"] for i in result["items"]}


def test_confident_safe_on_topic_item_is_auto_approved_and_stamped(fakes, catalogue):
    fakes["found"] = [book(1)]
    fakes["verdicts"] = [good()]
    result = bulk_import.run("octopus", "book")
    assert result["approved"] == 1 and result["pending"] == 0
    item = catalogue.content[result["items"][0]["id"]]
    assert item["status"] == "approved" and item["reviewed_by"] == bulk_import.AI_REVIEWER
    assert item["auto_triaged"] is True and item["reviewed_at"]
    assert item["age_bands"] == ["5-8"] and "octopus" in item["genres"]  # the requested topic closes the gap
    assert item["embedding"] == [0.1, 0.2]
    assert item in catalogue.approved_content()


def test_a_flagged_topic_forces_every_result_to_review_even_at_high_confidence(fakes, catalogue, monkeypatch):
    """The real gap this closes (Kiefer, 2026-09-24): once a topic crosses
    the auto-import popularity threshold, nothing previously stopped it
    going straight to a live catalogue entry on AI confidence alone, even
    if the TOPIC ITSELF (not just the item found for it) was something
    OpenAI Moderation would flag. A high-confidence, on-topic, otherwise
    fully-gated item must still land in the review queue when the topic
    it was searched for is flagged."""
    monkeypatch.setattr(bulk_import.moderation, "is_unsafe", lambda text: text == "self harm")
    fakes["found"] = [book(1)]
    fakes["verdicts"] = [good()]

    result = bulk_import.run("self harm", "book", auto_approve=True)

    assert result["topic_flagged"] is True
    assert result["approved"] == 0 and result["pending"] == 1
    assert catalogue.content[result["items"][0]["id"]]["status"] == "pending"


def test_a_flagged_topic_still_lets_moderation_auto_reject(fakes, catalogue, monkeypatch):
    """The flagged-topic gate only ever removes the auto-APPROVE path — a
    genuinely unsuitable item found under a flagged topic must still be
    auto-rejected exactly as it would be for any other topic, not silently
    left ambiguous."""
    monkeypatch.setattr(bulk_import.moderation, "is_unsafe", lambda text: text == "self harm")
    fakes["found"] = [book(1)]
    fakes["flagged"] = {"Octopus Book 1"}
    fakes["verdicts"] = [good()]

    result = bulk_import.run("self harm", "book", auto_approve=True)

    assert result["topic_flagged"] is True
    assert result["rejected"] == 1
    assert catalogue.content[result["items"][0]["id"]]["status"] == "rejected"


def test_an_unflagged_topic_is_unaffected(fakes, catalogue, monkeypatch):
    monkeypatch.setattr(bulk_import.moderation, "is_unsafe", lambda text: False)
    fakes["found"] = [book(1)]
    fakes["verdicts"] = [good()]

    result = bulk_import.run("octopus", "book", auto_approve=True)

    assert result["topic_flagged"] is False
    assert result["approved"] == 1


def test_the_three_piles(fakes, catalogue):
    fakes["found"] = [book(1), book(2), book(3), book(4)]
    fakes["verdicts"] = [
        good(),                                                                        # approve
        {**good(), "decision": "reject", "unsuitable": True, "reason": "Adult horror."},  # reject (high)
        {**good(), "confidence": "medium"},                                            # unsure -> human
        {**good(), "decision": "reject", "confidence": "medium", "reason": "Maybe."},  # unsure reject -> human
    ]
    result = bulk_import.run("octopus", "book")
    assert outcomes(result) == {
        "Octopus Book 1": "approved", "Octopus Book 2": "rejected",
        "Octopus Book 3": "pending", "Octopus Book 4": "pending",
    }
    assert (result["approved"], result["rejected"], result["pending"]) == (1, 1, 2)
    rejected = catalogue.content[result["items"][1]["id"]]
    assert rejected["status"] == "rejected" and rejected["ai_reason"] == "Adult horror."


@pytest.mark.parametrize("override", [
    {"maturity": "MATURE"}, {"maturity": None}, {"description": "Too short."}, {"thumbnail": None},
])
def test_source_gates_keep_a_book_from_being_auto_approved(fakes, catalogue, override):
    fakes["found"] = [book(1, **override)]
    fakes["verdicts"] = [good()]
    result = bulk_import.run("octopus", "book")
    assert result["approved"] == 0 and result["pending"] == 1
    assert catalogue.content[result["items"][0]["id"]]["status"] == "pending"


@pytest.mark.parametrize("override, expect", [
    ({}, "approved"), ({"made_for_kids": None}, "pending"), ({"made_for_kids": False}, "pending"),
    ({"embeddable": False}, "pending"),
])
def test_video_needs_made_for_kids_and_embeddable(fakes, catalogue, override, expect):
    fakes["found"] = [video(1, **override)]
    fakes["verdicts"] = [good()]
    assert bulk_import.run("octopus", "video")["items"][0]["outcome"] == expect


@pytest.mark.parametrize("verdict", [
    {**good(), "confidence": "medium"}, {**good(), "confidence": "low"}, {**good(), "on_topic": False},
    {**good(), "age_bands": []}, {**good(), "decision": "review"},
])
def test_only_a_high_confidence_on_topic_verdict_with_an_age_band_approves(fakes, catalogue, verdict):
    fakes["found"] = [book(1)]
    fakes["verdicts"] = [verdict]
    assert bulk_import.run("octopus", "book")["items"][0]["outcome"] == "pending"


def test_a_harmless_off_topic_item_is_skipped_not_stored_as_rejected(fakes, catalogue):
    """Regression from the first live run: a fine children's book about volcanoes
    was being rejected forever just because the topic was octopuses."""
    fakes["found"] = [book(1, title="What Is A Volcano")]
    fakes["verdicts"] = [{**good(), "decision": "off_topic", "on_topic": False, "reason": "About volcanoes."}]
    before = len(catalogue.content)
    result = bulk_import.run("octopus", "book")
    assert result["skipped_off_topic"] == 1 and result["items"] == []
    assert len(catalogue.content) == before  # nothing stored: it stays importable for a volcano request later


def test_reject_without_the_unsuitable_flag_goes_to_a_human(fakes, catalogue):
    """Regression from the second live run: a mislabelled (but harmless) book was
    rejected forever. Rejecting needs the explicit `unsuitable` flag."""
    fakes["found"] = [book(1, title="Octopuses Are NEAT")]
    fakes["verdicts"] = [{**good(), "decision": "reject", "unsuitable": False, "reason": "Title is misleading."}]
    assert bulk_import.run("octopus", "book")["items"][0]["outcome"] == "pending"


def test_stored_descriptions_are_truncated(fakes, catalogue):
    fakes["found"] = [book(1, description="word " * 1000)]
    fakes["verdicts"] = [None]
    item = catalogue.content[bulk_import.run("octopus", "book")["items"][0]["id"]]
    assert len(item["description"]) == bulk_import._MAX_STORED_DESCRIPTION


def test_moderation_flag_rejects_even_when_the_ai_approves(fakes, catalogue):
    fakes["found"] = [book(1, title="Bad Octopus Gore")]
    fakes["verdicts"] = [good()]
    fakes["flagged"] = {"Gore"}
    item = bulk_import.run("octopus", "book")["items"][0]
    assert item["outcome"] == "rejected" and "moderation" in item["reason"]


def test_an_ai_outage_approves_nothing_and_leaves_it_all_for_a_human(fakes, catalogue):
    fakes["found"] = [book(1), book(2)]
    fakes["verdicts"] = None  # triage returns no verdicts at all
    result = bulk_import.run("octopus", "book")
    assert (result["approved"], result["rejected"], result["pending"]) == (0, 0, 2)
    assert all("AI unavailable" in i["reason"] for i in result["items"])


def test_moderation_still_rejects_during_an_ai_outage(fakes, catalogue):
    fakes["found"] = [book(1, title="Octopus Gore")]
    fakes["flagged"] = {"Gore"}
    assert bulk_import.run("octopus", "book")["items"][0]["outcome"] == "rejected"


def test_auto_approve_switched_off_sends_confident_matches_to_review(fakes, catalogue):
    fakes["found"] = [book(1)]
    fakes["verdicts"] = [good()]
    result = bulk_import.run("octopus", "book", auto_approve=False)
    assert result["approved"] == 0 and result["pending"] == 1 and result["auto_approve"] is False
    assert "auto-approve was off" in result["items"][0]["reason"]


def test_duplicates_are_skipped_by_link_and_by_title(fakes, catalogue):
    catalogue.add_content({"type": "book", "title": "Octopus Book 1", "description": "x", "age_bands": ["5-8"],
                           "genres": [], "external_ref": "https://elsewhere/1"}, status="approved")
    catalogue.add_content({"type": "book", "title": "Another", "description": "x", "age_bands": ["5-8"],
                           "genres": [], "external_ref": "https://books.example/2"}, status="rejected")
    fakes["found"] = [book(1), book(2), book(3), book(3)]  # by title, by link, new, in-batch repeat
    fakes["verdicts"] = [good()]
    result = bulk_import.run("octopus", "book")
    assert result["found"] == 4 and result["skipped_duplicates"] == 3
    assert [i["title"] for i in result["items"]] == ["Octopus Book 3"]


def test_a_rejected_item_is_kept_so_it_is_never_suggested_again(fakes, catalogue):
    fakes["found"] = [book(1)]
    fakes["verdicts"] = [{**good(), "decision": "reject", "unsuitable": True, "reason": "Not for kids."}]
    assert bulk_import.run("octopus", "book")["rejected"] == 1
    again = bulk_import.run("octopus", "book")
    assert again["skipped_duplicates"] == 1 and again["items"] == []


# ---- trusted sources: an easier bar, never a skipped one ----

def test_a_trusted_publishers_medium_confidence_book_is_approved(fakes, catalogue):
    catalogue.system["integrations"]["trusted_book_publishers"] = ["DK Children"]
    fakes["found"] = [book(1, publisher="DK Children")]
    fakes["verdicts"] = [{**good(), "confidence": "medium"}]
    result = bulk_import.run("octopus", "book")
    assert result["approved"] == 1
    item = result["items"][0]
    assert item["trusted_source"] is True and "trusted source" in item["reason"]


def test_publisher_match_is_case_insensitive_and_substring(fakes, catalogue):
    catalogue.system["integrations"]["trusted_book_publishers"] = ["dk children"]
    fakes["found"] = [book(1, publisher="DK Children (an imprint of Penguin)")]
    fakes["verdicts"] = [{**good(), "confidence": "medium"}]
    assert bulk_import.run("octopus", "book")["approved"] == 1


def test_an_untrusted_publisher_still_needs_high_confidence(fakes, catalogue):
    catalogue.system["integrations"]["trusted_book_publishers"] = ["DK Children"]
    fakes["found"] = [book(1, publisher="Some Random Press")]
    fakes["verdicts"] = [{**good(), "confidence": "medium"}]
    result = bulk_import.run("octopus", "book")
    assert result["approved"] == 0 and result["items"][0]["trusted_source"] is False


def test_a_book_with_no_publisher_is_never_trusted(fakes, catalogue):
    catalogue.system["integrations"]["trusted_book_publishers"] = ["DK Children"]
    fakes["found"] = [book(1, publisher="")]
    fakes["verdicts"] = [{**good(), "confidence": "medium"}]
    assert bulk_import.run("octopus", "book")["approved"] == 0


def test_an_empty_publisher_allowlist_trusts_nobody(fakes, catalogue):
    fakes["found"] = [book(1, publisher="DK Children")]  # trusted_book_publishers left empty
    fakes["verdicts"] = [{**good(), "confidence": "medium"}]
    assert bulk_import.run("octopus", "book")["approved"] == 0


def test_a_trusted_channel_video_at_medium_confidence_is_approved(fakes, catalogue):
    catalogue.system["integrations"]["youtube_channel_allowlist"] = ["UC-kids-1"]
    fakes["found"] = [video(1, channel_id="UC-kids-1")]
    fakes["verdicts"] = [{**good(), "confidence": "medium"}]
    result = bulk_import.run("octopus", "video")
    assert result["approved"] == 1 and result["items"][0]["trusted_source"] is True


def test_a_non_allowlisted_channel_video_still_needs_high_confidence(fakes, catalogue):
    catalogue.system["integrations"]["youtube_channel_allowlist"] = ["UC-kids-1"]
    fakes["found"] = [video(1, channel_id="UC-someone-else")]
    fakes["verdicts"] = [{**good(), "confidence": "medium"}]
    assert bulk_import.run("octopus", "video")["approved"] == 0


def test_trust_never_skips_the_other_gates(fakes, catalogue):
    """A trusted publisher's book still needs on-topic, an age band, a real
    description/cover, and to pass moderation — trust only softens confidence."""
    catalogue.system["integrations"]["trusted_book_publishers"] = ["DK Children"]

    fakes["found"] = [book(1, publisher="DK Children")]
    fakes["verdicts"] = [{**good(), "confidence": "medium", "on_topic": False}]
    assert bulk_import.run("octopus", "book")["approved"] == 0

    fakes["found"] = [book(2, publisher="DK Children", description="Too short.")]
    fakes["verdicts"] = [{**good(), "confidence": "medium"}]
    assert bulk_import.run("octopus", "book")["approved"] == 0

    fakes["found"] = [book(3, publisher="DK Children", title="DK Gore")]
    fakes["verdicts"] = [{**good(), "confidence": "medium"}]
    fakes["flagged"] = {"Gore"}
    assert bulk_import.run("octopus", "book")["items"][0]["outcome"] == "rejected"


def test_limit_is_capped(fakes, catalogue):
    fakes["found"] = [book(n) for n in range(40)]
    fakes["verdicts"] = [None] * 40
    assert len(bulk_import.run("octopus", "book", limit=999)["items"]) == bulk_import.MAX_LIMIT


# ---- the AI half, on its own ----

def test_triage_candidates_parses_and_sanitises_the_model_output(monkeypatch):
    monkeypatch.undo()  # this test wants the real function, not the autouse fake
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: {"verdicts": [
        {"index": 0, "decision": "approve", "confidence": "high", "on_topic": True, "reason": "ok",
         "unsuitable": True, "age_bands": ["5-8", "13-99"], "genres": ["Ocean", "x", "a" * 50, "reef life", "extra one"]},
        {"index": 1, "decision": "maybe", "confidence": "high"},
        {"index": 3, "decision": "off_topic", "confidence": "high", "on_topic": False},
        {"index": 9, "decision": "approve"},
        {"index": True, "decision": "approve"},
        {"index": 2, "decision": "reject", "confidence": "certain", "on_topic": "yes"},
    ]})
    out = ai_assist.triage_candidates([{"title": "a"}, {"title": "b"}, {"title": "c"}, {"title": "d"}], "book", "ocean", ["ocean"])
    assert out[3]["decision"] == "off_topic"
    assert out[0] == {"decision": "approve", "confidence": "high", "on_topic": True, "unsuitable": True, "reason": "ok",
                      "age_bands": ["5-8"], "genres": ["ocean", "reef life", "extra one"]}
    assert out[1] is None                                    # unknown decision
    assert out[2]["confidence"] == "low" and out[2]["on_topic"] is False  # bad values are demoted, never trusted


def test_triage_candidates_returns_no_verdicts_when_the_ai_is_down(monkeypatch):
    monkeypatch.undo()
    monkeypatch.setattr(ai_assist, "_chat_json", lambda system, user: None)
    assert ai_assist.triage_candidates([{"title": "a"}], "book", "ocean", []) == [None]


# ---- the endpoint ----

def test_endpoint_returns_the_report_and_is_moderator_only(client: TestClient, fakes, catalogue, moderator: dict, active_parent: dict):
    fakes["found"] = [book(1), book(2)]
    fakes["verdicts"] = [good(), {**good(), "confidence": "medium"}]
    r = client.post("/api/content/bulk-import", headers=moderator["headers"], json={"topic": "octopus", "type": "book"})
    assert r.status_code == 200
    body = r.json()
    assert (body["approved"], body["pending"], body["rejected"]) == (1, 1, 0) and len(body["items"]) == 2

    listing = client.get("/api/content", headers=moderator["headers"], params={"status": "approved"}).json()
    auto = [i for i in listing if i.get("auto_triaged")]
    assert auto and auto[0]["reviewed_by"] == "AI auto-triage"

    forbidden = client.post("/api/content/bulk-import", headers=active_parent["headers"], json={"topic": "x", "type": "book"})
    assert forbidden.status_code == 403
    assert client.post("/api/content/bulk-import", json={"topic": "x", "type": "book"}).status_code in (401, 403)


@pytest.mark.parametrize("topic", ["", "   ", "x" * 81])
def test_endpoint_rejects_a_bad_topic(client: TestClient, moderator: dict, topic):
    r = client.post("/api/content/bulk-import", headers=moderator["headers"], json={"topic": topic, "type": "book"})
    assert r.status_code == 422
