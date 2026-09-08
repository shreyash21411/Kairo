"""
Kairo Python SDK.

Official client library for the Kairo AI Memory Platform.

Usage::

    from kairo import Kairo

    client = Kairo(api_key="kairo_live_xxx")

    result = client.memories.create(
        content="User prefers dark mode",
        memory_type="Preference",
    )

    results = client.memories.search(
        query="What UI theme does the user prefer?",
        top_k=5,
    )

"""

from .client import Kairo
from .exceptions import (
    KairoAuthenticationError,
    KairoAuthorizationError,
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
    Memory,
    MemorySearchResponse,
    RetrievedMemory,
)

__all__ = [
    # Client
    "Kairo",
    # Exceptions
    "KairoError",
    "KairoAuthenticationError",
    "KairoAuthorizationError",
    "KairoNotFoundError",
    "KairoValidationError",
    "KairoRateLimitError",
    "KairoServerError",
    "KairoConnectionError",
    # Models
    "Memory",
    "CreateMemoryResult",
    "RetrievedMemory",
    "MemorySearchResponse",
    "DeleteMemoryResult",
]

__version__ = "0.1.0"
