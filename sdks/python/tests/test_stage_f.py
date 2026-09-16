"""
Phase 12 Stage F: Comprehensive Python SDK Verification Suite.

Covers all gaps identified in the Stage F coverage audit.

The _client() helper swaps only the httpx transport (not the full http client),
so session-level headers (Authorization, Content-Type, Accept) are preserved.

CONFIG:
  F-P-01  Missing API key raises KairoAuthenticationError before network
  F-P-02  Default timeout is 30 seconds
  F-P-03  Context manager: __enter__ returns client, __exit__ closes
  F-P-04  KAIRO_BASE_URL environment variable fallback

AUTH:
  F-P-05  Content-Type header is application/json
  F-P-06  Accept header is application/json
  F-P-07  API key never appears in repr
  F-P-08  API key never appears in str
  F-P-09  API key never appears in connection error messages

MEMORY CREATE NEGATIVE:
  F-P-10  Server-side 400 for bad content maps to KairoValidationError
  F-P-11  userId field is never sent in create payload
  F-P-12  projectId field is never sent in create payload
  F-P-13  scopeId field is never sent in create payload
  F-P-14  Duplicate detection: is_duplicate=True path is correctly parsed

MEMORY SEARCH NEGATIVE:
  F-P-15  userId, projectId, scopeId are never sent in search payload

CRUD DESERIALIZATION:
  F-P-16  get() correctly maps all Memory fields
  F-P-17  list() returns empty list when memories=[] from backend
  F-P-18  update() returns correctly mapped Memory
  F-P-19  delete() returns correctly mapped DeleteMemoryResult
  F-P-20  search() maps RetrievedMemory similarity field

ERROR MAPPING:
  F-P-21  5xx (503) maps to KairoServerError with correct status_code
  F-P-22  502 maps to KairoServerError
  F-P-23  Graceful handling of empty 200 body
  F-P-24  Timeout raises KairoConnectionError

SECURITY:
  F-P-25  API key sentinel does not appear in any typed exception

PUBLIC API / EXPORTS:
  F-P-26  Kairo, KairoClient, KairoAgentMemory importable from root
  F-P-27  All exception classes importable from root
  F-P-28  All model classes importable from kairo.models

AGENT:
  F-P-29  A-B-A cross-call actor isolation regression
  F-P-30  remember() passes correct content + memoryType to create()
"""

import json
import os

import httpx
import pytest

from kairo import (
    Kairo,
    KairoAgentMemory,
    KairoAuthenticationError,
    KairoAuthorizationError,
    KairoClient,
    KairoConflictError,
    KairoConnectionError,
    KairoError,
    KairoNotFoundError,
    KairoRateLimitError,
    KairoServerError,
    KairoValidationError,
)
from kairo.models import (
    CreateMemoryResult,
    DeleteMemoryResult,
    Memory,
    MemorySearchResponse,
    RetrievedMemory,
)

FAKE_KEY = "kairo_live_F_STAGE_TEST_SENTINEL"

MEMORY_JSON = {
    "memoryId": 77,
    "userId": 3,
    "content": "User prefers dark mode",
    "memoryType": "Preference",
    "isActive": True,
    "createdAt": "2026-09-16T10:00:00Z",
    "updatedAt": "2026-09-16T10:00:01Z",
}


def _client(handler):
    """Create a Kairo client that uses the mock transport while preserving
    all session-level headers (Authorization, Content-Type, Accept) from the
    real httpx.Client that Kairo constructs internally."""
    c = Kairo(api_key=FAKE_KEY)
    # Swap ONLY the transport, preserving the session headers.
    c._http._transport = httpx.MockTransport(handler)
    return c


# ── F-P-01: Missing API key ───────────────────────────────────────────────────

def test_fp01_missing_api_key_raises_before_network(monkeypatch):
    monkeypatch.delenv("KAIRO_API_KEY", raising=False)
    with pytest.raises(KairoAuthenticationError) as exc:
        Kairo()
    assert "API key" in str(exc.value)


