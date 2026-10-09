"""
Typed SDK models for Kairo API responses.

These classes represent the data returned by the Kairo REST API,
translated to Python naming conventions.

Backend JSON field mapping:

    memoryId   →  memory_id
    userId     →  user_id
    memoryType →  memory_type
    isActive   →  is_active
    createdAt  →  created_at
    updatedAt  →  updated_at
    topK       →  top_k  (request, not response)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


def _parse_dt(value: str) -> datetime:
    """Parse an ISO 8601 datetime string from the Kairo API.

    Replaces the trailing 'Z' with '+00:00' for compatibility with
    ``datetime.fromisoformat`` across Python 3.10–3.13.
    """
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass
class Memory:
    """A memory stored in Kairo.

    Returned by :meth:`~kairo.MemoryResource.create`,
    :meth:`~kairo.MemoryResource.get`,
    :meth:`~kairo.MemoryResource.list`, and
    :meth:`~kairo.MemoryResource.update`.
    """

    memory_id: int
    user_id: int
    content: str
    memory_type: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    occurred_at: Optional[datetime] = None
    metadata: Optional[dict[str, Any]] = None
    expires_at: Optional[datetime] = None
    categories: list[str] = field(default_factory=list)

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> Memory:
        occ = data.get("occurredAt")
        exp = data.get("expiresAt")
        cats = data.get("categories") or []
        raw_meta = data.get("metadata")
        meta = raw_meta
        if isinstance(raw_meta, str):
            try:
                import json
                meta = json.loads(raw_meta)
            except Exception:
                meta = raw_meta

        return cls(
            memory_id=data["memoryId"],
            user_id=data["userId"],
            content=data["content"],
            memory_type=data.get("memoryType"),
            is_active=data["isActive"],
            created_at=_parse_dt(data["createdAt"]),
            updated_at=_parse_dt(data["updatedAt"]),
            occurred_at=_parse_dt(occ) if occ else None,
            metadata=meta if isinstance(meta, dict) else None,
            expires_at=_parse_dt(exp) if exp else None,
            categories=list(cats) if isinstance(cats, list) else [],
        )

    def __repr__(self) -> str:
        return (
            f"Memory("
            f"memory_id={self.memory_id!r}, "
            f"memory_type={self.memory_type!r}, "
            f"is_active={self.is_active!r})"
        )


@dataclass
class CreateMemoryResult:
    """Result of a memory creation request."""

    memory: Optional[Memory]
    is_duplicate: bool
    duplicate_reason: Optional[str]

    def __repr__(self) -> str:
        if self.is_duplicate:
            return f"CreateMemoryResult(is_duplicate=True, reason={self.duplicate_reason!r})"
        return f"CreateMemoryResult(memory={self.memory!r})"


@dataclass
class RetrievedMemory:
    """A memory returned from a search, ranked by similarity / fused score."""

    memory_id: int
    content: str
    memory_type: Optional[str]
    similarity: float
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    occurred_at: Optional[datetime] = None
    metadata: Optional[dict[str, Any]] = None
    expires_at: Optional[datetime] = None
    categories: list[str] = field(default_factory=list)

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> RetrievedMemory:
        cat = data.get("createdAt")
        uat = data.get("updatedAt")
        occ = data.get("occurredAt")
        exp = data.get("expiresAt")
        cats = data.get("categories") or []
        raw_meta = data.get("metadata")
        meta = raw_meta
        if isinstance(raw_meta, str):
            try:
                import json
                meta = json.loads(raw_meta)
            except Exception:
                meta = raw_meta

        return cls(
            memory_id=data["memoryId"],
            content=data["content"],
            memory_type=data.get("memoryType"),
            similarity=data["similarity"],
            created_at=_parse_dt(cat) if cat else None,
            updated_at=_parse_dt(uat) if uat else None,
            occurred_at=_parse_dt(occ) if occ else None,
            metadata=meta if isinstance(meta, dict) else None,
            expires_at=_parse_dt(exp) if exp else None,
            categories=list(cats) if isinstance(cats, list) else [],
        )

    def __repr__(self) -> str:
        return (
            f"RetrievedMemory("
            f"memory_id={self.memory_id!r}, "
            f"similarity={self.similarity:.4f})"
        )


@dataclass
class GraphRelation:
    """A relationship between entities returned in search results."""

    source: str
    relationship: str
    target: str
    confidence: float = 1.0

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> GraphRelation:
        return cls(
            source=data.get("source", ""),
            relationship=data.get("relationship", ""),
            target=data.get("target", ""),
            confidence=float(data.get("confidence", 1.0)),
        )


@dataclass
class MemorySearchResponse:
    """Response from a semantic or hybrid memory search."""

    query: str
    count: int
    memories: list[RetrievedMemory]
    relations: list[GraphRelation] = field(default_factory=list)

    def __post_init__(self) -> None:
        pass

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> MemorySearchResponse:
        return cls(
            query=data["query"],
            count=data["count"],
            memories=[
                RetrievedMemory._from_dict(m) for m in data.get("memories", [])
            ],
            relations=[
                GraphRelation._from_dict(r) for r in data.get("relations", [])
            ],
        )

    def __repr__(self) -> str:
        return (
            f"MemorySearchResponse("
            f"query={self.query!r}, "
            f"count={self.count!r}, "
            f"relations={len(self.relations)})"
        )


@dataclass
class MemoryTemporalFilter:
    """Temporal constraints for memory retrieval."""

    created_at_from: Optional[datetime] = None
    created_at_to: Optional[datetime] = None
    updated_at_from: Optional[datetime] = None
    updated_at_to: Optional[datetime] = None
    occurred_at_from: Optional[datetime] = None
    occurred_at_to: Optional[datetime] = None
    last_hours: Optional[int] = None
    last_days: Optional[int] = None
    last_weeks: Optional[int] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {}
        if self.created_at_from:
            d["createdAtFrom"] = self.created_at_from.isoformat()
        if self.created_at_to:
            d["createdAtTo"] = self.created_at_to.isoformat()
        if self.updated_at_from:
            d["updatedAtFrom"] = self.updated_at_from.isoformat()
        if self.updated_at_to:
            d["updatedAtTo"] = self.updated_at_to.isoformat()
        if self.occurred_at_from:
            d["occurredAtFrom"] = self.occurred_at_from.isoformat()
        if self.occurred_at_to:
            d["occurredAtTo"] = self.occurred_at_to.isoformat()
        if self.last_hours is not None:
            d["lastHours"] = self.last_hours
        if self.last_days is not None:
            d["lastDays"] = self.last_days
        if self.last_weeks is not None:
            d["lastWeeks"] = self.last_weeks
        return d


@dataclass
class MetadataFilterCondition:
    """Structured condition for metadata filtering."""

    key: str
    operator: str = "eq"  # "eq", "ne", "in"
    value: Optional[str] = None
    in_values: Optional[list[str]] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"key": self.key, "operator": self.operator}
        if self.value is not None:
            d["value"] = self.value
        if self.in_values is not None:
            d["inValues"] = self.in_values
        return d



@dataclass
class DeleteMemoryResult:
    """Result of a memory deletion (soft-deactivation) request.

    The memory record is preserved in the Kairo database.
    It is marked inactive and will no longer appear in list
    or search results.

    Example::

        result = client.memories.delete(memory_id=16)
        print(result.message)
    """

    memory_id: int
    message: str

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> DeleteMemoryResult:
        return cls(
            memory_id=data["memoryId"],
            message=data["message"],
        )

    def __repr__(self) -> str:
        return f"DeleteMemoryResult(memory_id={self.memory_id!r})"


# ── Phase 1: Multi-dimensional Memory Scope ──────────────────────────────────

@dataclass
class MemoryScope:
    """Multi-dimensional memory scope for Phase 1+ scoping.

    Supports scoping across:
    - actor_id: Legacy V1 actor identifier
    - user_id: Application-level user identifier
    - agent_id: Agent identifier
    - session_id: Conversation session identifier
    - run_id: Execution run identifier
    """

    actor_id: Optional[str] = None
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    session_id: Optional[str] = None
    run_id: Optional[str] = None

    def to_dict(self) -> dict[str, str]:
        """Convert scope to camelCase dictionary for API payloads."""
        d: dict[str, str] = {}
        if self.actor_id is not None:
            d["actorId"] = self.actor_id
        if self.user_id is not None:
            d["userId"] = self.user_id
        if self.agent_id is not None:
            d["agentId"] = self.agent_id
        if self.session_id is not None:
            d["sessionId"] = self.session_id
        if self.run_id is not None:
            d["runId"] = self.run_id
        return d


# ── Phase 4: Conversational Ingestion Models ─────────────────────────────────


@dataclass
class IngestMessage:
    """A single message within a conversation submitted for memory ingestion."""

    role: str
    content: str


@dataclass
class IngestionMemoryResult:
    """The result for a single candidate memory processed during ingestion.

    :param action: The action performed: "Add", "Update", "Merge", or "NoAction".
    :param memory_id: The ID of the affected memory (null for NoAction).
    :param content: The persisted or updated canonical memory content.
    :param reason: Optional explanation for the action (e.g. consolidation rationale).
    """

    action: str
    memory_id: Optional[int]
    content: str
    reason: Optional[str]

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> IngestionMemoryResult:
        return cls(
            action=data["action"],
            memory_id=data.get("memoryId"),
            content=data["content"],
            reason=data.get("reason"),
        )

    def __repr__(self) -> str:
        return (
            f"IngestionMemoryResult("
            f"action={self.action!r}, "
            f"memory_id={self.memory_id!r}, "
            f"content={self.content!r})"
        )


@dataclass
class MemoryIngestionResponse:
    """Response from a conversational memory ingestion request.

    Returned by :meth:`~kairo.MemoryResource.ingest`.
    """

    processed: bool
    extracted_count: int
    memories: list[IngestionMemoryResult]

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> MemoryIngestionResponse:
        return cls(
            processed=data.get("processed", False),
            extracted_count=data.get("extractedCount", 0),
            memories=[
                IngestionMemoryResult._from_dict(m)
                for m in data.get("memories", [])
            ],
        )

    def __repr__(self) -> str:
        return (
            f"MemoryIngestionResponse("
            f"processed={self.processed!r}, "
            f"extracted_count={self.extracted_count!r}, "
            f"memories_count={len(self.memories)})"
        )


# ── Phase 3: Batch Operation Models ──────────────────────────────────────────


@dataclass
class BatchOperationError:
    """An error that occurred for a specific item in a batch operation."""

    message: str
    memory_id: Optional[int] = None
    index: Optional[int] = None

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> BatchOperationError:
        return cls(
            message=data.get("message", ""),
            memory_id=data.get("memoryId"),
            index=data.get("index"),
        )


@dataclass
class BatchCreateResponse:
    """Response from a batch memory creation request."""

    success: bool
    created_count: int
    memories: list[Memory]
    errors: list[BatchOperationError] = field(default_factory=list)

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> BatchCreateResponse:
        return cls(
            success=data.get("success", False),
            created_count=data.get("createdCount", 0),
            memories=[Memory._from_dict(m) for m in data.get("memories", [])],
            errors=[BatchOperationError._from_dict(e) for e in data.get("errors", [])],
        )


@dataclass
class BatchUpdateResponse:
    """Response from a batch memory update request."""

    success: bool
    updated_count: int
    memories: list[Memory]
    errors: list[BatchOperationError] = field(default_factory=list)

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> BatchUpdateResponse:
        return cls(
            success=data.get("success", False),
            updated_count=data.get("updatedCount", 0),
            memories=[Memory._from_dict(m) for m in data.get("memories", [])],
            errors=[BatchOperationError._from_dict(e) for e in data.get("errors", [])],
        )


@dataclass
class BatchDeleteResponse:
    """Response from a batch memory deletion request."""

    success: bool
    deleted_count: int
    deleted_ids: list[int]
    errors: list[BatchOperationError] = field(default_factory=list)

    @classmethod
    def _from_dict(cls, data: dict[str, Any]) -> BatchDeleteResponse:
        return cls(
            success=data.get("success", False),
            deleted_count=data.get("deletedCount", 0),
            deleted_ids=list(data.get("deletedIds", [])),
            errors=[BatchOperationError._from_dict(e) for e in data.get("errors", [])],
        )


