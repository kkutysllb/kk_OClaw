"""SandboxAuditMiddleware - bash command security auditing."""

import json
import logging
import re
import shlex
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import override

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command

from kkoclaw.agents.thread_state import ThreadState

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Heredoc stripping (for command-length validation)
# ---------------------------------------------------------------------------

# Matches heredoc start markers:  <<DELIM  <<-DELIM  <<'DELIM'  <<"DELIM"
# Does NOT match here-strings (<<<).
_HEREDOC_START_RE: re.Pattern[str] = re.compile(
    r'<<-?\s*'  # << or <<-
    r'(?:'
    r"'([^']+)'|"  # 'DELIM'
    r'"([^"]+)"|'  # "DELIM"
    r'(\w+)'  # DELIM (bare word)
    r')'
)


# ---------------------------------------------------------------------------
# Sensitive value masking for audit logs
# ---------------------------------------------------------------------------

# Pattern: common env var names followed by = and a quoted or unquoted secret
_SECRET_ENV_PATTERNS: list[tuple[re.Pattern[str], int]] = [
    # set_token('...'), set_token("..."), set_token(...)
    (re.compile(r"(set_token\s*\(\s*['\"]?)([0-9a-zA-Z]{8,})(['\"]?\s*\))"), 2),
    # TOKEN='...', TOKEN="...", TOKEN=...,  TUSHARE_TOKEN=..., MINIMAX_API_KEY=...
    (re.compile(r"(\b[A-Z_]*(?:TOKEN|API_KEY|SECRET|PASSWORD|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|AUTH)[A-Z_]*\s*=\s*['\"]?)([0-9a-zA-Z_\-+/=]{8,})(['\"]?)", re.IGNORECASE), 2),
    # os.getenv('...') followed by usage but the key is in a string literal
    # --token=..., --api-key=..., --secret=...
    (re.compile(r"(--(?:token|api[_-]?key|secret|password|access[_-]?key|private[_-]?key)\s*=\s*['\"]?)([0-9a-zA-Z_\-+/=]{8,})(['\"]?)", re.IGNORECASE), 2),
]


def _mask_secrets(text: str) -> str:
    """Mask sensitive values (API keys, tokens, passwords) in audit log output.

    Replaces secret substrings matched by ``_SECRET_ENV_PATTERNS`` with
    ``***masked***`` so that audit logs never persist credentials.
    """
    result = text
    for pattern, _group in _SECRET_ENV_PATTERNS:
        result = pattern.sub(r"\1***masked***\3", result)
    return result


def _strip_heredoc_bodies(command: str) -> str:
    """Replace heredoc bodies with short placeholders for length-check purposes.

    Heredoc bodies are *file data*, not executable commands.  Excluding them
    from the length check prevents false-positives when the agent writes
    large files via ``cat << 'EOF' > large_file.py``.

    Returns:
        The command string with each heredoc body replaced by a compact
        placeholder such as ``<12345 bytes of heredoc content>``.
        Here-strings (``<<<``) are left untouched — they are inherently short.
    """
    result: list[str] = []
    pos = 0

    for m in _HEREDOC_START_RE.finditer(command):
        # Copy everything before this heredoc
        result.append(command[pos:m.start()])

        delimiter: str = m.group(1) or m.group(2) or m.group(3)  # type: ignore[assignment]
        allow_tabs = "<<-" in m.group(0)

        # Body starts after the heredoc marker.  Typically the shell expects
        # a newline immediately after the marker, but we scan from m.end()
        # to be lenient.
        body_start = m.end()

        # The closing delimiter must appear on a line by itself.
        # For <<-DELIM the line may be indented with tabs.
        indent = r"\t*" if allow_tabs else ""
        close_re = re.compile(
            rf"^{indent}{re.escape(delimiter)}\s*$",
            re.MULTILINE,
        )
        close_match = close_re.search(command, body_start)

        if close_match:
            body_len = close_match.start() - body_start
            result.append(f"{m.group(0)}<{body_len} bytes of heredoc content>")
            # Preserve the closing delimiter + trailing newline
            result.append(command[close_match.start():close_match.end()])
            pos = close_match.end()
        else:
            # Unclosed heredoc — keep the original text (fail-safe)
            result.append(m.group(0))
            pos = m.end()

    result.append(command[pos:])
    return "".join(result)