# ── F-P-02: Default timeout ────────────────────────────────────────────────────

def test_fp02_default_timeout():
    c = Kairo(api_key=FAKE_KEY)
    assert c._timeout == 30.0
    c.close()


# ── F-P-03: Context manager ────────────────────────────────────────────────────

def test_fp03_context_manager():
    with Kairo(api_key=FAKE_KEY) as client:
        assert isinstance(client, Kairo)
    # After __exit__, _http is closed -- further calls should raise
    with pytest.raises(Exception):
        client.memories.list()


# ── F-P-04: KAIRO_BASE_URL env var ────────────────────────────────────────────

def test_fp04_kairo_base_url_env(monkeypatch):
    monkeypatch.setenv("KAIRO_BASE_URL", "https://staging.kairo.example")
    c = Kairo(api_key=FAKE_KEY)
    assert c._base_url == "https://staging.kairo.example"
    c.close()
    monkeypatch.delenv("KAIRO_BASE_URL")


# ── F-P-05: Content-Type header ───────────────────────────────────────────────

def test_fp05_content_type_header():
    """Verify Content-Type is sent on POST requests (requires body)."""
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["ct"] = req.headers.get("content-type", "")
        return httpx.Response(201, json=MEMORY_JSON)

    c = _client(handler)
    # Use POST (create) -- GET requests don't send Content-Type
    c.memories.create(content="test", memory_type="Fact", actor_id="actor-1")
    assert "application/json" in captured["ct"]


# ── F-P-06: Accept header ─────────────────────────────────────────────────────

def test_fp06_accept_header():
    """Verify Accept header is sent on requests."""
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["accept"] = req.headers.get("accept", "")
        return httpx.Response(200, json={"memories": []})

    c = _client(handler)
    c.memories.list()
    assert "application/json" in captured["accept"]


# ── F-P-07: API key never in repr ─────────────────────────────────────────────

def test_fp07_api_key_not_in_repr():
    c = Kairo(api_key=FAKE_KEY)
    assert FAKE_KEY not in repr(c)
    c.close()


# ── F-P-08: API key never in str ──────────────────────────────────────────────

def test_fp08_api_key_not_in_str():
    c = Kairo(api_key=FAKE_KEY)
    assert FAKE_KEY not in str(c)
    c.close()


# ── F-P-09: API key never in connection error messages ────────────────────────

def test_fp09_api_key_not_in_connection_error():
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Connection refused")

    c = _client(handler)
    with pytest.raises(KairoConnectionError) as exc:
        c.memories.list()
    assert FAKE_KEY not in str(exc.value)
    assert FAKE_KEY not in repr(exc.value)


# ── F-P-10: Create: server-side 400 for bad content ──────────────────────────

