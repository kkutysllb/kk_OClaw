"""Detector-only volatility scan for prompt-cache prefixes.

Ported from Kun's ``prefix-volatility.ts``. Scans system prompts and
few-shot examples for tokens that change between runs (UUIDs, ISO 8601
timestamps, hex hashes, JWTs) which cause prompt-cache misses.

This module is **diagnostic only** — it does not modify any state. Use
it during development to identify cache-busting tokens in your prompts.

Intentionally no regex: UUIDs, hashes, and JWTs have overlapping shapes.
Structured token parsing keeps false positives easy to debug.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

VolatilityKind = Literal["uuid", "iso8601", "hex_hash", "jwt"]

_HASH_LENGTHS = frozenset({32, 40, 64})
_UUID_SEGMENT_LENGTHS = (8, 4, 4, 4, 12)
_BOUNDARY_PUNCTUATION = ".,;:!?()[]{}<>'\"`"


@dataclass(frozen=True)
class VolatilityFinding:
    """A single volatile token found in prefix content."""

    field: str
    kind: VolatilityKind
    token: str
    item_id: str | None = None


def detect_volatile_tokens_in_text(
    content: str,
    *,
    field: str = "systemPrompt",
    item_id: str | None = None,
) -> list[VolatilityFinding]:
    """Scan *content* for volatile tokens (UUIDs, dates, hashes, JWTs).

    Args:
        content: The text to scan.
        field: Source field name for findings (e.g. ``"systemPrompt"``, ``"fewShots"``).
        item_id: Optional identifier for the specific item (used for few-shots).

    Returns:
        List of :class:`VolatilityFinding` for each volatile token found.
    """
    findings: list[VolatilityFinding] = []
    for raw_token in _split_tokens(content):
        token = _strip_boundary_punctuation(raw_token)
        if not token:
            continue
        kind = _volatile_token_kind(token)
        if kind is not None:
            findings.append(VolatilityFinding(field=field, kind=kind, token=token, item_id=item_id))
    return findings


def detect_volatile_prefix(
    *,
    system_prompt: str,
    few_shots: list[dict] | None = None,
) -> list[VolatilityFinding]:
    """Scan a full prefix (system prompt + few-shots) for volatile content.

    Args:
        system_prompt: The system prompt string.
        few_shots: Optional list of few-shot items, each as a dict with at
            least an ``"id"`` key and a ``"text"`` key containing the content.

    Returns:
        Combined list of :class:`VolatilityFinding`.
    """
    results = list(detect_volatile_tokens_in_text(system_prompt, field="systemPrompt"))
    if few_shots:
        for item in few_shots:
            text = item.get("text", "")
            if text:
                results.extend(
                    detect_volatile_tokens_in_text(
                        text,
                        field="fewShots",
                        item_id=item.get("id"),
                    )
                )
    return results


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _volatile_token_kind(token: str) -> VolatilityKind | None:
    if _is_canonical_uuid(token):
        return "uuid"
    if _is_iso8601(token):
        return "iso8601"
    if _is_hex_hash(token):
        return "hex_hash"
    if _is_jwt(token):
        return "jwt"
    return None


def _split_tokens(content: str) -> list[str]:
    """Split content on whitespace into tokens."""
    tokens: list[str] = []
    current: list[str] = []
    for char in content:
        if char.isspace():
            if current:
                tokens.append("".join(current))
                current = []
        else:
            current.append(char)
    if current:
        tokens.append("".join(current))
    return tokens


def _strip_boundary_punctuation(token: str) -> str:
    start = 0
    end = len(token)
    while start < end and token[start] in _BOUNDARY_PUNCTUATION:
        start += 1
    while end > start and token[end - 1] in _BOUNDARY_PUNCTUATION:
        end -= 1
    return token[start:end]


def _is_hex_string(value: str) -> bool:
    if not value:
        return False
    return all(c in "0123456789abcdefABCDEF" for c in value)


def _is_canonical_uuid(token: str) -> bool:
    if len(token) != 36:
        return False
    parts = token.split("-")
    if len(parts) != 5:
        return False
    for i, part in enumerate(parts):
        if len(part) != _UUID_SEGMENT_LENGTHS[i]:
            return False
        if not _is_hex_string(part):
            return False
    return True


def _is_iso8601(token: str) -> bool:
    if len(token) < 10:
        return False
    if len(token) <= 4 or token[4] != "-" or token[7] != "-":
        return False
    try:
        year = int(token[0:4])
        month = int(token[5:7])
        day = int(token[8:10])
    except ValueError:
        return False
    if len(token) > 10:
        separator = token[10]
        if separator not in ("T", " "):
            return False
    try:
        datetime.fromisoformat(token.replace("T", " ")[:19] if len(token) >= 19 else token[:10])
    except ValueError:
        return False
    # Validate the date is real
    try:
        datetime(year=year, month=month, day=day)
    except ValueError:
        return False
    return True


def _is_hex_hash(token: str) -> bool:
    return len(token) in _HASH_LENGTHS and _is_hex_string(token)


def _is_base64_url_string(value: str) -> bool:
    if not value:
        return False
    for char in value:
        if char not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=":
            return False
    return True


def _decode_base64url_json(value: str) -> object | None:
    try:
        padded = value + "=" * (4 - len(value) % 4)
        decoded = base64.urlsafe_b64decode(padded)
        return json.loads(decoded)
    except Exception:
        return None


def _is_json_object(value: object) -> bool:
    return isinstance(value, dict)


def _is_jwt(token: str) -> bool:
    parts = token.split(".")
    if len(parts) != 3:
        return False
    if not all(part and _is_base64_url_string(part) for part in parts):
        return False
    header = _decode_base64url_json(parts[0])
    payload = _decode_base64url_json(parts[1])
    return _is_json_object(header) and _is_json_object(payload)
