"""
Comprehensive Python SDK Contract Test Suite — Phase 12 Stage C.

All tests are deterministic, offline, and use httpx.MockTransport.
Zero live backend or SQL Server requirements.
"""

import json
import os
from datetime import datetime
import httpx
import pytest

from kairo import (
    Kairo,
    KairoClient,
    KairoAgentMemory,
    KairoError,
    KairoAuthenticationError,
    KairoAuthorizationError,
    KairoConflictError,
    KairoConnectionError,
    KairoNotFoundError,
    KairoRateLimitError,
    KairoServerError,
    KairoValidationError,
)
from kairo.models import (
    Memory,
    CreateMemoryResult,
    RetrievedMemory,
    MemorySearchResponse,
    DeleteMemoryResult,
)


# ── 1-7: Configuration & Initialization ────────────────────────────────────────

def test_01_explicit_api_key():
    client = Kairo(api_key="kairo_live_explicit_123")
    assert client._api_key == "kairo_live_explicit_123"


def test_02_kairo_api_key_fallback(monkeypatch):
    monkeypatch.setenv("KAIRO_API_KEY", "kairo_live_env_456")
    client = Kairo()
    assert client._api_key == "kairo_live_env_456"


def test_03_explicit_api_key_precedence(monkeypatch):
    monkeypatch.setenv("KAIRO_API_KEY", "kairo_live_env_ignored")
    client = Kairo(api_key="kairo_live_explicit_takes_precedence")
    assert client._api_key == "kairo_live_explicit_takes_precedence"


def test_04_default_base_url():
    client = Kairo(api_key="kairo_live_test")
    assert client._base_url == "http://localhost:5171"


def test_05_custom_base_url():
    client = Kairo(api_key="kairo_live_test", base_url="https://api.kairo.ai")
    assert client._base_url == "https://api.kairo.ai"


def test_06_trailing_slash_normalization():
    client = Kairo(api_key="kairo_live_test", base_url="https://api.kairo.ai///")
    assert client._base_url == "https://api.kairo.ai"


def test_07_timeout_configuration():
    client = Kairo(api_key="kairo_live_test", timeout=45.5)
    assert client._timeout == 45.5


# ── 8: Authorization Header ───────────────────────────────────────────────────

