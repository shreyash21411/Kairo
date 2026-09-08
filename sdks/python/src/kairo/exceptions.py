"""
Kairo SDK exception hierarchy.

All exceptions raised by the SDK inherit from ``KairoError``.

HTTP status code mapping:

    400  →  KairoValidationError
    401  →  KairoAuthenticationError
    403  →  KairoAuthorizationError
    404  →  KairoNotFoundError
    429  →  KairoRateLimitError
    5xx  →  KairoServerError

Network/transport failures:

    KairoConnectionError
"""


class KairoError(Exception):
    """Base exception for all Kairo SDK errors."""


class KairoAuthenticationError(KairoError):
    """API key is missing, invalid, revoked, or expired.

    Corresponds to HTTP 401.
    """


class KairoAuthorizationError(KairoError):
    """The authenticated user does not have permission to perform this action.

    Corresponds to HTTP 403.
    """


class KairoNotFoundError(KairoError):
    """The requested resource does not exist or does not belong to the authenticated user.

    Corresponds to HTTP 404.
    """


class KairoValidationError(KairoError):
    """The request is malformed or contains invalid input.

    Corresponds to HTTP 400.
    """


class KairoRateLimitError(KairoError):
    """The API rate limit has been exceeded.

    Corresponds to HTTP 429.
    """


class KairoServerError(KairoError):
    """The Kairo server encountered an unexpected error.

    Corresponds to HTTP 5xx.
    """


class KairoConnectionError(KairoError):
    """A network or connection error prevented reaching the Kairo API."""
