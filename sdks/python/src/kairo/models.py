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

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


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

    Example::

        memory = client.memories.get(memory_id=16)
        print(memory.content)
        print(memory.memory_type)
    """

    memory_id: int
    user_id: int
    content: str
    memory_type: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, data: dict) -> Memory:
        return cls(
            memory_id=data["memoryId"],
            user_id=data["userId"],
            content=data["content"],
            memory_type=data.get("memoryType"),
            is_active=data["isActive"],
            created_at=_parse_dt(data["createdAt"]),
            updated_at=_parse_dt(data["updatedAt"]),
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
    """Result of a memory creation request.

    When the backend identifies the submitted content as an exact or
    semantic duplicate of an existing memory, ``is_duplicate`` will be
    ``True`` and ``memory`` will be ``None``.

    When a new memory is successfully created, ``is_duplicate`` is
    ``False`` and ``memory`` holds the created :class:`Memory`.

    Example::

        result = client.memories.create(
            content="User prefers dark mode",
            memory_type="Preference",
            actor_id="user-123",
        )
        if result.is_duplicate:
            print(f"Duplicate: {result.duplicate_reason}")
        else:
            print(f"Created memory {result.memory.memory_id}")
    """

    memory: Optional[Memory]
    is_duplicate: bool
    duplicate_reason: Optional[str]

    def __repr__(self) -> str:
        if self.is_duplicate:
            return f"CreateMemoryResult(is_duplicate=True, reason={self.duplicate_reason!r})"
        return f"CreateMemoryResult(memory={self.memory!r})"


@dataclass
class RetrievedMemory:
    """A memory returned from a semantic search, ranked by similarity.

    Example::

        results = client.memories.search(
            query="What theme does the user prefer?",
            actor_id="user-123",
        )
        for m in results.memories:
            print(f"[{m.similarity:.4f}] {m.content}")
    """

    memory_id: int
    content: str
    memory_type: Optional[str]
    similarity: float

    @classmethod
    def _from_dict(cls, data: dict) -> RetrievedMemory:
        return cls(
            memory_id=data["memoryId"],
            content=data["content"],
            memory_type=data.get("memoryType"),
            similarity=data["similarity"],
        )

    def __repr__(self) -> str:
        return (
            f"RetrievedMemory("
            f"memory_id={self.memory_id!r}, "
            f"similarity={self.similarity:.4f})"
        )


@dataclass
class MemorySearchResponse:
    """Response from a semantic memory search.

    Example::

        results = client.memories.search(
            query="dark mode",
            actor_id="user-123",
            top_k=3,
        )
        print(f"Found {results.count} relevant memories")
        for m in results.memories:
            print(m.content)
    """

    query: str
    count: int
    memories: list[RetrievedMemory]

    @classmethod
    def _from_dict(cls, data: dict) -> MemorySearchResponse:
        return cls(
            query=data["query"],
            count=data["count"],
            memories=[
                RetrievedMemory._from_dict(m) for m in data.get("memories", [])
            ],
        )

    def __repr__(self) -> str:
        return (
            f"MemorySearchResponse("
            f"query={self.query!r}, "
            f"count={self.count!r})"
        )


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
    def _from_dict(cls, data: dict) -> DeleteMemoryResult:
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
    def _from_dict(cls, data: dict) -> IngestionMemoryResult:
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
    def _from_dict(cls, data: dict) -> MemoryIngestionResponse:
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

