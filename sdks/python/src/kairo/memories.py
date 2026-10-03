"""
Kairo Memory resource.

Provides all memory operations against the Kairo REST API.
Access via ``client.memories``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Union

from .exceptions import KairoValidationError
from .models import (
    CreateMemoryResult,
    DeleteMemoryResult,
    IngestMessage,
    IngestionMemoryResult,
    Memory,
    MemoryIngestionResponse,
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
            actor_id="user-123",
        )

        # Search
        results = client.memories.search(
            query="What UI theme does the user prefer?",
            actor_id="user-123",
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
        actor_id: str,
    ) -> CreateMemoryResult:
        """Create a new memory for the authenticated user and specified actor.

        Calls ``POST /api/v1/memories``.

        The backend automatically detects exact and semantic duplicates.
        When a duplicate is detected, no new record is created. Check
        ``result.is_duplicate`` to distinguish the two cases.

        :param content: The memory content (max 10,000 characters).
        :param memory_type: Memory classification. One of:
            ``Preference``, ``Fact``, ``Goal``, ``Context``,
            ``Skill``, ``Relationship``, ``Other``.
        :param actor_id: Application-level actor identifier for memory scoping.
        :returns: A :class:`~kairo.CreateMemoryResult`.
        :raises KairoValidationError: If ``content``, ``memory_type``, or ``actor_id``
            fails server-side validation.
        :raises KairoAuthenticationError: If the API key is invalid.

        Example::

            result = client.memories.create(
                content="User works in Python and prefers type hints",
                memory_type="Fact",
                actor_id="user-123",
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
                "actorId": actor_id,
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
        actor_id: str,
        top_k: int = 5,
    ) -> MemorySearchResponse:
        """Search memories semantically within an actor scope.

        Calls ``POST /api/v1/memories/search``.

        The backend generates an embedding for ``query``, computes
        cosine similarity against stored memories within the resolved
        actor scope, and applies relevance evaluation to return the most
        contextually appropriate results.

        :param query: Natural-language search query.
        :param actor_id: Application-level actor identifier for memory scoping.
        :param top_k: Maximum number of memories to return (1–100).
            Defaults to 5.
        :returns: A :class:`~kairo.MemorySearchResponse`.
        :raises KairoValidationError: If ``query`` is empty, ``actor_id`` is missing,
            or ``top_k`` is out of range.

        Example::

            results = client.memories.search(
                query="What interface theme does the user prefer?",
                actor_id="user-123",
                top_k=3,
            )
            for m in results.memories:
                print(f"[{m.similarity:.4f}] {m.content}")
        """
        if not query or not isinstance(query, str) or not query.strip():
            raise KairoValidationError("query must not be empty.", status_code=400)
        if not actor_id or not isinstance(actor_id, str) or not actor_id.strip():
            raise KairoValidationError("actor_id must not be empty.", status_code=400)
        if len(actor_id.strip()) > 128:
            raise KairoValidationError("actor_id must not exceed 128 characters.", status_code=400)
        if not isinstance(top_k, int) or isinstance(top_k, bool) or top_k < 1 or top_k > 100:
            raise KairoValidationError("top_k must be an integer between 1 and 100.", status_code=400)

        data = self._client._request(
            "POST",
            "/api/v1/memories/search",
            json={
                "query": query.strip(),
                "actorId": actor_id.strip(),
                "topK": top_k,
            },
        )
        return MemorySearchResponse._from_dict(data)

    # ── Ingest ────────────────────────────────────────────────────────────────

    def ingest(
        self,
        *,
        actor_id: str,
        messages: list[Union[dict[str, str], IngestMessage]],
    ) -> MemoryIngestionResponse:
        """Ingest a conversation and extract durable memories with automatic consolidation.

        Calls ``POST /api/v1/memories/ingest``.

        The Kairo backend extracts salient knowledge from the conversation,
        evaluates candidate memories against existing memories within the actor's scope,
        and applies the appropriate operation: Add, Update, Merge, or NoAction.

        :param actor_id: Application-level actor identifier for memory scoping.
        :param messages: List of conversation messages (as dicts with 'role' and 'content',
            or :class:`~kairo.models.IngestMessage` instances).
        :returns: A :class:`~kairo.models.MemoryIngestionResponse`.
        :raises KairoValidationError: If ``actor_id`` or ``messages`` is empty or malformed.
        :raises KairoAuthenticationError: If the API key is invalid.

        Example::

            response = client.memories.ingest(
                actor_id="user-123",
                messages=[
                    {"role": "user", "content": "I prefer PostgreSQL for backend applications."},
                ],
            )
            for mem in response.memories:
                print(f"[{mem.action}] ID: {mem.memory_id} - {mem.content}")
        """
        if not actor_id or not isinstance(actor_id, str) or not actor_id.strip():
            raise KairoValidationError("actor_id must not be empty.", status_code=400)
        if len(actor_id.strip()) > 128:
            raise KairoValidationError("actor_id must not exceed 128 characters.", status_code=400)

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

        data = self._client._request(
            "POST",
            "/api/v1/memories/ingest",
            json={
                "actorId": actor_id.strip(),
                "messages": serialized_messages,
            },
        )
        return MemoryIngestionResponse._from_dict(data or {})