def test_08_authorization_header():
    captured_auth = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_auth
        captured_auth = request.headers.get("authorization")
        return httpx.Response(200, json={"memories": []})

    client = Kairo(api_key="kairo_live_secret_key_888")
    client._http = httpx.Client(
        transport=httpx.MockTransport(handler),
        headers={
            "Authorization": f"Bearer {client._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    client.memories.list()
    assert captured_auth == "Bearer kairo_live_secret_key_888"


# ── 9-10: Memory Create & Payload Serialization ───────────────────────────────

def test_09_create_memory_actor_id():
    captured_body = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_body
        captured_body = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            201,
            json={
                "memoryId": 10,
                "userId": 1,
                "content": captured_body["content"],
                "memoryType": captured_body["memoryType"],
                "isActive": True,
                "createdAt": "2026-09-16T12:00:00Z",
                "updatedAt": "2026-09-16T12:00:00Z",
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    res = client.memories.create(
        content="Developer prefers PostgreSQL",
        memory_type="Preference",
        actor_id="actor-test-99",
    )
    assert res.is_duplicate is False
    assert res.memory is not None
    assert res.memory.memory_id == 10
    assert captured_body["actorId"] == "actor-test-99"


def test_10_create_payload_serialization():
    captured_request = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["method"] = request.method
        captured_request["path"] = request.url.path
        captured_request["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            201,
            json={
                "memoryId": 11,
                "userId": 1,
                "content": "User prefers strict typing",
                "memoryType": "Fact",
                "isActive": True,
                "createdAt": "2026-09-16T12:00:00Z",
                "updatedAt": "2026-09-16T12:00:00Z",
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    client.memories.create(
        content="User prefers strict typing",
        memory_type="Fact",
        actor_id="actor-dev-01",
    )

    assert captured_request["method"] == "POST"
    assert captured_request["path"] == "/api/v1/memories"
    assert captured_request["body"] == {
        "content": "User prefers strict typing",
        "memoryType": "Fact",
        "actorId": "actor-dev-01",
    }
    # Proves caller-controlled authority fields are NOT present
    assert "userId" not in captured_request["body"]
    assert "projectId" not in captured_request["body"]
    assert "scopeId" not in captured_request["body"]


# ── 11-12: Memory Search & Payload Serialization ──────────────────────────────

def test_11_search_actor_id():
    captured_body = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_body
        captured_body = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={"query": captured_body["query"], "count": 0, "memories": []},
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    res = client.memories.search(
        query="database choices",
        actor_id="actor-search-77",
    )
    assert res.count == 0
    assert captured_body["actorId"] == "actor-search-77"


def test_12_search_payload_serialization():
    captured_request = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["method"] = request.method
        captured_request["path"] = request.url.path
        captured_request["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "query": captured_request["body"]["query"],
                "count": 1,
                "memories": [
                    {
                        "memoryId": 25,
                        "content": "Prefers Postgres",
                        "memoryType": "Preference",
                        "similarity": 0.965,
                    }
                ],
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    results = client.memories.search(
        query="database preferences",
        actor_id="actor-test-12",
        top_k=7,
    )

    assert captured_request["method"] == "POST"
    assert captured_request["path"] == "/api/v1/memories/search"
    assert captured_request["body"] == {
        "query": "database preferences",
        "actorId": "actor-test-12",
        "topK": 7,
    }
    assert results.count == 1
    assert results.memories[0].memory_id == 25
    assert results.memories[0].similarity == 0.965


# ── 13-16: Memory Get, List, Update, Delete ───────────────────────────────────

def test_13_get_memory():
    captured_path = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_path
        captured_path = request.url.path
        return httpx.Response(
            200,
            json={
                "memoryId": 42,
                "userId": 1,
                "content": "A retrieved memory",
                "memoryType": "Fact",
                "isActive": True,
                "createdAt": "2026-09-16T12:00:00Z",
                "updatedAt": "2026-09-16T12:00:00Z",
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    # Keyword argument
    m1 = client.memories.get(memory_id=42)
    assert captured_path == "/api/v1/memories/42"
    assert m1.memory_id == 42
    assert m1.content == "A retrieved memory"

    # Positional argument compatibility
    m2 = client.memories.get(42)
    assert m2.memory_id == 42


def test_14_list_memories():
    captured_method = None
    captured_path = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_method, captured_path
        captured_method = request.method
        captured_path = request.url.path
        return httpx.Response(
            200,
            json={
                "userId": 1,
                "count": 2,
                "memories": [
                    {
                        "memoryId": 1,
                        "userId": 1,
                        "content": "Memory 1",
                        "memoryType": "Fact",
                        "isActive": True,
                        "createdAt": "2026-09-16T12:00:00Z",
                        "updatedAt": "2026-09-16T12:00:00Z",
                    },
                    {
                        "memoryId": 2,
                        "userId": 1,
                        "content": "Memory 2",
                        "memoryType": "Preference",
                        "isActive": True,
                        "createdAt": "2026-09-16T12:00:00Z",
                        "updatedAt": "2026-09-16T12:00:00Z",
                    },
                ],
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    memories = client.memories.list()
    assert captured_method == "GET"
    assert captured_path == "/api/v1/memories"
    assert len(memories) == 2
    assert memories[0].memory_id == 1
    assert memories[1].memory_id == 2


def test_15_update_memory():
    captured_request = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["method"] = request.method
        captured_request["path"] = request.url.path
        captured_request["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "memoryId": 16,
                "userId": 1,
                "content": captured_request["body"]["content"],
                "memoryType": captured_request["body"]["memoryType"],
                "isActive": True,
                "createdAt": "2026-09-16T12:00:00Z",
                "updatedAt": "2026-09-16T12:05:00Z",
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    updated = client.memories.update(
        memory_id=16,
        content="User strongly prefers dark mode",
        memory_type="Preference",
    )
    assert captured_request["method"] == "PUT"
    assert captured_request["path"] == "/api/v1/memories/16"
    assert captured_request["body"] == {
        "content": "User strongly prefers dark mode",
        "memoryType": "Preference",
    }
    assert updated.memory_id == 16
    assert updated.content == "User strongly prefers dark mode"


def test_16_delete_memory():
    captured_request = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["method"] = request.method
        captured_request["path"] = request.url.path
        return httpx.Response(
            200,
            json={
                "memoryId": 16,
                "message": "Memory deactivated. The record is preserved in the database.",
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    res = client.memories.delete(memory_id=16)
    assert captured_request["method"] == "DELETE"
    assert captured_request["path"] == "/api/v1/memories/16"
    assert res.memory_id == 16
    assert "deactivated" in res.message


# ── 17-24: Error Mapping & Status Codes ────────────────────────────────────────

def test_17_error_400_mapping():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"message": "ActorId is required."})

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoValidationError) as exc:
        client.memories.get(1)
    assert exc.value.status_code == 400
    assert "ActorId is required." in str(exc.value)


def test_18_error_401_mapping():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Invalid API key."})

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoAuthenticationError) as exc:
        client.memories.get(1)
    assert exc.value.status_code == 401
    assert "Invalid API key." in str(exc.value)


def test_19_error_403_mapping():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"message": "Forbidden action."})

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoAuthorizationError) as exc:
        client.memories.get(1)
    assert exc.value.status_code == 403


def test_20_error_404_mapping():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "Memory not found."})

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoNotFoundError) as exc:
        client.memories.get(999)
    assert exc.value.status_code == 404
    assert "Memory not found." in str(exc.value)


def test_21_error_409_mapping():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"message": "Conflict in resource state."})

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoConflictError) as exc:
        client.memories.get(1)
    assert exc.value.status_code == 409
    assert "Conflict in resource state." in str(exc.value)


