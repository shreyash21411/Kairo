"""
Kairo Agent Memory Integration.

Provides a thin agent-facing abstraction over the Kairo Memory API.

The ``KairoAgentMemory`` class wraps the existing Kairo SDK with
semantics that read naturally inside an AI agent:

- ``remember`` — store durable information
- ``recall``   — retrieve semantically relevant memories
- ``update``   — correct an existing memory
- ``forget``   — deactivate a memory that is no longer relevant

Architecture
------------

Agent
  |
  +-- KairoAgentMemory
        |
        v
  kairo.memories.*       (existing frozen SDK)
        |
        v
  Kairo REST API
        |
        v
  Memory Engine / SQL / Embeddings / Mistral

No memory logic lives inside this module.
All persistence, duplicate detection, embedding, retrieval, and
consolidation are handled by the existing Kairo backend.

Responsibility boundaries
-------------------------

Kairo is responsible for:
  - Persisting memory
  - Detecting duplicates
  - Generating embeddings
  - Semantic retrieval
  - Memory versioning and lifecycle

The agent/developer remains responsible for:
  - Deciding what information is worth remembering
  - Deciding when to recall context
  - Constructing LLM prompts
  - Generating responses
  - Executing tools
  - Agent reasoning

Kairo does not run the agent loop. Kairo does not call the LLM.

Usage
-----

Python::

    import os
    from kairo import Kairo
    from kairo.agent import KairoAgentMemory

    kairo = Kairo(api_key=os.environ["KAIRO_API_KEY"])
    memory = KairoAgentMemory(kairo)

    # 1. Before calling the LLM — recall relevant context
    context = memory.recall(
        query="What are the user's coding preferences?",
        top_k=5,
    )
    for m in context.memories:
        print(f"[{m.similarity:.4f}] {m.content}")

    # 2. After the LLM response — store durable information
    result = memory.remember(
        content="User strongly prefers type hints in Python",
        memory_type="Preference",
    )
    if result.is_duplicate:
        print("Already known:", result.duplicate_reason)
    else:
        print("Remembered:", result.memory.memory_id)

    # 3. Correct an existing memory
    updated = memory.update(
        memory_id=result.memory.memory_id,
        content="User strictly requires type hints in all Python code",
        memory_type="Preference",
    )

    # 4. Deactivate a memory that is no longer accurate
    memory.forget(memory_id=result.memory.memory_id)

"""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from .exceptions import KairoValidationError
from .models import (
    CreateMemoryResult,
    DeleteMemoryResult,
    IngestMessage,
    Memory,
    MemoryIngestionResponse,
    MemorySearchResponse,
)

if TYPE_CHECKING:
    from .client import Kairo