def test_fp10_server_400_for_invalid_create():
    """The server returns 400 when content is invalid. SDK maps to KairoValidationError."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"message": "Content must not be empty."})

    c = _client(handler)
    with pytest.raises(KairoValidationError) as exc:
        c.memories.create(content="", memory_type="Fact", actor_id="actor-1")
    assert exc.value.status_code == 400


# ── F-P-11/12/13: Authority fields never sent on create ───────────────────────

def test_fp11_userId_not_in_create_payload():
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(req.content.decode())
        return httpx.Response(201, json=MEMORY_JSON)

    c = _client(handler)
    c.memories.create(content="test", memory_type="Fact", actor_id="actor-1")
    assert "userId" not in captured["body"]


def test_fp12_projectId_not_in_create_payload():
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(req.content.decode())
        return httpx.Response(201, json=MEMORY_JSON)

    c = _client(handler)
    c.memories.create(content="test", memory_type="Fact", actor_id="actor-1")
    assert "projectId" not in captured["body"]


def test_fp13_scopeId_not_in_create_payload():
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(req.content.decode())
        return httpx.Response(201, json=MEMORY_JSON)

    c = _client(handler)
    c.memories.create(content="test", memory_type="Fact", actor_id="actor-1")
    assert "scopeId" not in captured["body"]


# ── F-P-14: Duplicate detection path ─────────────────────────────────────────

def test_fp14_duplicate_detection_is_duplicate_true():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "isDuplicate": True,
            "reason": "Semantic duplicate detected.",
        })

    c = _client(handler)
    result = c.memories.create(content="duplicate content", memory_type="Fact", actor_id="actor-1")
    assert result.is_duplicate is True
    assert result.memory is None
    assert "Semantic duplicate" in result.duplicate_reason


# ── F-P-15: Authority fields never sent on search ─────────────────────────────

def test_fp15_authority_fields_not_in_search_payload():
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(req.content.decode())
        return httpx.Response(200, json={"query": "test", "count": 0, "memories": []})

    c = _client(handler)
    c.memories.search(query="test", actor_id="actor-1")
    body = captured["body"]
    assert "userId" not in body
    assert "projectId" not in body
    assert "scopeId" not in body


# ── F-P-16: get() correctly maps all Memory fields ────────────────────────────

def test_fp16_get_maps_all_memory_fields():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=MEMORY_JSON)

    c = _client(handler)
    m = c.memories.get(77)
    assert isinstance(m, Memory)
    assert m.memory_id == 77
    assert m.user_id == 3
    assert m.content == "User prefers dark mode"
    assert m.memory_type == "Preference"
    assert m.is_active is True
    assert m.created_at.year == 2026
    assert m.updated_at.year == 2026


# ── F-P-17: list() returns empty list ────────────────────────────────────────

def test_fp17_list_empty_memories():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"userId": 1, "count": 0, "memories": []})

    c = _client(handler)
    result = c.memories.list()
    assert isinstance(result, list)
    assert len(result) == 0


# ── F-P-18: update() correctly returns Memory ─────────────────────────────────

def test_fp18_update_maps_memory():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={**MEMORY_JSON, "content": "Updated content"})

    c = _client(handler)
    m = c.memories.update(memory_id=77, content="Updated content", memory_type="Fact")
    assert isinstance(m, Memory)
    assert m.content == "Updated content"


# ── F-P-19: delete() correctly returns DeleteMemoryResult ─────────────────────

def test_fp19_delete_maps_result():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"memoryId": 77, "message": "Memory deactivated."})

    c = _client(handler)
    r = c.memories.delete(77)
    assert isinstance(r, DeleteMemoryResult)
    assert r.memory_id == 77
    assert "deactivated" in r.message.lower()


# ── F-P-20: search() maps similarity ─────────────────────────────────────────

def test_fp20_search_maps_similarity():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "query": "dark mode",
            "count": 1,
            "memories": [{
                "memoryId": 77,
                "content": "User prefers dark mode",
                "memoryType": "Preference",
                "similarity": 0.9876,
            }]
        })

    c = _client(handler)
    r = c.memories.search(query="dark mode", actor_id="actor-1")
    assert isinstance(r, MemorySearchResponse)
    assert r.count == 1
    m = r.memories[0]
    assert isinstance(m, RetrievedMemory)
    assert m.similarity == pytest.approx(0.9876)
    assert m.memory_id == 77


# ── F-P-21/22: 5xx non-500 maps to KairoServerError ──────────────────────────

def test_fp21_503_maps_to_server_error():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"message": "Service unavailable."})

    c = _client(handler)
    with pytest.raises(KairoServerError) as exc:
        c.memories.get(1)
    assert exc.value.status_code == 503


def test_fp22_502_maps_to_server_error():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(502, json={"message": "Bad gateway."})

    c = _client(handler)
    with pytest.raises(KairoServerError) as exc:
        c.memories.get(1)
    assert exc.value.status_code == 502


# ── F-P-23: Graceful handling of empty 200 body ───────────────────────────────

def test_fp23_empty_200_body_does_not_raise():
    """An empty 200 body returns None gracefully (no exception)."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"")

    c = _client(handler)
    result = c._request("GET", "/api/v1/test")
    assert result is None


# ── F-P-24: Timeout raises KairoConnectionError ───────────────────────────────

