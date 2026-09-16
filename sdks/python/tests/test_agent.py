"""
Python Agent Integration Test Suite -- Phase 12 Stage E.

Covers all 12 required agent integration behaviors.
All tests are deterministic, offline, and use httpx.MockTransport.
Zero live backend or SQL Server requirements.

Tests:
 1.  Constructor default actor is used by remember
 2.  Constructor default actor is used by recall
 3.  Per-call remember actor override
 4.  Per-call recall actor override
 5.  Override does not mutate default actor
 6.  Missing actor fails before network call
 7.  Empty actor fails before network call
 8.  Remember delegates to client.memories.create
 9.  Recall delegates to client.memories.search
10.  SDK errors propagate unchanged (typed)
11.  actorId appears correctly in delegated call
12.  No authority fields are introduced
"""

import json

import httpx
import pytest

from kairo import (
    Kairo,
    KairoAgentMemory,
    KairoAuthenticationError,
    KairoConflictError,
    KairoRateLimitError,
    KairoValidationError,
)

# Shared fixtures

MEMORY_RESP = {
    "memoryId": 100,
    "userId": 1,
    "content": "test content",
    "memoryType": "Fact",
    "isActive": True,
    "createdAt": "2026-09-16T12:00:00Z",
    "updatedAt": "2026-09-16T12:00:00Z",
}

SEARCH_RESP = {"query": "test", "count": 0, "memories": []}


def _make_create_handler(captured: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured["last_body"] = body
        captured["last_method"] = request.method
        captured["last_path"] = request.url.path
        return httpx.Response(201, json={**MEMORY_RESP, "content": body.get("content", "x")})
    return handler


def _make_search_handler(captured: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured["last_body"] = body
        captured["last_method"] = request.method
        captured["last_path"] = request.url.path
        return httpx.Response(200, json=SEARCH_RESP)
    return handler


def _make_client(handler):
    client = Kairo(api_key="kairo_live_test_agent")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))
    return client


# Test 1

def test_01_default_actor_used_by_remember():
    captured = {}
    client = _make_client(_make_create_handler(captured))
    agent = KairoAgentMemory(client, actor_id="default-actor-A")
    agent.remember(content="Remembering with default actor", memory_type="Fact")
    assert captured["last_body"]["actorId"] == "default-actor-A"


# Test 2

def test_02_default_actor_used_by_recall():
    captured = {}
    client = _make_client(_make_search_handler(captured))
    agent = KairoAgentMemory(client, actor_id="default-actor-B")
    agent.recall(query="What does the user prefer?")
    assert captured["last_body"]["actorId"] == "default-actor-B"


# Test 3

def test_03_per_call_remember_actor_override():
    captured = {}
    client = _make_client(_make_create_handler(captured))
    agent = KairoAgentMemory(client, actor_id="default-actor-C")
    agent.remember(
        content="Overriding the actor",
        memory_type="Preference",
        actor_id="override-actor-X",
    )
    assert captured["last_body"]["actorId"] == "override-actor-X"


# Test 4

def test_04_per_call_recall_actor_override():
    captured = {}
    client = _make_client(_make_search_handler(captured))
    agent = KairoAgentMemory(client, actor_id="default-actor-D")
    agent.recall(query="override search", actor_id="override-actor-Y")
    assert captured["last_body"]["actorId"] == "override-actor-Y"


# Test 5

def test_05_override_does_not_mutate_default_actor():
    """
    Actor isolation cross-call:
      call 1 -> default-actor-E   (no override)
      call 2 -> override-actor-Z  (override)
      call 3 -> default-actor-E   (no override -- must NOT bleed from call 2)
    """
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        calls.append(body.get("actorId"))
        if "/search" in request.url.path:
            return httpx.Response(200, json=SEARCH_RESP)
        return httpx.Response(201, json={**MEMORY_RESP, "content": body.get("content", "x")})

    client = _make_client(handler)
    agent = KairoAgentMemory(client, actor_id="default-actor-E")

    agent.remember(content="Call 1 content", memory_type="Fact")
    agent.remember(content="Call 2 content", memory_type="Fact", actor_id="override-actor-Z")
    agent.recall(query="Call 3 query")

    assert calls[0] == "default-actor-E", "call 1 should use default actor"
    assert calls[1] == "override-actor-Z", "call 2 should use override actor"
    assert calls[2] == "default-actor-E", "call 3 must use default actor, not the call-2 override"


# Test 6

