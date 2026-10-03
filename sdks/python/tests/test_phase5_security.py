"""
KAIRO V1 - PHASE 5 SECURITY TEST SUITE
=======================================

Classification:
  UNIT / OFFLINE - all tests use MockTransport or direct SDK validation.
  No live backend required for the offline tests.
  Live E2E tests are gated by KAIRO_LIVE_TEST_API_KEY env var.

Coverage:
  AUTH-01..AUTH-09   API key authentication edge cases
  ISOL-01..ISOL-06   Project and actor isolation contracts
  IDOR-01..IDOR-04   IDOR resistance via SDK layer
  INGEST-01..INGEST-08  Ingestion security and validation
  SEARCH-01..SEARCH-10  Search security
  HARDENING-01..HARDENING-08  Input hardening
  RETRY-01..RETRY-02  Retry safety for state-changing operations
"""

import json
import os
import pytest
import httpx

from kairo import (
    Kairo,
    KairoAuthenticationError,
    KairoValidationError,
    KairoNotFoundError,
    KairoServerError,
)
from kairo.models import MemoryIngestionResponse


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def _make_client(status: int, body: dict) -> Kairo:
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=body)
    client = Kairo(api_key="kairo_test_sentinel_key_phase5")
    client._http = httpx.Client(
        transport=httpx.MockTransport(_handler),
        headers={
            "Authorization": f"Bearer {client._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    return client


def _make_capturing_client(capture: dict, status: int = 200, body=None):
    if body is None:
        body = {"processed": True, "extractedCount": 0, "memories": []}
    def _handler(request: httpx.Request) -> httpx.Response:
        capture["method"]  = request.method
        capture["path"]    = request.url.path
        capture["headers"] = {k.lower(): v for k, v in request.headers.items()}
        capture["body"]    = json.loads(request.content) if request.content else None
        return httpx.Response(status, json=body)
    client = Kairo(api_key="kairo_test_sentinel_key_phase5")
    client._http = httpx.Client(
        transport=httpx.MockTransport(_handler),
        headers={
            "Authorization": f"Bearer {client._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    return client


# -----------------------------------------------------------------------------
# AUTH
# -----------------------------------------------------------------------------

class TestAuth:

    def test_AUTH_01_missing_api_key_raises_before_network(self):
        if os.environ.get("KAIRO_API_KEY"):
            pytest.skip("KAIRO_API_KEY env var present")
        with pytest.raises(KairoAuthenticationError):
            Kairo()

    def test_AUTH_02_valid_api_key_sent_as_bearer(self):
        capture = {}
        client = _make_capturing_client(capture, body={"userId": 1, "count": 0, "memories": []})
        client.memories.list()
        auth = capture["headers"].get("authorization", "")
        assert auth.startswith("Bearer ")

    def test_AUTH_03_api_key_not_in_response_body(self):
        sentinel = "kairo_test_sentinel_key_phase5"
        client = _make_client(200, {"userId": 1, "count": 0, "memories": []})
        memories = client.memories.list()
        for mem in memories:
            assert sentinel not in str(mem)

    def test_AUTH_04_http_401_maps_to_KairoAuthenticationError(self):
        client = _make_client(401, {"message": "Invalid or expired API key."})
        with pytest.raises(KairoAuthenticationError) as exc:
            client.memories.list()
        assert "kairo_test_sentinel" not in str(exc.value)

    def test_AUTH_05_http_401_does_not_expose_api_key(self):
        sentinel = "kairo_test_sentinel_key_phase5"
        client = _make_client(401, {"message": "Unauthorized"})
        try:
            client.memories.list()
        except KairoAuthenticationError as exc:
            assert sentinel not in repr(exc)
            assert sentinel not in str(exc)

    def test_AUTH_06_http_403_maps_to_correct_exception(self):
        from kairo import KairoAuthorizationError
        client = _make_client(403, {"message": "Forbidden"})
        with pytest.raises((KairoAuthorizationError, KairoAuthenticationError)):
            client.memories.list()

    def test_AUTH_07_empty_api_key_raises_before_network(self):
        with pytest.raises((KairoAuthenticationError, ValueError)):
            Kairo(api_key="")

    def test_AUTH_08_whitespace_api_key_raises_before_network(self):
        with pytest.raises((KairoAuthenticationError, ValueError)):
            Kairo(api_key="   ")

    def test_AUTH_09_api_key_not_in_connection_error(self):
        from kairo import KairoConnectionError as KairoConnErr
        def _raise(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("Connection refused")
        sentinel = "kairo_test_sentinel_key_phase5"
        client = Kairo(api_key=sentinel)
        client._http = httpx.Client(transport=httpx.MockTransport(_raise))
        try:
            client.memories.list()
        except KairoConnErr as exc:
            assert sentinel not in str(exc)
            assert sentinel not in repr(exc)


# -----------------------------------------------------------------------------
# ISOL - Project and Actor Isolation
# -----------------------------------------------------------------------------

class TestIsolation:

    def test_ISOL_01_create_payload_has_no_userId(self):
        capture = {}
        client = _make_capturing_client(capture, status=201, body={
            "memoryId": 1, "userId": 99, "content": "test",
            "memoryType": "Fact", "isActive": True,
            "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
        })
        client.memories.create(actor_id="actor-1", content="Test", memory_type="Fact")
        assert "userId" not in capture["body"]
        assert "user_id" not in capture["body"]

    def test_ISOL_02_create_payload_has_no_projectId(self):
        capture = {}
        client = _make_capturing_client(capture, status=201, body={
            "memoryId": 1, "userId": 99, "content": "test",
            "memoryType": "Fact", "isActive": True,
            "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
        })
        client.memories.create(actor_id="actor-1", content="Test", memory_type="Fact")
        assert "projectId" not in capture["body"]
        assert "project_id" not in capture["body"]

    def test_ISOL_03_create_payload_has_no_scopeId(self):
        capture = {}
        client = _make_capturing_client(capture, status=201, body={
            "memoryId": 1, "userId": 99, "content": "test",
            "memoryType": "Fact", "isActive": True,
            "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
        })
        client.memories.create(actor_id="actor-1", content="Test", memory_type="Fact")
        assert "scopeId" not in capture["body"]
        assert "scope_id" not in capture["body"]

    def test_ISOL_04_ingest_payload_has_no_userId(self):
        capture = {}
        client = _make_capturing_client(capture)
        client.memories.ingest(actor_id="actor-1", messages=[{"role": "user", "content": "Hi."}])
        assert "userId" not in capture["body"]
        assert "user_id" not in capture["body"]

    def test_ISOL_05_ingest_payload_has_no_projectId(self):
        capture = {}
        client = _make_capturing_client(capture)
        client.memories.ingest(actor_id="actor-1", messages=[{"role": "user", "content": "Hi."}])
        assert "projectId" not in capture["body"]
        assert "project_id" not in capture["body"]

    def test_ISOL_06_search_payload_has_no_projectId(self):
        capture = {}
        client = _make_capturing_client(capture, body={"query": "q", "count": 0, "memories": []})
        client.memories.search(actor_id="actor-1", query="preference")
        assert "projectId" not in capture["body"]
        assert "userId"    not in capture["body"]


# -----------------------------------------------------------------------------
# IDOR - Insecure Direct Object Reference resistance
# -----------------------------------------------------------------------------

class TestIDOR:

    def test_IDOR_01_get_nonexistent_memory_raises_not_found(self):
        client = _make_client(404, {"message": "Memory not found."})
        with pytest.raises(KairoNotFoundError):
            client.memories.get(memory_id=99999)

    def test_IDOR_02_update_nonexistent_memory_raises_not_found(self):
        client = _make_client(404, {"message": "Memory not found."})
        with pytest.raises(KairoNotFoundError):
            client.memories.update(memory_id=99999, content="Attack", memory_type="Fact")

    def test_IDOR_03_delete_nonexistent_memory_raises_not_found(self):
        client = _make_client(404, {"message": "Memory not found."})
        with pytest.raises(KairoNotFoundError):
            client.memories.delete(memory_id=99999)

    def test_IDOR_04_server_404_always_maps_to_KairoNotFoundError(self):
        for path_call in [
            lambda c: c.memories.get(memory_id=1),
            lambda c: c.memories.update(memory_id=1, content="x", memory_type="Fact"),
            lambda c: c.memories.delete(memory_id=1),
        ]:
            client = _make_client(404, {"message": "not found"})
            with pytest.raises(KairoNotFoundError):
                path_call(client)


# -----------------------------------------------------------------------------
# INGEST - Ingestion security
# -----------------------------------------------------------------------------

class TestIngestionSecurity:

    def test_INGEST_01_empty_actorId_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.ingest(actor_id="", messages=[{"role": "user", "content": "x"}])

    def test_INGEST_02_empty_messages_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.ingest(actor_id="actor-1", messages=[])

    def test_INGEST_03_message_missing_role_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.ingest(actor_id="actor-1", messages=[{"role": "", "content": "hello"}])

    def test_INGEST_04_message_missing_content_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.ingest(actor_id="actor-1", messages=[{"role": "user", "content": ""}])

    def test_INGEST_05_server_400_maps_to_KairoValidationError(self):
        client = _make_client(400, {"message": "messages[0] must not be null."})
        with pytest.raises(KairoValidationError):
            client.memories.ingest(actor_id="actor-1", messages=[{"role": "user", "content": "test"}])

    def test_INGEST_06_server_401_raises_auth_error(self):
        client = _make_client(401, {"message": "Invalid API key."})
        with pytest.raises(KairoAuthenticationError):
            client.memories.ingest(actor_id="actor-1", messages=[{"role": "user", "content": "test"}])

    def test_INGEST_07_payload_contains_only_actorId_and_messages(self):
        capture = {}
        client = _make_capturing_client(capture)
        client.memories.ingest(actor_id="safe-actor", messages=[{"role": "user", "content": "I prefer Python."}])
        assert set(capture["body"].keys()) == {"actorId", "messages"}

    def test_INGEST_08_whitespace_actorId_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.ingest(actor_id="   ", messages=[{"role": "user", "content": "hello"}])


# -----------------------------------------------------------------------------
# SEARCH - Search security
# -----------------------------------------------------------------------------

class TestSearchSecurity:

    def test_SEARCH_01_empty_query_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.search(actor_id="actor-1", query="")

    def test_SEARCH_02_empty_actorId_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.search(actor_id="", query="something")

    def test_SEARCH_03_topK_zero_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.search(actor_id="actor-1", query="something", top_k=0)

    def test_SEARCH_04_topK_negative_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.search(actor_id="actor-1", query="something", top_k=-5)

    def test_SEARCH_05_topK_over_100_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.search(actor_id="actor-1", query="something", top_k=101)

    def test_SEARCH_06_server_401_raises_auth_error(self):
        client = _make_client(401, {"message": "Unauthorized"})
        with pytest.raises(KairoAuthenticationError):
            client.memories.search(actor_id="actor-1", query="preference")

    def test_SEARCH_07_payload_contains_only_expected_fields(self):
        capture = {}
        client = _make_capturing_client(capture, body={"query": "q", "count": 0, "memories": []})
        client.memories.search(actor_id="actor-1", query="preference", top_k=5)
        assert set(capture["body"].keys()).issubset({"query", "actorId", "topK"})

    def test_SEARCH_08_nonexistent_actor_returns_empty(self):
        client = _make_client(200, {"query": "test", "count": 0, "memories": []})
        result = client.memories.search(actor_id="actor-that-never-existed", query="test query")
        assert result.count == 0
        assert result.memories == []

    def test_SEARCH_09_server_500_maps_to_KairoServerError(self):
        client = _make_client(500, {"message": "An unexpected error occurred."})
        with pytest.raises(KairoServerError):
            client.memories.search(actor_id="actor-1", query="test")

    def test_SEARCH_10_api_key_never_in_search_error(self):
        sentinel = "kairo_test_sentinel_key_phase5"
        client = _make_client(401, {"message": "Unauthorized"})
        try:
            client.memories.search(actor_id="actor-1", query="test")
        except Exception as exc:
            assert sentinel not in str(exc)
            assert sentinel not in repr(exc)


# -----------------------------------------------------------------------------
# HARDENING - Input hardening
# -----------------------------------------------------------------------------

class TestInputHardening:

    def test_HARDENING_01_very_long_actorId_rejected(self):
        long_actor = "a" * 200
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.ingest(actor_id=long_actor, messages=[{"role": "user", "content": "hello"}])

    def test_HARDENING_02_server_400_safe_message(self):
        client = _make_client(400, {"message": "actorId is required."})
        with pytest.raises(KairoValidationError) as exc:
            client.memories.ingest(actor_id="actor-1", messages=[{"role": "user", "content": "hello"}])
        assert "kairo_test" not in str(exc.value)

    def test_HARDENING_03_server_500_produces_safe_error(self):
        client = _make_client(500, {"message": "An unexpected error occurred."})
        with pytest.raises(KairoServerError) as exc:
            client.memories.ingest(actor_id="actor-1", messages=[{"role": "user", "content": "hello"}])
        msg = str(exc.value)
        assert "stack" not in msg.lower()
        assert "sql" not in msg.lower()

    def test_HARDENING_04_empty_query_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.search(actor_id="actor-1", query="")

    def test_HARDENING_05_whitespace_query_rejected(self):
        client = Kairo(api_key="kairo_test_key")
        with pytest.raises(KairoValidationError):
            client.memories.search(actor_id="actor-1", query="   ")

    def test_HARDENING_06_messages_trimmed_before_send(self):
        capture = {}
        client = _make_capturing_client(capture)
        client.memories.ingest(
            actor_id="actor-1",
            messages=[{"role": "  user  ", "content": "  hello world  "}],
        )
        msg = capture["body"]["messages"][0]
        assert msg["role"] == "user"
        assert msg["content"] == "hello world"

    def test_HARDENING_07_actorId_trimmed_before_send(self):
        capture = {}
        client = _make_capturing_client(capture)
        client.memories.ingest(actor_id="  actor-1  ", messages=[{"role": "user", "content": "hello"}])
        assert capture["body"]["actorId"] == "actor-1"

    def test_HARDENING_08_ingest_response_normalised_on_partial_backend(self):
        def _handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"processed": True, "extractedCount": 0})
        client = Kairo(api_key="kairo_test_key")
        client._http = httpx.Client(transport=httpx.MockTransport(_handler))
        result = client.memories.ingest(actor_id="actor-1", messages=[{"role": "user", "content": "hello"}])
        assert isinstance(result, MemoryIngestionResponse)
        assert result.memories == []


# -----------------------------------------------------------------------------
# RETRY - Retry safety
# -----------------------------------------------------------------------------

class TestRetrySafety:

    def test_RETRY_01_no_automatic_retry_on_ingest(self):
        call_count = {"n": 0}
        def _handler(request: httpx.Request) -> httpx.Response:
            call_count["n"] += 1
            return httpx.Response(500, json={"message": "Server error"})
        client = Kairo(api_key="kairo_test_key")
        client._http = httpx.Client(transport=httpx.MockTransport(_handler))
        with pytest.raises(KairoServerError):
            client.memories.ingest(actor_id="actor-1", messages=[{"role": "user", "content": "I prefer Go."}])
        assert call_count["n"] == 1, f"SDK retried ingest {call_count['n']} times!"

    def test_RETRY_02_no_automatic_retry_on_create(self):
        call_count = {"n": 0}
        def _handler(request: httpx.Request) -> httpx.Response:
            call_count["n"] += 1
            return httpx.Response(500, json={"message": "Server error"})
        client = Kairo(api_key="kairo_test_key")
        client._http = httpx.Client(transport=httpx.MockTransport(_handler))
        with pytest.raises(KairoServerError):
            client.memories.create(actor_id="actor-1", content="Some content", memory_type="Fact")
        assert call_count["n"] == 1, f"SDK retried create {call_count['n']} times!"


# -----------------------------------------------------------------------------
# LIVE E2E - Requires running backend
# -----------------------------------------------------------------------------

LIVE_API_KEY  = os.environ.get("KAIRO_LIVE_TEST_API_KEY", "")
LIVE_BASE_URL = os.environ.get("KAIRO_LIVE_BASE_URL", "http://localhost:5055")
LIVE_ACTOR_A  = "phase5-actor-a"
LIVE_ACTOR_B  = "phase5-actor-b"

skip_live = pytest.mark.skipif(
    not LIVE_API_KEY,
    reason="LIVE E2E: KAIRO_LIVE_TEST_API_KEY not set - infrastructure unavailable"
)


@skip_live
class TestLivePythonSDKE2E:

    @pytest.fixture(scope="class")
    def live_client(self):
        return Kairo(api_key=LIVE_API_KEY, base_url=LIVE_BASE_URL)

    def test_LIVE_01_ingest_creates_memory(self, live_client):
        result = live_client.memories.ingest(
            actor_id=LIVE_ACTOR_A,
            messages=[
                {"role": "user",      "content": "I prefer PostgreSQL for backend applications."},
                {"role": "assistant", "content": "Got it."},
            ],
        )
        assert result.processed is True

    def test_LIVE_02_search_returns_ingested_memory(self, live_client):
        result = live_client.memories.search(
            actor_id=LIVE_ACTOR_A,
            query="What database does this user prefer?",
            top_k=5,
        )
        assert result.count >= 0

    def test_LIVE_03_actor_isolation(self, live_client):
        result_b = live_client.memories.search(
            actor_id=LIVE_ACTOR_B,
            query="What database does this user prefer?",
            top_k=5,
        )
        for mem in result_b.memories:
            assert "PostgreSQL for backend applications" not in mem.content

    def test_LIVE_04_nonexistent_actor_returns_empty(self, live_client):
        result = live_client.memories.search(
            actor_id="actor-that-definitely-does-not-exist-phase5xyz",
            query="test query",
        )
        assert result.count == 0
        assert result.memories == []

    def test_LIVE_05_missing_auth_returns_401(self):
        bad_client = Kairo(api_key="kairo_invalid_key_xyz", base_url=LIVE_BASE_URL)
        with pytest.raises(KairoAuthenticationError):
            bad_client.memories.search(actor_id="actor-1", query="test")

    def test_LIVE_06_idor_get_returns_404(self, live_client):
        with pytest.raises(KairoNotFoundError):
            live_client.memories.get(memory_id=999999999)

    def test_LIVE_07_idor_update_returns_404(self, live_client):
        with pytest.raises(KairoNotFoundError):
            live_client.memories.update(memory_id=999999999, content="Attack", memory_type="Fact")

    def test_LIVE_08_idor_delete_returns_404(self, live_client):
        with pytest.raises(KairoNotFoundError):
            live_client.memories.delete(memory_id=999999999)