def test_22_error_429_mapping():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"message": "Rate limit exceeded."})

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoRateLimitError) as exc:
        client.memories.get(1)
    assert exc.value.status_code == 429
    assert "Rate limit exceeded." in str(exc.value)


def test_23_retry_after_parsing():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            headers={"Retry-After": "120"},
            json={"message": "Rate limited"},
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoRateLimitError) as exc:
        client.memories.get(1)
    assert exc.value.status_code == 429
    assert exc.value.retry_after == 120
    assert "retry_after=120" in repr(exc.value)


def test_24_error_500_mapping():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"message": "Internal error."})

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoServerError) as exc:
        client.memories.get(1)
    assert exc.value.status_code == 500


# ── 25: Network / Connection Failure ──────────────────────────────────────────

def test_25_network_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Connection refused by host")

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoConnectionError) as exc:
        client.memories.get(1)
    assert "Network error contacting the Kairo API" in str(exc.value)


# ── 26: API Key Security in Exceptions ────────────────────────────────────────

def test_26_api_key_never_appears_in_exception():
    secret_key = "kairo_live_super_secret_never_leak_this"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Invalid credentials."})

    client = Kairo(api_key=secret_key)
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    # Repr check
    assert secret_key not in repr(client)
    assert secret_key not in str(client)

    # Exception check
    with pytest.raises(KairoAuthenticationError) as exc:
        client.memories.get(1)
    assert secret_key not in str(exc.value)
    assert secret_key not in repr(exc.value)


# ── 27: KairoClient Alias ─────────────────────────────────────────────────────

def test_27_kairo_client_alias():
    assert KairoClient is Kairo
    client = KairoClient(api_key="kairo_live_alias_test")
    assert isinstance(client, Kairo)


# ── 28-31: Agent Integration Contract ─────────────────────────────────────────

