"""Content Moderator — CM01-13. CM01/02 (login/logout) reuse the shared
/api/auth endpoints (see conftest.py's `moderator` fixture); nothing
moderator-specific to unit-test there beyond the role check itself, which
every endpoint below already exercises implicitly (403 for a wrong role is
covered once, in test_cm_wrong_role_forbidden)."""
from fastapi.testclient import TestClient


def test_cm_wrong_role_forbidden(client: TestClient, parent: dict):
    r = client.post("/api/content", headers=parent["headers"],
                     json={"type": "book", "title": "x", "description": "d", "age_bands": ["5-8"]})
    assert r.status_code == 403


def test_cm03_add_catalogue_entry_lands_approved(client: TestClient, moderator: dict):
    """A moderator typing an entry in directly is trusted at entry time —
    lands approved, not pending (see routers/content.py's module docstring:
    that's reserved for search-imports / other submissions, CM06 below)."""
    r = client.post("/api/content", headers=moderator["headers"],
                     json={"type": "book", "title": "Moderator Added Book", "description": "d",
                           "age_bands": ["5-8"], "genres": ["adventure"]})
    assert r.status_code == 201
    assert r.json()["status"] == "approved"


def test_cm03_06_search_and_import_lands_pending(client: TestClient, moderator: dict):
    """Real Google Books/YouTube search is skipped here (no API key under
    test — see conftest.py), but the import->pending->approve pipeline
    itself (the actual CM03/CM06/CM07 mechanism) is real and fully
    testable without the live search call: `POST /content/import` is what
    a moderator's UI calls after picking a real search result, and that
    part has no external dependency."""
    r = client.post("/api/content/import", headers=moderator["headers"],
                     json={"type": "book", "title": "Imported From Search", "description": "d",
                           "age_bands": ["9-12"], "genres": ["adventure"], "source": "google_books",
                           "external_ref": "https://books.example/imported"})
    assert r.status_code == 201
    assert r.json()["status"] == "pending"


def test_cm03_duplicate_entry_is_refused_with_a_link_to_the_existing_one(client: TestClient, moderator: dict):
    """CM03 alt flow: adding (or importing) what's already in the catalogue
    is a 409 that names the existing entry, so the console can warn and link
    to it. Same title ignoring case/punctuation, or same link, counts."""
    first = client.post("/api/content", headers=moderator["headers"],
                        json={"type": "book", "title": "The Little Prince", "description": "d",
                              "age_bands": ["5-8"], "external_ref": "https://books.example/little-prince"})
    assert first.status_code == 201
    for path, title, ref in [
        ("/api/content", "the little  prince!", None),
        ("/api/content/import", "A Different Title", "https://books.example/little-prince"),
    ]:
        r = client.post(path, headers=moderator["headers"],
                        json={"type": "book", "title": title, "description": "d",
                              "age_bands": ["5-8"], "external_ref": ref})
        assert r.status_code == 409
        detail = r.json()["detail"]
        assert "already in the catalogue" in detail["message"]
        assert detail["duplicate"]["id"] == first.json()["id"]
        assert detail["duplicate"]["status"] == "approved"
    # Same title as a different type is a different thing, not a duplicate.
    video = client.post("/api/content", headers=moderator["headers"],
                        json={"type": "video", "title": "The Little Prince", "description": "d", "age_bands": ["5-8"]})
    assert video.status_code == 201


def test_cm06_13_browse_pending_and_full_catalogue(client: TestClient, moderator: dict):
    client.post("/api/content/import", headers=moderator["headers"],
                json={"type": "video", "title": "Pending Video", "description": "d",
                      "age_bands": ["5-8"], "genres": [], "source": "youtube"})
    r = client.get("/api/content", headers=moderator["headers"], params={"status": "pending"})
    assert r.status_code == 200
    assert any(c["title"] == "Pending Video" for c in r.json())

    r = client.get("/api/content", headers=moderator["headers"])  # CM13 — browse everything
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_cm07_08_approve_and_reject(client: TestClient, moderator: dict):
    imported = client.post("/api/content/import", headers=moderator["headers"],
                            json={"type": "book", "title": "Approve Me", "description": "d",
                                  "age_bands": ["5-8"], "genres": []}).json()
    r = client.post(f"/api/content/{imported['id']}/approve", headers=moderator["headers"])
    assert r.status_code == 200
    assert r.json()["status"] == "approved"

    another = client.post("/api/content/import", headers=moderator["headers"],
                           json={"type": "book", "title": "Reject Me", "description": "d",
                                 "age_bands": ["5-8"], "genres": []}).json()
    r = client.post(f"/api/content/{another['id']}/reject", headers=moderator["headers"])
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"


def test_cm09_10_tag_age_band_and_genre(client: TestClient, moderator: dict):
    """No separate age-band/metadata endpoint (see routers/content.py) —
    both are fields on the general edit (PATCH), same as CM04. Confirms the
    edit actually changes catalogue-relevant tags, not just any field."""
    item = client.post("/api/content", headers=moderator["headers"],
                        json={"type": "book", "title": "Tag Me", "description": "d",
                              "age_bands": ["5-8"], "genres": []}).json()
    r = client.patch(f"/api/content/{item['id']}", headers=moderator["headers"],
                      json={**item, "age_bands": ["5-8", "9-12"], "genres": ["mystery"], "reading_level": "middle"})
    assert r.status_code == 200
    body = r.json()
    assert body["age_bands"] == ["5-8", "9-12"]
    assert body["genres"] == ["mystery"]
    assert body["reading_level"] == "middle"


def test_cm04_edit_and_cm05_remove(client: TestClient, moderator: dict):
    item = client.post("/api/content", headers=moderator["headers"],
                        json={"type": "book", "title": "Edit Me", "description": "d",
                              "age_bands": ["5-8"], "genres": []}).json()
    r = client.patch(f"/api/content/{item['id']}", headers=moderator["headers"], json={**item, "title": "Edited Title"})
    assert r.status_code == 200
    assert r.json()["title"] == "Edited Title"

    r = client.delete(f"/api/content/{item['id']}", headers=moderator["headers"])
    assert r.status_code == 204
    r = client.get("/api/content", headers=moderator["headers"])
    assert not any(c["id"] == item["id"] for c in r.json())


def test_cm11_12_review_and_resolve_reported_content(client: TestClient, moderator: dict, active_parent: dict, child: dict):
    item = client.post("/api/content", headers=moderator["headers"],
                        json={"type": "book", "title": "Flagged Book", "description": "d",
                              "age_bands": ["5-8"], "genres": []}).json()
    r = client.post(f"/api/children/{child['id']}/report", headers=active_parent["headers"],
                     json={"content_id": item["id"], "reason": "scary content"})
    report_id = r.json()["report_id"]

    r = client.get("/api/reports", headers=moderator["headers"])
    assert r.status_code == 200
    assert any(rep["id"] == report_id for rep in r.json())

    r = client.post(f"/api/reports/{report_id}/resolve", headers=moderator["headers"], json={"action": "remove"})
    assert r.status_code == 200
    assert r.json()["status"] == "resolved"

    r = client.get("/api/content", headers=moderator["headers"], params={"status": "rejected"})
    assert any(c["id"] == item["id"] for c in r.json())  # "remove" actually rejects the content, not just the report
