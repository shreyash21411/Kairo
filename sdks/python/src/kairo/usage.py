"""
Kairo Usage resource.

Provides usage reporting operations against the Kairo REST API.
Access via ``client.usage``.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional, Union

from .exceptions import KairoValidationError
from .models import ProjectUsageReport

if TYPE_CHECKING:
    from .client import Kairo


class UsageResource:
    """Usage reporting resource.

    Access via ``client.usage``.
    """

    def __init__(self, client: Kairo) -> None:
        self._client = client

    def get_report(
        self,
        project_id: int,
        *,
        from_utc: Optional[Union[datetime, str]] = None,
        to_utc: Optional[Union[datetime, str]] = None,
    ) -> ProjectUsageReport:
        """Fetch aggregated usage report for a project.

        :param project_id: Target project ID.
        :param from_utc: Start of time window (ISO 8601 string or datetime).
        :param to_utc: End of time window (ISO 8601 string or datetime).
        :return: Aggregated :class:`~kairo.models.ProjectUsageReport`.
        :raises KairoValidationError: If project_id is invalid or from_utc > to_utc.
        :raises KairoAuthorizationError: If requesting user does not own the project.
        """
        if not isinstance(project_id, int) or project_id <= 0:
            raise KairoValidationError("project_id must be a positive integer.", status_code=400)

        params: dict[str, str] = {}
        if from_utc is not None:
            params["from"] = from_utc.isoformat() if isinstance(from_utc, datetime) else str(from_utc)
        if to_utc is not None:
            params["to"] = to_utc.isoformat() if isinstance(to_utc, datetime) else str(to_utc)

        data = self._client._request(
            "GET",
            f"/api/v1/projects/{project_id}/usage",
            params=params or None,
        )

        return ProjectUsageReport._from_dict(data)

    def get(
        self,
        project_id: int,
        *,
        from_utc: Optional[Union[datetime, str]] = None,
        to_utc: Optional[Union[datetime, str]] = None,
    ) -> ProjectUsageReport:
        """Alias for :meth:`get_report`."""
        return self.get_report(project_id, from_utc=from_utc, to_utc=to_utc)