def test_28_agent_default_actor():
    captured_body = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured_body.update(body)
        return httpx.Response(
            201,
            json={
                "memoryId": 88,
                "userId": 1,
                "content": body["content"],
                "memoryType": body["memoryType"],
                "isActive": True,
                "createdAt": "2026-09-16T12:00:00Z",
                "updatedAt": "2026-09-16T12:00:00Z",
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    agent = KairoAgentMemory(client, actor_id="agent-actor-default")
    assert "agent-actor-default" in repr(agent)

    agent.remember(content="Important agent fact", memory_type="Fact")
    assert captured_body["actorId"] == "agent-actor-default"


def test_29_agent_actor_override():
    captured_body = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured_body.update(body)
        return httpx.Response(
            201,
            json={
                "memoryId": 89,
                "userId": 1,
                "content": body["content"],
                "memoryType": body["memoryType"],
                "isActive": True,
                "createdAt": "2026-09-16T12:00:00Z",
                "updatedAt": "2026-09-16T12:00:00Z",
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    agent = KairoAgentMemory(client, actor_id="agent-actor-default")
    agent.remember(
        content="Important override fact",
        memory_type="Fact",
        actor_id="actor-specific-override",
    )
    assert captured_body["actorId"] == "actor-specific-override"


def test_30_missing_actor_validation():
    client = Kairo(api_key="kairo_live_test")
    agent = KairoAgentMemory(client)  # No default actor

    with pytest.raises(KairoValidationError) as exc_remember:
        agent.remember(content="Missing actor", memory_type="Fact")
    assert "actor_id is required" in str(exc_remember.value)

    with pytest.raises(KairoValidationError) as exc_recall:
        agent.recall(query="Missing actor query")
    assert "actor_id is required" in str(exc_recall.value)


def test_31_agent_delegation():
    called_endpoints = []

    def handler(request: httpx.Request) -> httpx.Response:
        called_endpoints.append((request.method, request.url.path))
        if request.url.path == "/api/v1/memories/search":
            return httpx.Response(
                200,
                json={"query": "test", "count": 0, "memories": []},
            )
        if request.url.path == "/api/v1/memories/42" and request.method == "PUT":
            return httpx.Response(
                200,
                json={
                    "memoryId": 42,
                    "userId": 1,
                    "content": "Updated",
                    "memoryType": "Goal",
                    "isActive": True,
                    "createdAt": "2026-09-16T12:00:00Z",
                    "updatedAt": "2026-09-16T12:05:00Z",
                },
            )
        if request.url.path == "/api/v1/memories/42" and request.method == "DELETE":
            return httpx.Response(
                200,
                json={"memoryId": 42, "message": "Deactivated."},
            )
        return httpx.Response(404, json={"message": "Not found"})

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    agent = KairoAgentMemory(client, actor_id="agent-actor")

    # recall delegates to POST /api/v1/memories/search
    agent.recall(query="test query")
    assert called_endpoints[-1] == ("POST", "/api/v1/memories/search")

    # update delegates to PUT /api/v1/memories/{id}
    agent.update(memory_id=42, content="Updated", memory_type="Goal")
    assert called_endpoints[-1] == ("PUT", "/api/v1/memories/42")

    # forget delegates to DELETE /api/v1/memories/{id}
    agent.forget(memory_id=42)
    assert called_endpoints[-1] == ("DELETE", "/api/v1/memories/42")


# ── Phase 4: Conversational Ingestion ─────────────────────────────────────────

from kairo.models import IngestMessage, IngestionMemoryResult, MemoryIngestionResponse


def _make_ingest_transport(payload: dict) -> httpx.MockTransport:
    """Return a MockTransport that always returns *payload* as JSON."""

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    return httpx.MockTransport(_handler)


def test_F_P_30_ingest_sends_post_to_correct_endpoint():
    """ingest() must POST to /api/v1/memories/ingest."""
    captured = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        return httpx.Response(200, json={"processed": True, "extractedCount": 0, "memories": []})

    client = Kairo(api_key="kairo_test_key")
    client._http = httpx.Client(transport=httpx.MockTransport(_handler))
    client.memories.ingest(actor_id="actor-1", messages=[{"role": "user", "content": "Hello."}])

    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/memories/ingest"


def test_F_P_31_ingest_sends_correct_json_body():
    """ingest() must send actorId and messages in the request body."""
    captured = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"processed": True, "extractedCount": 0, "memories": []})

    client = Kairo(api_key="kairo_test_key")
    client._http = httpx.Client(transport=httpx.MockTransport(_handler))
    client.memories.ingest(
        actor_id="actor-99",
        messages=[
            {"role": "user", "content": "I use Python."},
            {"role": "assistant", "content": "Noted."},
        ],
    )

    body = captured["body"]
    assert body["actorId"] == "actor-99"
    assert len(body["messages"]) == 2
    assert body["messages"][0]["role"] == "user"
    assert body["messages"][0]["content"] == "I use Python."
    assert body["messages"][1]["role"] == "assistant"


def test_F_P_32_ingest_maps_response_fields():
    """ingest() must correctly map MemoryIngestionResponse fields."""
    payload = {
        "processed": True,
        "extractedCount": 2,
        "memories": [
            {"action": "Add", "memoryId": 101, "content": "User likes Python.", "reason": None},
            {"action": "NoAction", "memoryId": None, "content": "User likes cats.", "reason": "Duplicate"},
        ],
    }
    client = Kairo(api_key="kairo_test_key")
    client._http = httpx.Client(transport=_make_ingest_transport(payload))
    result = client.memories.ingest(
        actor_id="actor-2",
        messages=[{"role": "user", "content": "I love Python and cats."}],
    )

    assert isinstance(result, MemoryIngestionResponse)
    assert result.processed is True
    assert result.extracted_count == 2
    assert len(result.memories) == 2

    mem0 = result.memories[0]
    assert isinstance(mem0, IngestionMemoryResult)
    assert mem0.action == "Add"
    assert mem0.memory_id == 101
    assert mem0.content == "User likes Python."
    assert mem0.reason is None

    mem1 = result.memories[1]
    assert mem1.action == "NoAction"
    assert mem1.memory_id is None
    assert mem1.reason == "Duplicate"


def test_F_P_33_ingest_raises_for_empty_actor_id():
    """ingest() must raise KairoValidationError when actor_id is empty."""
    client = Kairo(api_key="kairo_test_key")
    with pytest.raises(KairoValidationError):
        client.memories.ingest(actor_id="", messages=[{"role": "user", "content": "Test."}])


def test_F_P_34_ingest_raises_for_empty_messages():
    """ingest() must raise KairoValidationError when messages list is empty."""
    client = Kairo(api_key="kairo_test_key")
    with pytest.raises(KairoValidationError):
        client.memories.ingest(actor_id="actor-x", messages=[])


def test_F_P_35_ingest_raises_for_message_missing_role():
    """ingest() must raise KairoValidationError when a message has an empty role."""
    client = Kairo(api_key="kairo_test_key")
    with pytest.raises(KairoValidationError):
        client.memories.ingest(
            actor_id="actor-x",
            messages=[{"role": "", "content": "Some content."}],
        )


def test_F_P_36_ingest_raises_for_message_missing_content():
    """ingest() must raise KairoValidationError when a message has empty content."""
    client = Kairo(api_key="kairo_test_key")
    with pytest.raises(KairoValidationError):
        client.memories.ingest(
            actor_id="actor-x",
            messages=[{"role": "user", "content": ""}],
        )


def test_F_P_37_ingest_models_exported_from_package():
    """IngestMessage, IngestionMemoryResult, and MemoryIngestionResponse must be importable from kairo."""
    from kairo import IngestMessage, IngestionMemoryResult, MemoryIngestionResponse  # noqa: F401
    msg = IngestMessage(role="user", content="Hello.")
    assert msg.role == "user"
    assert msg.content == "Hello."

