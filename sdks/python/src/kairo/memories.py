"""
Kairo Memory resource.

Provides all memory operations against the Kairo REST API.
Access via ``client.memories``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .models import (
    CreateMemoryResult,
    DeleteMemoryResult,
    Memory,
    MemorySearchResponse,
)

if TYPE_CHECKING:
    from .client import Kairo


class MemoryResource:
    """Provides access to all Kairo memory operations.

    Accessed as ``client.memories`` on a :class:`~kairo.Kairo` instance.
    Do not instantiate this class directly.

    Example::

        client = Kairo(api_key="kairo_live_xxx")

        # Create
        result = client.memories.create(
            content="User prefers dark mode",
            memory_type="Preference",
        )

        # Search
        results = client.memories.search(
            query="What UI theme does the user prefer?"
        )
    """

    def __init__(self, client: Kairo) -> None:
        self._client = client

    # ── Create ────────────────────────────────────────────────────────────────

    def create(
        self,
        *,
        content: str,
        memory_type: str,
    ) -> CreateMemoryResult:
        """Create a new memory for the authenticated user.

        Calls ``POST /api/v1/memories``.

        The backend automatically detects exact and semantic duplicates.
        When a duplicate is detected, no new record is created. Check
        ``result.is_duplicate`` to distinguish the two cases.

        :param content: The memory content (max 10,000 characters).
        :param memory_type: Memory classification. One of:
            ``Preference``, ``Fact``, ``Goal``, ``Context``,
            ``Skill``, ``Relationship``, ``Other``.
        :returns: A :class:`~kairo.CreateMemoryResult`.
        :raises KairoValidationError: If ``content`` or ``memory_type``
            fails server-side validation.
        :raises KairoAuthenticationError: If the API key is invalid.

        Example::

            result = client.memories.create(
                content="User works in Python and prefers type hints",
                memory_type="Fact",
            )
            if not result.is_duplicate:
                print(f"Stored memory {result.memory.memory_id}")
        """
        data = self._client._request(
            "POST",
            "/api/v1/memories",
            json={
                "content": content,
                "memoryType": memory_type,
            },
        )

        # Backend returns HTTP 200 with {isDuplicate: true, reason: "..."}
        # for duplicates, and HTTP 201 with MemoryResponse for new records.
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
        """Retrieve a single memory by ID.

        Calls ``GET /api/v1/memories/{memoryId}``.

        :param memory_id: The integer ID of the memory to retrieve.
        :returns: A :class:`~kairo.Memory`.
        :raises KairoNotFoundError: If the memory does not exist or
            does not belong to the authenticated user.

        Example::

            memory = client.memories.get(memory_id=16)
            print(memory.content)
        """
        data = self._client._request(
            "GET",
            f"/api/v1/memories/{memory_id}",
        )
        return Memory._from_dict(data)

    # ── List ──────────────────────────────────────────────────────────────────

    def list(self) -> list[Memory]:
        """List all active memories for the authenticated user.

        Calls ``GET /api/v1/memories``.

        Results are returned newest-first.

        :returns: A list of :class:`~kairo.Memory` objects.

        Example::

            memories = client.memories.list()
            for memory in memories:
                print(f"[{memory.memory_id}] {memory.content}")
        """
        data = self._client._request(
            "GET",
            "/api/v1/memories",
        )
        # Backend envelope: { userId, count, memories: [...] }
        raw_list = data.get("memories", []) if data else []
        return [Memory._from_dict(m) for m in raw_list]

    # ── Update ────────────────────────────────────────────────────────────────

    def update(
        self,
        *,
        memory_id: int,
        content: str,
        memory_type: str,
    ) -> Memory:
        """Update the content and type of an existing memory.

        Calls ``PUT /api/v1/memories/{memoryId}``.

        The backend archives the previous version and regenerates the
        embedding for the updated content.

        :param memory_id: The ID of the memory to update.
        :param content: The new memory content (max 10,000 characters).
        :param memory_type: The new memory type. One of:
            ``Preference``, ``Fact``, ``Goal``, ``Context``,
            ``Skill``, ``Relationship``, ``Other``.
        :returns: The updated :class:`~kairo.Memory`.
        :raises KairoNotFoundError: If the memory does not exist or
            does not belong to the authenticated user.

        Example::

            updated = client.memories.update(
                memory_id=16,
                content="User strongly prefers dark mode",
                memory_type="Preference",
            )
        """
        data = self._client._request(
            "PUT",
            f"/api/v1/memories/{memory_id}",
            json={
                "content": content,
                "memoryType": memory_type,
            },
        )
        return Memory._from_dict(data)

    # ── Delete ────────────────────────────────────────────────────────────────

    def delete(self, memory_id: int) -> DeleteMemoryResult:
        """Deactivate (soft-delete) a memory.

        Calls ``DELETE /api/v1/memories/{memoryId}``.

        The memory record is preserved in the Kairo database. It is
        marked inactive and will no longer appear in list or search
        results. This operation cannot be undone through the SDK.

        :param memory_id: The ID of the memory to deactivate.
        :returns: A :class:`~kairo.DeleteMemoryResult`.
        :raises KairoNotFoundError: If the memory does not exist or
            does not belong to the authenticated user.

        Example::

            result = client.memories.delete(memory_id=16)
            print(result.message)
        """
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
        top_k: int = 5,
    ) -> MemorySearchResponse:
        """Search memories semantically.

        Calls ``POST /api/v1/memories/search``.

        The backend generates an embedding for ``query``, computes
        cosine similarity against all stored memories, and applies
        relevance evaluation to return the most contextually appropriate
        results.

        :param query: Natural-language search query.
        :param top_k: Maximum number of memories to return (1–100).
            Defaults to 5.
        :returns: A :class:`~kairo.MemorySearchResponse`.
        :raises KairoValidationError: If ``query`` is empty or
            ``top_k`` is out of range.

        Example::

            results = client.memories.search(
                query="What interface theme does the user prefer?",
                top_k=3,
            )
            for m in results.memories:
                print(f"[{m.similarity:.4f}] {m.content}")
        """
        data = self._client._request(
            "POST",
            "/api/v1/memories/search",
            json={
                "query": query,
                "topK": top_k,
            },
        )
        return MemorySearchResponse._from_dict(data)
