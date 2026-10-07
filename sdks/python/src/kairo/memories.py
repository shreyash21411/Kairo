"""
Kairo Memory resource.

Provides all memory operations against the Kairo REST API.
Access via ``client.memories``.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, List, Optional, Union

from .exceptions import KairoValidationError
from .models import (
    CreateMemoryResult,
    DeleteMemoryResult,
    GraphRelation,
    IngestMessage,
    IngestionMemoryResult,
    Memory,
    MemoryIngestionResponse,
    MemoryScope,
    MemorySearchResponse,
    MemoryTemporalFilter,
    MetadataFilterCondition,
)

if TYPE_CHECKING:
    from .client import Kairo


def _parse_scope_param(
    actor_id: Optional[str],
    scope: Optional[Union[MemoryScope, dict[str, Any]]],
) -> tuple[Optional[str], Optional[dict[str, Any]]]:
    if actor_id is not None:
        if not isinstance(actor_id, str) or not actor_id.strip():
            raise KairoValidationError("actor_id must not be empty.", status_code=400)
        if len(actor_id.strip()) > 128:
            raise KairoValidationError("actor_id must not exceed 128 characters.", status_code=400)
    elif scope is None:
        raise KairoValidationError("actor_id or scope must be provided.", status_code=400)

    scope_dict: Optional[dict[str, Any]] = None
    if scope is not None:
        if isinstance(scope, MemoryScope):
            scope_dict = scope.to_dict()
        elif isinstance(scope, dict):
            key_map = {
                "actor_id": "actorId",
                "user_id": "userId",
                "agent_id": "agentId",
                "session_id": "sessionId",
                "run_id": "runId",
            }
            scope_dict = {key_map.get(k, k): v for k, v in scope.items() if v is not None}
        else:
            raise KairoValidationError("scope must be a MemoryScope or dict.", status_code=400)

    return (actor_id.strip() if actor_id else None), scope_dict


class MemoryResource:
    """Provides access to all Kairo memory operations.

    Accessed as ``client.memories`` on a :class:`~kairo.Kairo` instance.
    Do not instantiate this class directly.
    """

    def __init__(self, client: Kairo) -> None:
        self._client = client

    # ── Create ────────────────────────────────────────────────────────────────

    def create(
        self,
        *,
        content: str,
        memory_type: str,
        actor_id: Optional[str] = None,
        scope: Optional[Union[MemoryScope, dict[str, Any]]] = None,
        occurred_at: Optional[Union[datetime, str]] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> CreateMemoryResult:
        """Create a new memory for the authenticated user and specified actor or scope."""
        resolved_actor_id, scope_dict = _parse_scope_param(actor_id, scope)

        payload: dict[str, Any] = {
            "content": content,
            "memoryType": memory_type,
        }
        if resolved_actor_id is not None:
            payload["actorId"] = resolved_actor_id
        if scope_dict is not None:
            payload["scope"] = scope_dict
        if occurred_at is not None:
            payload["occurredAt"] = occurred_at.isoformat() if isinstance(occurred_at, datetime) else occurred_at
        if metadata is not None:
            payload["metadata"] = metadata

        data = self._client._request(
            "POST",
            "/api/v1/memories",
            json=payload,
        )

        if data and data.get("isDuplicate") is True:
            return CreateMemoryResult(
                memory=None,
                is_duplicate=True,
                duplicate_reason=data.get("reason"),
            )

        return CreateMemoryResult(
            memory=Memory._from_dict(data),
            is_duplicate=False,
            duplicate_reason=None,
        )

    # ── Get ───────────────────────────────────────────────────────────────────

    def get(self, memory_id: int) -> Memory:
        """Retrieve a single memory by ID."""
        data = self._client._request(
            "GET",
            f"/api/v1/memories/{memory_id}",
        )
        return Memory._from_dict(data)

    # ── List ──────────────────────────────────────────────────────────────────

    def list(self) -> list[Memory]:
        """List all active memories for the authenticated user."""
        data = self._client._request(
            "GET",
            "/api/v1/memories",
        )
        raw_list: list[Any] = data.get("memories", []) if data else []
        return [Memory._from_dict(m) for m in raw_list]

    # ── Update ────────────────────────────────────────────────────────────────

    def update(
        self,
        *,
        memory_id: int,
        content: str,
        memory_type: str,
        occurred_at: Optional[Union[datetime, str]] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> Memory:
        """Update the content and type of an existing memory."""
        payload: dict[str, Any] = {
            "content": content,
            "memoryType": memory_type,
        }
        if occurred_at is not None:
            payload["occurredAt"] = occurred_at.isoformat() if isinstance(occurred_at, datetime) else occurred_at
        if metadata is not None:
            payload["metadata"] = metadata

        data = self._client._request(
            "PUT",
            f"/api/v1/memories/{memory_id}",
            json=payload,
        )
        return Memory._from_dict(data)

    # ── Delete ────────────────────────────────────────────────────────────────

    def delete(self, memory_id: int) -> DeleteMemoryResult:
        """Deactivate (soft-delete) a memory."""
        data = self._client._request(
            "DELETE",
            f"/api/v1/memories/{memory_id}",
        )
        return DeleteMemoryResult._from_dict(data)

    # ── Search ────────────────────────────────────────────────────────────────

    def search(
        self,
        *,
        query: str,
        actor_id: Optional[str] = None,
        scope: Optional[Union[MemoryScope, dict[str, Any]]] = None,
        top_k: int = 5,
        hybrid: Optional[bool] = None,
        temporal: Optional[Union[MemoryTemporalFilter, dict[str, Any]]] = None,
        metadata_filters: Optional[dict[str, str]] = None,
        structured_filters: Optional[List[Union[MetadataFilterCondition, dict[str, Any]]]] = None,
        recency_boost: Optional[bool] = None,
        graph_depth: Optional[int] = None,
    ) -> MemorySearchResponse:
        """Search memories semantically or via hybrid retrieval with temporal, metadata, and graph support."""
        if not query or not isinstance(query, str) or not query.strip():
            raise KairoValidationError("query must not be empty.", status_code=400)
        resolved_actor_id, scope_dict = _parse_scope_param(actor_id, scope)
        if not isinstance(top_k, int) or isinstance(top_k, bool) or top_k < 1 or top_k > 100:
            raise KairoValidationError("top_k must be an integer between 1 and 100.", status_code=400)

        payload: dict[str, Any] = {
            "query": query.strip(),
            "topK": top_k,
        }
        if resolved_actor_id is not None:
            payload["actorId"] = resolved_actor_id
        if scope_dict is not None:
            payload["scope"] = scope_dict
        if hybrid is not None:
            payload["hybrid"] = hybrid

        if temporal is not None:
            payload["temporal"] = temporal.to_dict() if isinstance(temporal, MemoryTemporalFilter) else temporal
        if metadata_filters is not None:
            payload["metadataFilters"] = metadata_filters
        if structured_filters is not None:
            payload["structuredFilters"] = [
                f.to_dict() if isinstance(f, MetadataFilterCondition) else f
                for f in structured_filters
            ]
        if recency_boost is not None:
            payload["recencyBoost"] = recency_boost
        if graph_depth is not None:
            payload["graphDepth"] = graph_depth

        data = self._client._request(
            "POST",
            "/api/v1/memories/search",
            json=payload,
        )
        return MemorySearchResponse._from_dict(data)


    # ── Ingest ────────────────────────────────────────────────────────────────

    def ingest(
        self,
        *,
        actor_id: Optional[str] = None,
        scope: Optional[Union[MemoryScope, dict[str, Any]]] = None,
        messages: List[Union[dict[str, str], IngestMessage]],
    ) -> MemoryIngestionResponse:
        """Ingest a conversation and extract durable memories in ADD-only mode.

        Calls ``POST /api/v1/memories/ingest``.

        :param actor_id: Application-level actor identifier for memory scoping.
        :param scope: Multi-dimensional memory scope (MemoryScope or dict).
        :param messages: List of conversation messages (as dicts with 'role' and 'content',
            or :class:`~kairo.models.IngestMessage` instances).
        :returns: A :class:`~kairo.models.MemoryIngestionResponse`.
        :raises KairoValidationError: If scope or ``messages`` is empty or malformed.
        :raises KairoAuthenticationError: If the API key is invalid.
        """
        resolved_actor_id, scope_dict = _parse_scope_param(actor_id, scope)

        if not messages or not isinstance(messages, (list, tuple)):
            raise KairoValidationError("messages must be a non-empty list.", status_code=400)

        serialized_messages: list[dict[str, str]] = []
        for i, msg in enumerate(messages):
            if isinstance(msg, dict):
                role = msg.get("role")
                content = msg.get("content")
            elif hasattr(msg, "role") and hasattr(msg, "content"):
                role = getattr(msg, "role")
                content = getattr(msg, "content")
            else:
                raise KairoValidationError(
                    f"Message at index {i} must be a dict or IngestMessage.",
                    status_code=400,
                )

            if not role or not isinstance(role, str) or not role.strip():
                raise KairoValidationError(
                    f"Message at index {i} is missing a valid 'role'.",
                    status_code=400,
                )
            if not content or not isinstance(content, str) or not content.strip():
                raise KairoValidationError(
                    f"Message at index {i} is missing a valid 'content'.",
                    status_code=400,
                )

            serialized_messages.append({
                "role": role.strip(),
                "content": content.strip(),
            })

        payload: dict[str, Any] = {
            "messages": serialized_messages,
        }
        if resolved_actor_id is not None:
            payload["actorId"] = resolved_actor_id
        if scope_dict is not None:
            payload["scope"] = scope_dict

        data = self._client._request(
            "POST",
            "/api/v1/memories/ingest",
            json=payload,
        )
        return MemoryIngestionResponse._from_dict(data or {})

