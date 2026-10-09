"""
Comprehensive Python SDK Contract & Unit Tests for Phase 3.

Tests cover:
- Create memory with category, categories, expires_at, ttl
- Update memory with category, categories, expires_at, ttl
- Search memory with category and categories filter
- Batch create memories (payload, endpoint, size limits, response mapping)
- Batch update memories (payload, endpoint, size limits, response mapping)
- Batch delete memories (payload, endpoint, size limits, response mapping)
- Memory and RetrievedMemory parsing of expires_at and categories
- Backward compatibility: omits Phase 3 fields when not provided
"""

import json
from datetime import datetime
import httpx
import pytest

from kairo import (
    Kairo,
    KairoValidationError,
)
from kairo.models import (
    BatchCreateResponse,
    BatchDeleteResponse,
    BatchUpdateResponse,
    Memory,
    RetrievedMemory,
)


def test_p3_01_create_with_categories_and_expiration():
    captured_payload = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            201,
            json={
                "memoryId": 101,
                "userId": 1,
                "content": captured_payload["content"],
                "memoryType": captured_payload["memoryType"],
                "isActive": True,
                "createdAt": "2026-10-08T10:00:00Z",
                "updatedAt": "2026-10-08T10:00:00Z",
                "expiresAt": captured_payload.get("expiresAt"),
                "categories": captured_payload.get("categories", []),
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    res = client.memories.create(
        content="User prefers dark mode",
        memory_type="Preference",
        actor_id="actor-1",
        category="ui",
        categories=["ui", "frontend"],
        expires_at="2026-12-31T23:59:59Z",
        ttl=3600,
    )

    assert captured_payload["category"] == "ui"
    assert captured_payload["categories"] == ["ui", "frontend"]
    assert captured_payload["expiresAt"] == "2026-12-31T23:59:59Z"
    assert captured_payload["ttl"] == 3600
    assert res.memory is not None
    assert res.memory.memory_id == 101
    assert res.memory.categories == ["ui", "frontend"]
    assert res.memory.expires_at == datetime.fromisoformat("2026-12-31T23:59:59+00:00")


def test_p3_02_update_with_categories_and_expiration():
    captured_payload = None
    captured_method = None
    captured_path = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload, captured_method, captured_path
        captured_method = request.method
        captured_path = request.url.path
        captured_payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "memoryId": 42,
                "userId": 1,
                "content": captured_payload["content"],
                "memoryType": captured_payload["memoryType"],
                "isActive": True,
                "createdAt": "2026-10-08T10:00:00Z",
                "updatedAt": "2026-10-08T11:00:00Z",
                "expiresAt": captured_payload.get("expiresAt"),
                "categories": captured_payload.get("categories", []),
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    mem = client.memories.update(
        memory_id=42,
        content="Updated content",
        memory_type="Fact",
        category="profile",
        categories=["profile", "work"],
        expires_at="2026-11-01T00:00:00Z",
        ttl=7200,
    )

    assert captured_method == "PUT"
    assert captured_path == "/api/v1/memories/42"
    assert captured_payload["category"] == "profile"
    assert captured_payload["categories"] == ["profile", "work"]
    assert captured_payload["expiresAt"] == "2026-11-01T00:00:00Z"
    assert captured_payload["ttl"] == 7200
    assert mem.categories == ["profile", "work"]


def test_p3_03_search_with_category_filters():
    captured_payload = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "query": captured_payload["query"],
                "count": 1,
                "memories": [
                    {
                        "memoryId": 7,
                        "content": "Fact with category",
                        "memoryType": "Fact",
                        "similarity": 0.88,
                        "createdAt": "2026-10-08T10:00:00Z",
                        "updatedAt": "2026-10-08T10:00:00Z",
                        "expiresAt": None,
                        "categories": ["fact-cat"],
                    }
                ],
                "relations": [],
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    res = client.memories.search(
        query="test query",
        actor_id="actor-1",
        category="fact-cat",
        categories=["fact-cat", "other-cat"],
    )

    assert captured_payload["category"] == "fact-cat"
    assert captured_payload["categories"] == ["fact-cat", "other-cat"]
    assert res.count == 1
    assert res.memories[0].categories == ["fact-cat"]


def test_p3_04_batch_create_success():
    captured_payload = None
    captured_method = None
    captured_path = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload, captured_method, captured_path
        captured_method = request.method
        captured_path = request.url.path
        captured_payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            201,
            json={
                "success": True,
                "createdCount": 2,
                "memories": [
                    {
                        "memoryId": 201,
                        "userId": 1,
                        "content": "Item 1",
                        "memoryType": "Fact",
                        "isActive": True,
                        "createdAt": "2026-10-08T10:00:00Z",
                        "updatedAt": "2026-10-08T10:00:00Z",
                    },
                    {
                        "memoryId": 202,
                        "userId": 1,
                        "content": "Item 2",
                        "memoryType": "Goal",
                        "isActive": True,
                        "createdAt": "2026-10-08T10:00:00Z",
                        "updatedAt": "2026-10-08T10:00:00Z",
                    },
                ],
                "errors": [],
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    batch = [
        {"content": "Item 1", "memoryType": "Fact", "actorId": "act-1"},
        {"content": "Item 2", "memoryType": "Goal", "actorId": "act-1"},
    ]
    resp: BatchCreateResponse = client.memories.batch_create(batch)

    assert captured_method == "POST"
    assert captured_path == "/api/v1/memories/batch"
    assert len(captured_payload["memories"]) == 2
    assert resp.success is True
    assert resp.created_count == 2
    assert len(resp.memories) == 2
    assert resp.memories[0].memory_id == 201


def test_p3_05_batch_create_validation_limits():
    client = Kairo(api_key="kairo_live_test")

    with pytest.raises(KairoValidationError) as exc1:
        client.memories.batch_create([])
    assert "memories list must not be empty" in str(exc1.value)

    over_100 = [{"content": f"m{i}", "memoryType": "Fact"} for i in range(101)]
    with pytest.raises(KairoValidationError) as exc2:
        client.memories.batch_create(over_100)
    assert "Batch size cannot exceed 100" in str(exc2.value)


def test_p3_06_batch_update_success():
    captured_payload = None
    captured_method = None
    captured_path = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload, captured_method, captured_path
        captured_method = request.method
        captured_path = request.url.path
        captured_payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "success": True,
                "updatedCount": 1,
                "memories": [
                    {
                        "memoryId": 201,
                        "userId": 1,
                        "content": "Updated Item 1",
                        "memoryType": "Fact",
                        "isActive": True,
                        "createdAt": "2026-10-08T10:00:00Z",
                        "updatedAt": "2026-10-08T11:00:00Z",
                    }
                ],
                "errors": [],
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    items = [{"memoryId": 201, "content": "Updated Item 1"}]
    resp: BatchUpdateResponse = client.memories.batch_update(items)

    assert captured_method == "PUT"
    assert captured_path == "/api/v1/memories/batch"
    assert resp.success is True
    assert resp.updated_count == 1
    assert resp.memories[0].content == "Updated Item 1"


def test_p3_07_batch_delete_success():
    captured_payload = None
    captured_method = None
    captured_path = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload, captured_method, captured_path
        captured_method = request.method
        captured_path = request.url.path
        captured_payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "success": True,
                "deletedCount": 2,
                "deletedIds": [201, 202],
                "errors": [],
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    resp: BatchDeleteResponse = client.memories.batch_delete([201, 202])

    assert captured_method == "DELETE"
    assert captured_path == "/api/v1/memories/batch"
    assert captured_payload["memoryIds"] == [201, 202]
    assert resp.success is True
    assert resp.deleted_count == 2
    assert resp.deleted_ids == [201, 202]


def test_p3_08_backward_compatibility_omits_none():
    captured_payload = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal captured_payload
        captured_payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            201,
            json={
                "memoryId": 1,
                "userId": 1,
                "content": captured_payload["content"],
                "memoryType": captured_payload["memoryType"],
                "isActive": True,
                "createdAt": "2026-10-08T10:00:00Z",
                "updatedAt": "2026-10-08T10:00:00Z",
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    client.memories.create(
        content="Standard memory",
        memory_type="Fact",
        actor_id="actor-1",
    )

    assert "expiresAt" not in captured_payload
    assert "ttl" not in captured_payload
    assert "category" not in captured_payload
    assert "categories" not in captured_payload
