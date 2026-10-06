"""
Kairo Python SDK.

Official client library for the Kairo AI Memory Platform.

Usage::

    from kairo import Kairo

    client = Kairo(api_key="kairo_live_xxx")

    result = client.memories.create(
        content="User prefers dark mode",
        memory_type="Preference",
        actor_id="user-123",
    )

    results = client.memories.search(
        query="What UI theme does the user prefer?",
        actor_id="user-123",
        top_k=5,
    )

"""

from .agent import KairoAgentMemory
from .client import Kairo, KairoClient
from .exceptions import (
    KairoAuthenticationError,
    KairoAuthorizationError,
    KairoConflictError,
    KairoConnectionError,
    KairoError,
    KairoNotFoundError,
    KairoRateLimitError,
    KairoServerError,
    KairoValidationError,
)
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
    RetrievedMemory,
)

__all__ = [
    # Client
    "Kairo",
    "KairoClient",
    # Agent Integration
    "KairoAgentMemory",
    # Exceptions
    "KairoError",
    "KairoAuthenticationError",
    "KairoAuthorizationError",
    "KairoNotFoundError",
    "KairoValidationError",
    "KairoConflictError",
    "KairoRateLimitError",
    "KairoServerError",
    "KairoConnectionError",
    # Models
    "Memory",
    "MemoryScope",
    "CreateMemoryResult",
    "RetrievedMemory",
    "MemorySearchResponse",
    "DeleteMemoryResult",
    # Phase 2: Temporal, Metadata, Graph
    "GraphRelation",
    "MemoryTemporalFilter",
    "MetadataFilterCondition",
    # Phase 4: Ingestion
    "IngestMessage",
    "IngestionMemoryResult",
    "MemoryIngestionResponse",
]

__version__ = "0.1.0"