class KairoAgentMemory:
    """Thin agent-facing memory abstraction built on the Kairo SDK.

    Wraps ``client.memories`` with semantics suited to an AI agent:

    - :meth:`remember` — persist durable information
    - :meth:`recall`   — retrieve semantically relevant memories
    - :meth:`update`   — correct an existing memory
    - :meth:`forget`   — deactivate a memory

    All operations delegate directly to the existing Kairo REST API
    through the frozen SDK. No memory logic is implemented here.

    :param client: An authenticated :class:`~kairo.Kairo` instance.
    :param actor_id: Optional default application-level actor identifier.

    Example::

        from kairo import Kairo
        from kairo.agent import KairoAgentMemory

        kairo = Kairo(api_key=os.environ["KAIRO_API_KEY"])
        memory = KairoAgentMemory(kairo, actor_id="user-123")

        context = memory.recall(query="What does the user prefer?")
        result  = memory.remember(
            content="User prefers dark mode",
            memory_type="Preference",
        )
    """

    def __init__(
        self,
        client: Kairo,
        *,
        actor_id: Optional[str] = None,
    ) -> None:
        self._client = client
        self._actor_id = actor_id

    # ── remember ──────────────────────────────────────────────────────────────

    def remember(
        self,
        *,
        content: str,
        memory_type: str,
        actor_id: Optional[str] = None,
    ) -> CreateMemoryResult:
        """Store durable information as a Kairo memory.

        Delegates to ``POST /api/v1/memories``.

        The backend automatically detects exact and semantic duplicates.
        When a duplicate is detected, no new record is created. Check
        ``result.is_duplicate`` to distinguish the two cases.

        The agent is responsible for deciding *what* to remember.
        Kairo handles persistence, duplicate detection, and embedding.

        :param content: The information to store (max 10,000 characters).
        :param memory_type: Memory classification. One of:
            ``Preference``, ``Fact``, ``Goal``, ``Context``,
            ``Skill``, ``Relationship``, ``Other``.
        :param actor_id: Optional actor identifier override. If not passed,
            uses default ``actor_id`` configured on this instance.
        :returns: A :class:`~kairo.CreateMemoryResult`.

        Example::

            result = memory.remember(
                content="User prefers concise technical answers",
                memory_type="Preference",
            )
            if not result.is_duplicate:
                print(f"Stored memory {result.memory.memory_id}")
        """
        resolved_actor = actor_id or self._actor_id
        if not resolved_actor or not resolved_actor.strip():
            raise KairoValidationError(
                "actor_id is required. Provide actor_id on KairoAgentMemory "
                "or pass actor_id to remember().",
                status_code=400,
            )

        return self._client.memories.create(
            content=content,
            memory_type=memory_type,
            actor_id=resolved_actor,
        )

    # ── recall ────────────────────────────────────────────────────────────────

    def recall(
        self,
        *,
        query: str,
        top_k: int = 5,
        actor_id: Optional[str] = None,
    ) -> MemorySearchResponse:
        """Retrieve semantically relevant memories for a given query.

        Delegates to ``POST /api/v1/memories/search``.

        The backend generates an embedding for ``query``, computes
        cosine similarity against all stored memories, and applies
        relevance evaluation to return the most contextually appropriate
        results.

        The agent is responsible for incorporating the recalled context
        into its LLM prompt. Kairo does not construct or send prompts.

        :param query: A natural-language question or context statement.
        :param top_k: Maximum number of memories to return (1–100).
            Defaults to 5.
        :param actor_id: Optional actor identifier override. If not passed,
            uses default ``actor_id`` configured on this instance.
        :returns: A :class:`~kairo.MemorySearchResponse`.

        Example::

            context = memory.recall(
                query="What programming languages does the user work with?",
                top_k=3,
            )
            for m in context.memories:
                print(f"[{m.similarity:.4f}] {m.content}")
        """
        resolved_actor = actor_id or self._actor_id
        if not resolved_actor or not resolved_actor.strip():
            raise KairoValidationError(
                "actor_id is required. Provide actor_id on KairoAgentMemory "
                "or pass actor_id to recall().",
                status_code=400,
            )

        return self._client.memories.search(
            query=query,
            actor_id=resolved_actor,
            top_k=top_k,
        )

    # ── update ────────────────────────────────────────────────────────────────

    def update(
        self,
        *,
        memory_id: int,
        content: str,
        memory_type: str,
    ) -> Memory:
        """Correct or refine an existing memory.

        Delegates to ``PUT /api/v1/memories/{memoryId}``.

        The backend archives the previous version and regenerates the
        semantic embedding for the updated content.

        :param memory_id: The ID of the memory to update.
        :param content: The corrected content (max 10,000 characters).
        :param memory_type: The updated memory classification.
        :returns: The updated :class:`~kairo.Memory`.

        Example::

            updated = memory.update(
                memory_id=42,
                content="User strictly requires type hints in Python",
                memory_type="Preference",
            )
        """
        return self._client.memories.update(
            memory_id=memory_id,
            content=content,
            memory_type=memory_type,
        )

    # ── forget ────────────────────────────────────────────────────────────────

    def forget(self, *, memory_id: int) -> DeleteMemoryResult:
        """Deactivate a memory that is no longer accurate or relevant.

        Delegates to ``DELETE /api/v1/memories/{memoryId}``.

        The memory record is preserved in the Kairo database. It is
        marked inactive and will no longer appear in recall results.
        This reflects the soft-deletion behaviour of the Kairo backend.

        :param memory_id: The ID of the memory to deactivate.
        :returns: A :class:`~kairo.DeleteMemoryResult`.

        Example::

            result = memory.forget(memory_id=42)
            print(result.message)
        """
        return self._client.memories.delete(memory_id=memory_id)

    def __repr__(self) -> str:
        if self._actor_id:
            return f"KairoAgentMemory(client={self._client!r}, actor_id={self._actor_id!r})"
        return f"KairoAgentMemory(client={self._client!r})"
