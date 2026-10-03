"""
Kairo Python SDK — main client.
"""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx

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
from .memories import MemoryResource

_DEFAULT_BASE_URL = "http://localhost:5171"
_DEFAULT_TIMEOUT = 30.0


class Kairo:
    """Official Kairo Python SDK client.

    Initialise with an API key obtained from the Kairo developer portal::

        from kairo import Kairo

        client = Kairo(api_key="kairo_live_xxx")

    The API key can also be read from the environment::

        # Set KAIRO_API_KEY in the environment, then:
        client = Kairo()

    Override the API base URL when connecting to a self-hosted or
    staging instance::

        client = Kairo(
            api_key="kairo_live_xxx",
            base_url="https://api.kairo.ai",
        )

    The client is a context manager and should be closed when no longer
    needed, or used with ``with``::

        with Kairo(api_key="kairo_live_xxx") as client:
            memories = client.memories.list()

    :param api_key: Kairo API key. Takes precedence over
        ``KAIRO_API_KEY`` environment variable.
    :param base_url: Override the default API base URL. Falls back to
        the ``KAIRO_BASE_URL`` environment variable, then
        ``http://localhost:5171``.
    :param timeout: HTTP request timeout in seconds. Defaults to 30.

    :raises KairoAuthenticationError: If no API key is available.
    """

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        resolved_key = (api_key or os.environ.get("KAIRO_API_KEY", "")).strip()

        if not resolved_key:
            raise KairoAuthenticationError(
                "No API key provided. "
                "Pass api_key= to Kairo() or set the KAIRO_API_KEY "
                "environment variable."
            )

        # Store only — never expose through repr or exceptions.
        self._api_key = resolved_key

        raw_base = (
            base_url
            or os.environ.get("KAIRO_BASE_URL", "")
            or _DEFAULT_BASE_URL
        )
        # Normalise trailing slash so URL joins are always clean.
        self._base_url = raw_base.rstrip("/")

        self._timeout = timeout

        self._http = httpx.Client(
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

        #: Memory operations resource. See :class:`~kairo.memories.MemoryResource`.
        self.memories = MemoryResource(self)

    # ── Internal HTTP transport ────────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
    ) -> Any:
        """Execute an authenticated HTTP request and return the parsed JSON body.

        This is an internal method used by resource classes.
        Callers should use the resource methods instead (e.g.
        ``client.memories.create(...)``).

        :raises KairoAuthenticationError: HTTP 401
        :raises KairoAuthorizationError: HTTP 403
        :raises KairoNotFoundError: HTTP 404
        :raises KairoValidationError: HTTP 400
        :raises KairoRateLimitError: HTTP 429
        :raises KairoServerError: HTTP 5xx
        :raises KairoConnectionError: Network or transport failure
        :raises KairoError: Unexpected HTTP status
        """
        url = f"{self._base_url}/{path.lstrip('/')}"

        try:
            response = self._http.request(
                method,
                url,
                json=json,
                params=params,
            )
        except httpx.TimeoutException as exc:
            raise KairoConnectionError(
                f"Request to Kairo API timed out after {self._timeout}s."
            ) from exc
        except httpx.NetworkError as exc:
            raise KairoConnectionError(
                f"Network error contacting the Kairo API: {exc}"
            ) from exc
        except httpx.HTTPError as exc:
            raise KairoConnectionError(
                f"HTTP transport error: {exc}"
            ) from exc

        return _handle_response(response)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def close(self) -> None:
        """Close the underlying HTTP connection pool.

        Call this when the client is no longer needed, or use the
        client as a context manager instead.
        """
        self._http.close()

    def __enter__(self) -> Kairo:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def __repr__(self) -> str:
        # Never expose the raw API key.
        return f"Kairo(base_url={self._base_url!r})"


# ── Response handling (module-level, no state) ─────────────────────────────────

def _handle_response(response: httpx.Response) -> Any:
    """Map an httpx response to a parsed JSON body or a typed Kairo exception."""
    status = response.status_code

    if status in (200, 201):
        try:
            return response.json()
        except Exception:
            # Non-JSON success body — return None so callers handle gracefully.
            return None

    message = _extract_error_message(response)

    if status == 400:
        raise KairoValidationError(message or "Invalid request.", status_code=400)
    if status == 401:
        raise KairoAuthenticationError(
            message or "Authentication failed. Check your Kairo API key.",
            status_code=401,
        )
    if status == 403:
        raise KairoAuthorizationError(
            message or "You do not have permission to perform this action.",
            status_code=403,
        )
    if status == 404:
        raise KairoNotFoundError(
            message or "The requested resource was not found.",
            status_code=404,
        )
    if status == 409:
        raise KairoConflictError(
            message or "The request conflicts with current server state.",
            status_code=409,
        )
    if status == 429:
        retry_after: Optional[int] = None
        raw_retry = response.headers.get("retry-after") or response.headers.get("Retry-After")
        if raw_retry and raw_retry.strip().isdigit():
            retry_after = int(raw_retry.strip())
        raise KairoRateLimitError(
            message or "Rate limit exceeded. Please reduce your request rate.",
            status_code=429,
            retry_after=retry_after,
        )
    if status >= 500:
        raise KairoServerError(
            message or f"The Kairo server encountered an error (HTTP {status}).",
            status_code=status,
        )

    raise KairoError(
        f"Unexpected HTTP {status} from Kairo API. {message or ''}".strip(),
        status_code=status,
    )


def _extract_error_message(response: httpx.Response) -> Optional[str]:
    """Safely extract the ``message`` field from a JSON error response body."""
    try:
        data = response.json()
        if isinstance(data, dict):
            return data.get("message")
    except Exception:
        pass

    text = response.text
    # Truncate to avoid polluting exception messages with large HTML pages.
    return text[:300].strip() if text else None


# Backwards-compatible alias for canonical naming parity
KairoClient = Kairo