# ---------------------------------------------------------------------------
# Command classification rules
# ---------------------------------------------------------------------------

# Each pattern is compiled once at import time.
_HIGH_RISK_PATTERNS: list[re.Pattern[str]] = [
    # --- original rules (retained) ---
    re.compile(r"rm\s+-[^\s]*r[^\s]*\s+(/\*?|~/?\*?|/home\b|/root\b)\s*$"),
    re.compile(r"dd\s+if="),
    re.compile(r"mkfs"),
    re.compile(r"cat\s+/etc/shadow"),
    re.compile(r">+\s*/etc/"),
    # --- pipe to sh/bash (generalised, replaces old curl|sh rule) ---
    re.compile(r"\|\s*(ba)?sh\b"),
    # --- command substitution (targeted – only dangerous executables) ---
    re.compile(r"[`$]\(?\s*(curl|wget|bash|sh|python|ruby|perl|base64)"),
    # --- base64 decode piped to execution ---
    re.compile(r"base64\s+.*-d.*\|"),
    # --- overwrite system binaries ---
    re.compile(r">+\s*(/usr/bin/|/bin/|/sbin/)"),
    # --- overwrite shell startup files ---
    re.compile(r">+\s*~/?\.(bashrc|profile|zshrc|bash_profile)"),
    # --- process environment leakage ---
    re.compile(r"/proc/[^/]+/environ"),
    # --- dynamic linker hijack (one-step escalation) ---
    re.compile(r"\b(LD_PRELOAD|LD_LIBRARY_PATH)\s*="),
    # --- bash built-in networking (bypasses tool allowlists) ---
    re.compile(r"/dev/tcp/"),
    # --- fork bomb ---
    re.compile(r"\S+\(\)\s*\{[^}]*\|\s*\S+\s*&"),  # :(){ :|:& };:
    re.compile(r"while\s+true.*&\s*done"),  # while true; do bash & done
]

_MEDIUM_RISK_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"chmod\s+777"),
    re.compile(r"pip3?\s+install"),
    re.compile(r"apt(-get)?\s+install"),
    # sudo/su: no-op under Docker root; warn so LLM is aware
    re.compile(r"\b(sudo|su)\b"),
    # PATH modification: long attack chain, warn rather than block
    re.compile(r"\bPATH\s*="),
]


def _split_compound_command(command: str) -> list[str]:
    """Split a compound command into sub-commands (quote-aware).

    Scans the raw command string so unquoted shell control operators are
    recognised even when they are not surrounded by whitespace
    (e.g. ``safe;rm -rf /`` or ``rm -rf /&&echo ok``). Operators inside
    quotes are ignored. If the command ends with an unclosed quote or a
    dangling escape, return the whole command unchanged (fail-closed —
    safer to classify the unsplit string than silently drop parts).
    """
    parts: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False
    escaping = False
    index = 0

    while index < len(command):
        char = command[index]

        if escaping:
            current.append(char)
            escaping = False
            index += 1
            continue

        if char == "\\" and not in_single_quote:
            current.append(char)
            escaping = True
            index += 1
            continue

        if char == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
            current.append(char)
            index += 1
            continue

        if char == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
            current.append(char)
            index += 1
            continue

        if not in_single_quote and not in_double_quote:
            if command.startswith("&&", index) or command.startswith("||", index):
                part = "".join(current).strip()
                if part:
                    parts.append(part)
                current = []
                index += 2
                continue
            if char == ";":
                part = "".join(current).strip()
                if part:
                    parts.append(part)
                current = []
                index += 1
                continue

        current.append(char)
        index += 1

    # Unclosed quote or dangling escape → fail-closed, return whole command
    if in_single_quote or in_double_quote or escaping:
        return [command]

    part = "".join(current).strip()
    if part:
        parts.append(part)
    return parts if parts else [command]


