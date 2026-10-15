"""
Unit and contract tests for Phase 6.3 hardening in Python SDK.
Tests GAP-01 (history), GAP-02 (actor purge), and GAP-04 (usage reporting).
All tests run offline using httpx.MockTransport.
"""

from datetime import datetime
import json
import httpx
import pytest

from kairo import (
    Kairo,
    KairoValidationError,
    KairoAuthorizationError,
    KairoNotFoundError,
    ProjectUsageReport,
    MemoryHistoryResponse,
    ActorPurgeResponse,
)


def test_usage_get_report_success():
    captured_request = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["method"] = request.method
        captured_request["path"] = request.url.path
        captured_request["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "projectId": 42,
                "fromUtc": "2026-09-15T12:00:00Z",
                "toUtc": "2026-10-15T12:00:00Z",
                "totalOperations": 150,
                "totalUnits": 200,
                "totalTokensUsed": 4500,
                "byOperation": [
                    {"label": "MemoryCreate", "operationCount": 50, "unitCount": 50},
                    {"label": "MemoryRecall", "operationCount": 100, "unitCount": 150},
                ],
                "byOutcome": [
                    {"label": "Success", "operationCount": 145, "unitCount": 195},
                    {"label": "Failure", "operationCount": 5, "unitCount": 5},
                ],
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    report = client.usage.get_report(
        42,
        from_utc="2026-09-15T12:00:00Z",
        to_utc="2026-10-15T12:00:00Z",
    )

    assert captured_request["method"] == "GET"
    assert captured_request["path"] == "/api/v1/projects/42/usage"
    assert captured_request["params"]["from"] == "2026-09-15T12:00:00Z"
    assert captured_request["params"]["to"] == "2026-10-15T12:00:00Z"

    assert isinstance(report, ProjectUsageReport)
    assert report.project_id == 42
    assert report.total_operations == 150
    assert report.total_units == 200
    assert report.total_tokens_used == 4500
    assert len(report.by_operation) == 2
    assert report.by_operation[0].label == "MemoryCreate"
    assert report.by_operation[0].operation_count == 50
    assert len(report.by_outcome) == 2
    assert report.by_outcome[0].label == "Success"


def test_usage_get_alias_and_datetime_support():
    captured_request = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["path"] = request.url.path
        captured_request["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "projectId": 1,
                "fromUtc": "2026-10-01T00:00:00Z",
                "toUtc": "2026-10-15T00:00:00Z",
                "totalOperations": 10,
                "totalUnits": 10,
                "totalTokensUsed": None,
                "byOperation": [],
                "byOutcome": [],
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    dt_from = datetime(2026, 10, 1, 0, 0, 0)
    dt_to = datetime(2026, 10, 15, 0, 0, 0)

    report = client.usage.get(1, from_utc=dt_from, to_utc=dt_to)
    assert report.project_id == 1
    assert "from" in captured_request["params"]
    assert "to" in captured_request["params"]


def test_usage_invalid_project_id():
    client = Kairo(api_key="kairo_live_test")
    with pytest.raises(KairoValidationError):
        client.usage.get(0)
    with pytest.raises(KairoValidationError):
        client.usage.get(-5)


def test_usage_forbidden():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"message": "Forbidden"})

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoAuthorizationError):
        client.usage.get(999)


def test_memories_history_success():
    captured_request = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["method"] = request.method
        captured_request["path"] = request.url.path
        return httpx.Response(
            200,
            json={
                "memoryId": 101,
                "count": 2,
                "versions": [
                    {
                        "memoryVersionId": 2,
                        "memoryId": 101,
                        "content": "User prefers dark mode and high contrast",
                        "operation": "ApiUpdate",
                        "createdAt": "2026-10-15T10:00:00Z",
                    },
                    {
                        "memoryVersionId": 1,
                        "memoryId": 101,
                        "content": "User prefers dark mode",
                        "operation": "ApiCreate",
                        "createdAt": "2026-10-15T09:00:00Z",
                    },
                ],
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    history = client.memories.history(101)

    assert captured_request["method"] == "GET"
    assert captured_request["path"] == "/api/v1/memories/101/history"
    assert isinstance(history, MemoryHistoryResponse)
    assert history.memory_id == 101
    assert history.count == 2
    assert len(history.versions) == 2
    assert history.versions[0].memory_version_id == 2
    assert history.versions[0].operation == "ApiUpdate"


def test_memories_history_not_found():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "Memory 999 was not found"})

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(KairoNotFoundError):
        client.memories.history(999)


def test_memories_history_invalid_id():
    client = Kairo(api_key="kairo_live_test")
    with pytest.raises(KairoValidationError):
        client.memories.history(0)


def test_memories_purge_actor_success():
    captured_request = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["method"] = request.method
        captured_request["path"] = request.url.path
        captured_request["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "actorId": "alice",
                "deletedCount": 3,
                "deletedMemoryIds": [101, 102, 103],
                "message": "Successfully purged 3 memories for actor 'alice'.",
            },
        )

    client = Kairo(api_key="kairo_live_test")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))

    result = client.memories.purge_actor("alice")

    assert captured_request["method"] == "DELETE"
    assert captured_request["path"] == "/api/v1/memories"
    assert captured_request["params"]["actorId"] == "alice"
    assert isinstance(result, ActorPurgeResponse)
    assert result.actor_id == "alice"
    assert result.deleted_count == 3
    assert result.deleted_memory_ids == [101, 102, 103]


def test_memories_purge_actor_validation():
    client = Kairo(api_key="kairo_live_test")
    with pytest.raises(KairoValidationError):
        client.memories.purge_actor("")
    with pytest.raises(KairoValidationError):
        client.memories.purge_actor("   ")
    with pytest.raises(KairoValidationError):
        client.memories.purge_actor("a" * 129)
