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
