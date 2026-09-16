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


from typing import Optional


class KairoError(Exception):
    """Base exception for all Kairo SDK errors."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code

    def __repr__(self) -> str:
        if self.status_code is not None:
            return f"{self.__class__.__name__}(message={self.message!r}, status_code={self.status_code})"
        return f"{self.__class__.__name__}(message={self.message!r})"


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


class KairoConflictError(KairoError):
    """The request conflicts with current state on the server.

    Corresponds to HTTP 409.
    """


class KairoRateLimitError(KairoError):
    """The API rate limit has been exceeded.

    Corresponds to HTTP 429.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = 429,
        retry_after: Optional[int] = None,
    ) -> None:
        super().__init__(message, status_code=status_code)
        self.retry_after = retry_after

    def __repr__(self) -> str:
        return (
            f"KairoRateLimitError("
            f"message={self.message!r}, "
            f"status_code={self.status_code}, "
            f"retry_after={self.retry_after})"
        )


class KairoServerError(KairoError):
    """The Kairo server encountered an unexpected error.

    Corresponds to HTTP 5xx.
    """


class KairoConnectionError(KairoError):
    """A network or connection error prevented reaching the Kairo API."""
