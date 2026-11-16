"""Minimal Pexip Infinity Management API client for themes.

Implements the documented "Uploading a service theme" flow:
  1. POST /api/admin/configuration/v1/ivr_theme/  {"name": ...}  -> Location header
  2. PATCH <theme uri>  multipart file field "package" = the theme ZIP
  3. PATCH /api/admin/configuration/v1/conference/<id>/  {"ivr_theme": <theme path>}
See https://docs.pexip.com/api_manage/api_configuration.htm

Credentials come from environment variables (never commit them):
  INFINITY_MGR_HOST, INFINITY_MGR_USER, INFINITY_MGR_PASSWORD
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

CONFIG_BASE = "/api/admin/configuration/v1"


class InfinityAPIError(Exception):
    pass


@dataclass
class Connection:
    host: str
    user: str
    password: str
    verify_tls: bool = True

    @classmethod
    def from_env(cls, verify_tls: bool = True) -> "Connection":
        missing = [v for v in ("INFINITY_MGR_HOST", "INFINITY_MGR_USER", "INFINITY_MGR_PASSWORD")
                   if not os.environ.get(v)]
        if missing:
            raise InfinityAPIError(f"Set environment variables: {', '.join(missing)}")
        host = os.environ["INFINITY_MGR_HOST"].removeprefix("https://").rstrip("/")
        return cls(host, os.environ["INFINITY_MGR_USER"], os.environ["INFINITY_MGR_PASSWORD"], verify_tls)

    def url(self, path: str) -> str:
        return path if path.startswith("https://") else f"https://{self.host}{path}"


class ThemeClient:
    def __init__(self, conn: Connection, session=None) -> None:
        if session is None:
            import requests  # imported lazily so validation works without it
            session = requests.Session()
        self.conn = conn
        self.s = session
        self.s.auth = (conn.user, conn.password)
        self.s.verify = conn.verify_tls

    # -- helpers ---------------------------------------------------------------
    def _check(self, resp, action: str):
        if resp.status_code >= 400:
            raise InfinityAPIError(f"{action} failed: HTTP {resp.status_code} {resp.text[:500]}")
        return resp

    def _find_one(self, resource: str, **filters) -> dict | None:
        resp = self._check(self.s.get(self.conn.url(f"{CONFIG_BASE}/{resource}/"), params=filters),
                           f"Looking up {resource}")
        objects = resp.json().get("objects", [])
        if len(objects) > 1:
            raise InfinityAPIError(f"More than one {resource} matches {filters}")
        return objects[0] if objects else None

    # -- themes ----------------------------------------------------------------
    def find_theme(self, name: str) -> dict | None:
        return self._find_one("ivr_theme", name=name)

    def upload_theme(self, name: str, zip_bytes: bytes, filename: str | None = None) -> str:
        """Create the theme if needed, then upload the package. Returns the theme path."""
        existing = self.find_theme(name)
        if existing:
            theme_path = existing["resource_uri"]
        else:
            resp = self._check(self.s.post(self.conn.url(f"{CONFIG_BASE}/ivr_theme/"), json={"name": name}),
                               f"Creating theme '{name}'")
            theme_path = urlsplit(resp.headers["location"]).path
        files = {"package": (filename or f"{name}.zip", zip_bytes, "application/zip")}
        self._check(self.s.patch(self.conn.url(theme_path), files=files), f"Uploading package for '{name}'")
        return theme_path

    # -- services --------------------------------------------------------------
    def assign_theme(self, theme_path: str, service_name: str) -> str:
        """Assign a theme to a VMR / Virtual Auditorium / Virtual Reception by its name."""
        service = self._find_one("conference", name=service_name)
        if not service:
            raise InfinityAPIError(f"No service named '{service_name}'")
        self._check(self.s.patch(self.conn.url(service["resource_uri"]), json={"ivr_theme": theme_path}),
                    f"Assigning theme to '{service_name}'")
        return service["resource_uri"]