def test_fp24_timeout_raises_connection_error():
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("Connection timed out")

    c = _client(handler)
    with pytest.raises(KairoConnectionError) as exc:
        c.memories.get(1)
    assert "timed out" in str(exc.value).lower()


# ── F-P-25: API key sentinel not in any exception ────────────────────────────

def test_fp25_api_key_sentinel_not_in_any_error():
    SENTINEL = "kairo_live_STAGE_F_SECRET_SENTINEL_XYZ"

    error_statuses = [
        (401, KairoAuthenticationError),
        (403, KairoAuthorizationError),
        (404, KairoNotFoundError),
        (409, KairoConflictError),
        (500, KairoServerError),
    ]

    for status, exc_class in error_statuses:
        def handler(req: httpx.Request, s=status) -> httpx.Response:
            return httpx.Response(s, json={"message": f"Error {s}"})

        c = Kairo(api_key=SENTINEL)
        c._http._transport = httpx.MockTransport(handler)

        with pytest.raises(exc_class) as exc:
            c.memories.get(1)
        assert SENTINEL not in str(exc.value), f"Key leaked in {exc_class.__name__} str"
        assert SENTINEL not in repr(exc.value), f"Key leaked in {exc_class.__name__} repr"


# ── F-P-26: Public exports from root ─────────────────────────────────────────

def test_fp26_root_public_exports():
    import kairo
    assert hasattr(kairo, "Kairo")
    assert hasattr(kairo, "KairoClient")
    assert hasattr(kairo, "KairoAgentMemory")
    assert kairo.KairoClient is kairo.Kairo


# ── F-P-27: All exception classes importable from root ───────────────────────

def test_fp27_all_exception_imports():
    from kairo import (  # noqa: F401
        KairoError,
        KairoAuthenticationError,
        KairoAuthorizationError,
        KairoNotFoundError,
        KairoValidationError,
        KairoConflictError,
        KairoRateLimitError,
        KairoServerError,
        KairoConnectionError,
    )
    assert issubclass(KairoAuthenticationError, KairoError)
    assert issubclass(KairoConflictError, KairoError)
    assert issubclass(KairoRateLimitError, KairoError)
    assert issubclass(KairoConnectionError, KairoError)


# ── F-P-28: Model classes importable from kairo.models ───────────────────────

def test_fp28_model_imports():
    from kairo.models import (  # noqa: F401
        Memory,
        CreateMemoryResult,
        RetrievedMemory,
        MemorySearchResponse,
        DeleteMemoryResult,
    )
    assert Memory is not None
    assert CreateMemoryResult is not None
    assert RetrievedMemory is not None
    assert MemorySearchResponse is not None
    assert DeleteMemoryResult is not None


# ── F-P-29: A-B-A cross-call actor isolation regression ──────────────────────

def test_fp29_aba_cross_call_actor_isolation():
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content.decode())
        calls.append(body.get("actorId"))
        if "/search" in req.url.path:
            return httpx.Response(200, json={"query": "q", "count": 0, "memories": []})
        return httpx.Response(201, json=MEMORY_JSON)

    c = _client(handler)
    agent = KairoAgentMemory(c, actor_id="actor-A")

    agent.remember(content="call 1", memory_type="Fact")
    agent.remember(content="call 2", memory_type="Fact", actor_id="actor-B")
    agent.recall(query="call 3")

    assert calls == ["actor-A", "actor-B", "actor-A"], (
        f"Expected A->B->A, got {calls}"
    )


# ── F-P-30: remember() sends correct content + memoryType ────────────────────

def test_fp30_remember_correct_content_and_type():
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(req.content.decode())
        return httpx.Response(201, json=MEMORY_JSON)

    c = _client(handler)
    agent = KairoAgentMemory(c, actor_id="actor-verify")
    agent.remember(content="Verified content payload", memory_type="Goal")

    assert captured["body"]["content"] == "Verified content payload"
    assert captured["body"]["memoryType"] == "Goal"
    assert captured["body"]["actorId"] == "actor-verify"