def _classify_single_command(command: str) -> str:
    """Classify a single (non-compound) command. Return 'block', 'warn', or 'pass'."""
    normalized = " ".join(command.split())

    for pattern in _HIGH_RISK_PATTERNS:
        if pattern.search(normalized):
            return "block"

    # Also try shlex-parsed tokens for high-risk detection
    try:
        tokens = shlex.split(command)
        joined = " ".join(tokens)
        for pattern in _HIGH_RISK_PATTERNS:
            if pattern.search(joined):
                return "block"
    except ValueError:
        # shlex.split fails on unclosed quotes — treat as suspicious
        return "block"

    for pattern in _MEDIUM_RISK_PATTERNS:
        if pattern.search(normalized):
            return "warn"

    return "pass"


def _classify_command(command: str) -> str:
    """Return 'block', 'warn', or 'pass'.

    Strategy:
    1. First scan the *whole* raw command against high-risk patterns. This
       catches structural attacks like ``while true; do bash & done`` or
       ``:(){ :|:& };:`` that span multiple shell statements — splitting them
       on ``;`` would destroy the pattern context.
    2. Then split compound commands (e.g. ``cmd1 && cmd2 ; cmd3``) and
       classify each sub-command independently. The most severe verdict wins.
    """
    # Pass 1: whole-command high-risk scan (catches multi-statement patterns)
    normalized = " ".join(command.split())
    for pattern in _HIGH_RISK_PATTERNS:
        if pattern.search(normalized):
            return "block"

    # Pass 2: per-sub-command classification
    sub_commands = _split_compound_command(command)
    worst = "pass"
    for sub in sub_commands:
        verdict = _classify_single_command(sub)
        if verdict == "block":
            return "block"  # short-circuit: can't get worse
        if verdict == "warn":
            worst = "warn"
    return worst


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class SandboxAuditMiddleware(AgentMiddleware[ThreadState]):
    """Bash command security auditing middleware.

    For every ``bash`` tool call:
    1. **Command classification**: regex + shlex analysis grades commands as
       high-risk (block), medium-risk (warn), or safe (pass).
    2. **Audit log**: every bash call is recorded as a structured JSON entry
       via the standard logger (visible in langgraph.log).

    High-risk commands (e.g. ``rm -rf /``, ``curl url | bash``) are blocked:
    the handler is not called and an error ``ToolMessage`` is returned so the
    agent loop can continue gracefully.

    Medium-risk commands (e.g. ``pip install``, ``chmod 777``) are executed
    normally; a warning is appended to the tool result so the LLM is aware.
    """

    state_schema = ThreadState

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_thread_id(self, request: ToolCallRequest) -> str | None:
        runtime = request.runtime  # ToolRuntime; may be None-like in tests
        if runtime is None:
            return None
        ctx = getattr(runtime, "context", None) or {}
        thread_id = ctx.get("thread_id") if isinstance(ctx, dict) else None
        if thread_id is None:
            cfg = getattr(runtime, "config", None) or {}
            thread_id = cfg.get("configurable", {}).get("thread_id")
        return thread_id

    _AUDIT_COMMAND_LIMIT = 200

    def _write_audit(self, thread_id: str | None, command: str, verdict: str, *, truncate: bool = False) -> None:
        audited_command = command
        if truncate and len(command) > self._AUDIT_COMMAND_LIMIT:
            audited_command = f"{command[: self._AUDIT_COMMAND_LIMIT]}... ({len(command)} chars)"
        # Mask sensitive values before writing to log
        audited_command = _mask_secrets(audited_command)
        record = {
            "timestamp": datetime.now(UTC).isoformat(),
            "thread_id": thread_id or "unknown",
            "command": audited_command,
            "verdict": verdict,
        }
        logger.info("[SandboxAudit] %s", json.dumps(record, ensure_ascii=False))

    def _build_block_message(self, request: ToolCallRequest, reason: str) -> ToolMessage:
        tool_call_id = str(request.tool_call.get("id") or "missing_id")
        return ToolMessage(
            content=f"Command blocked: {reason}. Please use a safer alternative approach.",
            tool_call_id=tool_call_id,
            name="bash",
            status="error",
        )

    # ------------------------------------------------------------------
    # Input sanitisation
    # ------------------------------------------------------------------

    # Maximum command length for input sanitisation.
    #
    # Normal bash commands rarely exceed a few hundred characters; 10 000 is
    # well above any legitimate use case yet a tiny fraction of Linux ARG_MAX.
    # Anything longer is almost certainly a payload injection or base64-encoded
    # attack string.
    #
    # Heredoc bodies (``cat << 'EOF' > file``) are excluded from the length
    # check — they contain file data, not executable commands.
    _MAX_COMMAND_LENGTH = 10_000

    def _validate_input(self, command: str) -> str | None:
        """Return ``None`` if *command* is acceptable, else a rejection reason."""
        if not command.strip():
            return "empty command"
        # Strip heredoc bodies before checking length — heredoc content is
        # file data, not executable command payload.
        check_cmd = _strip_heredoc_bodies(command) if "<<" in command else command
        if len(check_cmd) > self._MAX_COMMAND_LENGTH:
            return "command too long"
        if "\x00" in command:
            return "null byte detected"
        return None

    # ------------------------------------------------------------------
    # Core logic (shared between sync and async paths)
    # ------------------------------------------------------------------

    def _pre_process(self, request: ToolCallRequest) -> tuple[str, str | None, str, str | None]:
        """
        Returns (command, thread_id, verdict, reject_reason).
        verdict is 'block', 'warn', or 'pass'.
        reject_reason is non-None only for input sanitisation rejections.
        """
        args = request.tool_call.get("args", {})
        raw_command = args.get("command")
        command = raw_command if isinstance(raw_command, str) else ""
        thread_id = self._get_thread_id(request)

        # ① input sanitisation — reject malformed input before regex analysis
        reject_reason = self._validate_input(command)
        if reject_reason:
            # For audit, strip heredoc bodies so the log stays compact even
            # for oversized heredoc commands.
            audit_cmd = _strip_heredoc_bodies(command) if "<<" in command else command
            self._write_audit(thread_id, audit_cmd, "block", truncate=True)
            logger.warning("[SandboxAudit] INVALID INPUT thread=%s reason=%s", thread_id, reject_reason)
            return command, thread_id, "block", reject_reason

        # ② classify command
        verdict = _classify_command(command)

        # ③ audit log — strip heredoc bodies for readability
        audit_cmd = _strip_heredoc_bodies(command) if "<<" in command else command
        self._write_audit(thread_id, audit_cmd, verdict)

        # Mask sensitive values in warning logs
        masked_command = _mask_secrets(command)
        if verdict == "block":
            logger.warning("[SandboxAudit] BLOCKED thread=%s cmd=%r", thread_id, masked_command)
        elif verdict == "warn":
            logger.warning("[SandboxAudit] WARN (medium-risk) thread=%s cmd=%r", thread_id, masked_command)

        return command, thread_id, verdict, None

    # ------------------------------------------------------------------
    # wrap_tool_call hooks
    # ------------------------------------------------------------------

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        if request.tool_call.get("name") != "bash":
            return handler(request)

        command, _, verdict, reject_reason = self._pre_process(request)
        if verdict == "block":
            reason = reject_reason or "security violation detected"
            return self._build_block_message(request, reason)
        # warn and pass are both executed normally; the audit log
        # already records the verdict so we do NOT pollute the
        # ToolMessage content that reaches the frontend.
        return handler(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        if request.tool_call.get("name") != "bash":
            return await handler(request)

        command, _, verdict, reject_reason = self._pre_process(request)
        if verdict == "block":
            reason = reject_reason or "security violation detected"
            return self._build_block_message(request, reason)
        # warn and pass are both executed normally; the audit log
        # already records the verdict so we do NOT pollute the
        # ToolMessage content that reaches the frontend.
        return await handler(request)