def test_06_missing_actor_fails_before_network():
    network_calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        network_calls.append(request)
        return httpx.Response(201, json=MEMORY_RESP)

    client = _make_client(handler)
    agent = KairoAgentMemory(client)

    with pytest.raises(KairoValidationError) as exc_info:
        agent.remember(content="no actor here", memory_type="Fact")
    assert "actor_id is required" in str(exc_info.value)
    assert len(network_calls) == 0

    with pytest.raises(KairoValidationError):
        agent.recall(query="no actor query")
    assert len(network_calls) == 0


# Test 7

def test_07_empty_actor_fails_before_network():
    network_calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        network_calls.append(request)
        return httpx.Response(201, json=MEMORY_RESP)

    client = _make_client(handler)

    agent_empty = KairoAgentMemory(client, actor_id="")
    with pytest.raises(KairoValidationError):
        agent_empty.remember(content="test", memory_type="Fact")
    assert len(network_calls) == 0

    agent_ws = KairoAgentMemory(client, actor_id="   ")
    with pytest.raises(KairoValidationError):
        agent_ws.remember(content="test", memory_type="Fact")
    assert len(network_calls) == 0

    agent_no_default = KairoAgentMemory(client)
    with pytest.raises(KairoValidationError):
        agent_no_default.remember(content="test", memory_type="Fact", actor_id="  ")
    assert len(network_calls) == 0


# Test 8

def test_08_remember_delegates_to_memories_create():
    captured = {}
    client = _make_client(_make_create_handler(captured))
    agent = KairoAgentMemory(client, actor_id="actor-spy-1")

    result = agent.remember(content="Spy on create", memory_type="Goal")

    assert captured["last_method"] == "POST"
    assert captured["last_path"] == "/api/v1/memories"
    assert hasattr(result, "is_duplicate")
    assert hasattr(result, "memory")


# Test 9

def test_09_recall_delegates_to_memories_search():
    captured = {}
    client = _make_client(_make_search_handler(captured))
    agent = KairoAgentMemory(client, actor_id="actor-spy-2")

    result = agent.recall(query="spy on search", top_k=3)

    assert captured["last_method"] == "POST"
    assert captured["last_path"] == "/api/v1/memories/search"
    assert captured["last_body"]["query"] == "spy on search"
    assert captured["last_body"]["topK"] == 3
    assert hasattr(result, "memories")


# Test 10

def test_10_sdk_errors_propagate_unchanged():
    def auth_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Unauthorized"})

    with pytest.raises(KairoAuthenticationError):
        agent = KairoAgentMemory(_make_client(auth_handler), actor_id="actor-err-1")
        agent.remember(content="Will fail 401", memory_type="Fact")

    def conflict_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"message": "Conflict"})

    with pytest.raises(KairoConflictError):
        agent = KairoAgentMemory(_make_client(conflict_handler), actor_id="actor-err-2")
        agent.remember(content="Will fail 409", memory_type="Fact")

    def rate_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            headers={"Retry-After": "60"},
            json={"message": "Rate limit exceeded"},
        )

    with pytest.raises(KairoRateLimitError) as exc_info:
        agent = KairoAgentMemory(_make_client(rate_handler), actor_id="actor-err-3")
        agent.remember(content="Will fail 429", memory_type="Fact")
    assert exc_info.value.retry_after == 60


# Test 11

def test_11_actor_id_correct_in_delegated_call():
    captured = {}
    client = _make_client(_make_create_handler(captured))
    agent = KairoAgentMemory(client, actor_id="exact-actor-99")

    agent.remember(content="Precision check", memory_type="Skill")

    assert captured["last_body"]["actorId"] == "exact-actor-99"
    assert captured["last_body"]["content"] == "Precision check"
    assert captured["last_body"]["memoryType"] == "Skill"


# Test 12

def test_12_no_authority_fields_introduced():
    captured = {}

    def multi_handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured["body"] = body
        if "/search" in request.url.path:
            return httpx.Response(200, json=SEARCH_RESP)
        return httpx.Response(201, json={**MEMORY_RESP, "content": body.get("content", "x")})

    client = _make_client(multi_handler)
    agent = KairoAgentMemory(client, actor_id="authority-check-actor")

    agent.remember(content="Authority check remember", memory_type="Fact")
    body = captured["body"]
    assert "userId" not in body
    assert "projectId" not in body
    assert "scopeId" not in body

    agent.recall(query="Authority check recall")
    body = captured["body"]
    assert "userId" not in body
    assert "projectId" not in body
    assert "scopeId" not in body
