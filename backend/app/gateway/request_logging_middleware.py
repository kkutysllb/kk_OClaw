"""Diagnostic request logging middleware for desktop auth troubleshooting.

Logs method, path, key header presence indicators, status code, and latency
for auth-related and health-check requests. Designed to be **safe**: it never
reads or modifies request/response bodies, so it cannot interfere with
streaming responses, Set-Cookie headers, or body framing.

This middleware exists specifically to debug the Electron desktop login loop
where ``POST /auth/login/local`` returns 200 but the subsequent
``GET /auth/me`` returns 401. The key question is whether the desktop
renderer is sending ``X-OClaw-Desktop`` / ``Origin: app://-`` headers and
whether ``/auth/me`` carries an ``Authorization: Bearer`` header.
"""

import logging
import time
from collections.abc import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

logger = logging.getLogger("app.gateway.request_log")

# Request paths that are critical for auth-flow debugging.
_AUTH_PATH_PREFIX = "/api/v1/auth/"

# Also log any /api/ request that returns 401, regardless of path —
# useful for diagnosing desktop token injection failures on endpoints
# like /api/models or /api/threads/search.
_API_PATH_PREFIX = "/api/"

# Headers whose presence/absence matters for the desktop login flow.
# Values are partially masked so no secrets leak into log files.
_DIAG_HEADERS = (
    "origin",
    "x-oclaw-desktop",
    "authorization",
    "cookie",
    "access-control-request-method",
    "access-control-request-headers",
    "referer",
)


def _summarize_headers(headers) -> str:
    """Return a compact summary of diagnostic header presence/values."""
    lower = {k.lower(): v for k, v in headers.items()}
    parts: list[str] = []
    for name in _DIAG_HEADERS:
        raw = lower.get(name)
        if raw is None:
            parts.append(f"{name}=MISSING")
        elif name in ("authorization", "cookie"):
            # Never log raw credential values — only presence + length.
            parts.append(f"{name}=PRESENT(len={len(raw)})")
        else:
            parts.append(f"{name}={raw}")
    return " ".join(parts)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Lightweight per-request diagnostic logger for auth endpoints.

    Registered as the outermost middleware so it sees every request,
    including CORS preflight (OPTIONS) probes that upstream middleware
    may short-circuit.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        is_auth = path.startswith(_AUTH_PATH_PREFIX)
        is_health = path.startswith("/health")
        is_api = path.startswith(_API_PATH_PREFIX)

        # Only log auth endpoints, health checks, and API requests to
        # avoid noise from static assets.
        if not is_auth and not is_health and not is_api:
            return await call_next(request)

        method = request.method
        hdr_summary = _summarize_headers(request.headers)
        start = time.perf_counter()

        try:
            response: Response = await call_next(request)
        except Exception:
            elapsed = (time.perf_counter() - start) * 1000
            logger.warning(
                "[DIAG] %s %s -> EXCEPTION (%.1fms) headers[%s]",
                method, path, elapsed, hdr_summary,
                exc_info=True,
            )
            raise

        elapsed = (time.perf_counter() - start) * 1000
        # Always log auth/health; for other /api/ paths, only log on 401
        # to capture unauthorized desktop requests without flooding logs.
        if is_auth or is_health or response.status_code == 401:
            logger.info(
                "[DIAG] %s %s -> %d (%.1fms) headers[%s]",
                method, path, response.status_code, elapsed, hdr_summary,
            )
        return response
