"""Middleware to detect and break repetitive tool call loops.

P0 safety: prevents the agent from calling the same tool with the same
arguments indefinitely until the recursion limit kills the run.

Detection strategy (four layers):
  1. **Hash-based**: After each model response, hash the tool calls
     (name + args).  If the same hash appears >= warn_threshold times,
     inject a warning; if >= hard_limit, strip all tool_calls.
  2. **Frequency-based**: Track per-tool-type cumulative call counts.
     Catches cross-file read loops that hash-based detection misses.
  3. **Error-based convergence**: Scan recent tool results for
     persistent *unrecoverable* error patterns.  When the agent keeps
     hitting the same unfixable error, trigger forced stop earlier
     than the frequency-based limit would.
  4. **Storm Breaker** (same-turn): Before executing a tool call,
     check if the same tool+args was already called in this turn.
     If the count exceeds the threshold, suppress the duplicate and
     return an explanatory ToolMessage instead of executing the tool.
"""

import hashlib
import json
import logging
import re
import threading
from collections import OrderedDict, defaultdict
from collections.abc import Awaitable, Callable
from copy import deepcopy
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

from kkoclaw.agents.middlewares.tool_storm_breaker import ToolStormBreaker

logger = logging.getLogger(__name__)

# Defaults — can be overridden via constructor
_DEFAULT_WARN_THRESHOLD = 3  # inject warning after 3 identical calls
_DEFAULT_HARD_LIMIT = 5  # force-stop after 5 identical calls
_DEFAULT_WINDOW_SIZE = 20  # track last N tool calls
_DEFAULT_MAX_TRACKED_THREADS = 100  # LRU eviction limit
_DEFAULT_TOOL_FREQ_WARN = 80  # warn after 80 calls to the same tool type
_DEFAULT_TOOL_FREQ_HARD_LIMIT = 150  # force-stop after 150 calls to the same tool type

# Layer 3: error-based early convergence defaults
_DEFAULT_ERROR_ROUND_THRESHOLD = 8  # force-stop after N error rounds
_DEFAULT_ERROR_ROUND_WINDOW = 15  # look back N rounds for error patterns

# Layer 4: Storm Breaker defaults (same-turn duplicate suppression)
_DEFAULT_STORM_BREAKER_ENABLED = True
_DEFAULT_STORM_BREAKER_THRESHOLD = 2
_DEFAULT_STORM_BREAKER_WINDOW = 8

# Patterns that indicate a tool error cannot be recovered by retrying
# (mirrored from tool_error_handling_middleware for Layer 3 detection)
_UNRECOVERABLE_ERROR_PATTERNS: list[re.Pattern] = [
    re.compile(r"Custom skill '.+' already exists"),
    re.compile(r"Unexpected key.*in SKILL\.md frontmatter"),
    re.compile(r"Access denied.*outside allowed"),
    re.compile(r"Security scan rejected"),
    re.compile(r"Security scan blocked"),
    re.compile(r"Supporting files must live under one of"),
    re.compile(r"Supporting file path must"),
]


def _normalize_tool_call_args(raw_args: object) -> tuple[dict, str | None]:
    """Normalize tool call args to a dict plus an optional fallback key.

    Some providers serialize ``args`` as a JSON string instead of a dict.
    We defensively parse those cases so loop detection does not crash while
    still preserving a stable fallback key for non-dict payloads.
    """
    if isinstance(raw_args, dict):
        return raw_args, None

    if isinstance(raw_args, str):
        try:
            parsed = json.loads(raw_args)
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}, raw_args

        if isinstance(parsed, dict):
            return parsed, None
        return {}, json.dumps(parsed, sort_keys=True, default=str)

    if raw_args is None:
        return {}, None

    return {}, json.dumps(raw_args, sort_keys=True, default=str)


def _stable_tool_key(name: str, args: dict, fallback_key: str | None) -> str:
    """Derive a stable key from salient args without overfitting to noise."""
    if name == "read_file" and fallback_key is None:
        path = args.get("path") or ""
        start_line = args.get("start_line")
        end_line = args.get("end_line")

        bucket_size = 200
        try:
            start_line = int(start_line) if start_line is not None else 1
        except (TypeError, ValueError):
            start_line = 1
        try:
            end_line = int(end_line) if end_line is not None else start_line
        except (TypeError, ValueError):
            end_line = start_line

        start_line, end_line = sorted((start_line, end_line))
        bucket_start = max(start_line, 1)
        bucket_end = max(end_line, 1)
        bucket_start = (bucket_start - 1) // bucket_size
        bucket_end = (bucket_end - 1) // bucket_size
        return f"{path}:{bucket_start}-{bucket_end}"

    # write_file / str_replace are content-sensitive: same path may be updated
    # with different payloads during iteration. Using only salient fields (path)
    # can collapse distinct calls, so we hash full args to reduce false positives.
    if name in {"write_file", "str_replace"}:
        if fallback_key is not None:
            return fallback_key
        return json.dumps(args, sort_keys=True, default=str)

    salient_fields = ("path", "url", "query", "command", "pattern", "glob", "cmd")
    stable_args = {field: args[field] for field in salient_fields if args.get(field) is not None}
    if stable_args:
        return json.dumps(stable_args, sort_keys=True, default=str)

    if fallback_key is not None:
        return fallback_key

    return json.dumps(args, sort_keys=True, default=str)


def _hash_tool_calls(tool_calls: list[dict]) -> str:
    """Deterministic hash of a set of tool calls (name + stable key).

    This is intended to be order-independent: the same multiset of tool calls
    should always produce the same hash, regardless of their input order.
    """
    # Normalize each tool call to a stable (name, key) structure.
    normalized: list[str] = []
    for tc in tool_calls:
        name = tc.get("name", "")
        args, fallback_key = _normalize_tool_call_args(tc.get("args", {}))
        key = _stable_tool_key(name, args, fallback_key)

        normalized.append(f"{name}:{key}")

    # Sort so permutations of the same multiset of calls yield the same ordering.
    normalized.sort()
    blob = json.dumps(normalized, sort_keys=True, default=str)
    return hashlib.md5(blob.encode()).hexdigest()[:12]


_WARNING_MSG = "[LOOP DETECTED] You are repeating the same tool calls. Stop calling tools and produce your final answer now. If you cannot complete the task, summarize what you accomplished so far."

_TOOL_FREQ_WARNING_MSG = (
    "[LOOP DETECTED] You have called {tool_name} {count} times without producing a final answer. Stop calling tools and produce your final answer now. If you cannot complete the task, summarize what you accomplished so far."
)

_HARD_STOP_MSG = "[FORCED STOP] Repeated tool calls exceeded the safety limit. Producing final answer with results collected so far."

_TOOL_FREQ_HARD_STOP_MSG = "[FORCED STOP] Tool {tool_name} called {count} times — exceeded the per-tool safety limit. Producing final answer with results collected so far."

_ERROR_CONVERGENCE_HARD_STOP_MSG = "[FORCED STOP] Persistent unrecoverable errors detected ({count} error rounds in the last {window} rounds). This approach cannot succeed — produce a final summary now."


class LoopDetectionMiddleware(AgentMiddleware[AgentState]):
    """Detects and breaks repetitive tool call loops.

    Four detection layers (checked in order):

    1. **Hash-based**: identical tool call sets.
    2. **Frequency-based**: same tool type called too many times.
    3. **Error-based convergence**: persistent unrecoverable
       tool errors in recent rounds → early forced stop.
    4. **Storm Breaker** (Layer 4): same-turn identical tool call
       suppression via :class:`ToolStormBreaker`.

    Args:
        warn_threshold: Number of identical tool call sets before injecting
            a warning message. Default: 3.
        hard_limit: Number of identical tool call sets before stripping
            tool_calls entirely. Default: 5.
        window_size: Size of the sliding window for tracking calls.
            Default: 20.
        max_tracked_threads: Maximum number of threads to track before
            evicting the least recently used. Default: 100.
        tool_freq_warn: Number of calls to the same tool *type* (regardless
            of arguments) before injecting a frequency warning. Catches
            cross-file read loops that hash-based detection misses.
            Default: 80.
        tool_freq_hard_limit: Number of calls to the same tool type before
            forcing a stop. Default: 150.
        error_round_threshold: Number of error rounds with unrecoverable
            patterns before triggering early forced stop via Layer 3.
            Default: 8.
        error_round_window: Number of recent tool result rounds to scan
            for persistent error patterns. Default: 15.
        storm_breaker_enabled: Enable Layer 4 (same-turn duplicate
            suppression). Default: True.
        storm_breaker_threshold: Identical calls before suppression.
            Default: 2.
        storm_breaker_window: Sliding window for Storm Breaker.
            Default: 8.
    """

    def __init__(
        self,
        warn_threshold: int = _DEFAULT_WARN_THRESHOLD,
        hard_limit: int = _DEFAULT_HARD_LIMIT,
        window_size: int = _DEFAULT_WINDOW_SIZE,
        max_tracked_threads: int = _DEFAULT_MAX_TRACKED_THREADS,
        tool_freq_warn: int = _DEFAULT_TOOL_FREQ_WARN,
        tool_freq_hard_limit: int = _DEFAULT_TOOL_FREQ_HARD_LIMIT,
        error_round_threshold: int = _DEFAULT_ERROR_ROUND_THRESHOLD,
        error_round_window: int = _DEFAULT_ERROR_ROUND_WINDOW,
        storm_breaker_enabled: bool = _DEFAULT_STORM_BREAKER_ENABLED,
        storm_breaker_threshold: int = _DEFAULT_STORM_BREAKER_THRESHOLD,
        storm_breaker_window: int = _DEFAULT_STORM_BREAKER_WINDOW,
    ):
        super().__init__()
        self.warn_threshold = warn_threshold
        self.hard_limit = hard_limit
        self.window_size = window_size
        self.max_tracked_threads = max_tracked_threads
        self.tool_freq_warn = tool_freq_warn
        self.tool_freq_hard_limit = tool_freq_hard_limit
        self.error_round_threshold = error_round_threshold
        self.error_round_window = error_round_window
        self.storm_breaker_enabled = storm_breaker_enabled
        self._lock = threading.Lock()
        # Layer 4: Storm Breaker (per-thread, turn-scoped)
        self._storm_breakers: dict[str, ToolStormBreaker] = {}
        self._storm_breaker_config = {
            "threshold": max(2, storm_breaker_threshold),
            "window_size": max(1, storm_breaker_window),
        }
        # Per-thread tracking using OrderedDict for LRU eviction
        self._history: OrderedDict[str, list[str]] = OrderedDict()
        self._warned: dict[str, set[str]] = defaultdict(set)
        # Per-thread, per-tool-type cumulative call counts
        self._tool_freq: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self._tool_freq_warned: dict[str, set[str]] = defaultdict(set)
        # Per-thread error convergence tracking (Layer 3)
        self._error_rounds: dict[str, int] = defaultdict(int)

    def _get_thread_id(self, runtime: Runtime) -> str:
        """Extract thread_id from runtime context for per-thread tracking."""
        thread_id = runtime.context.get("thread_id") if runtime.context else None
        if thread_id:
            return thread_id
        return "default"

    def _evict_if_needed(self) -> None:
        """Evict least recently used threads if over the limit.

        Must be called while holding self._lock.
        """
        while len(self._history) > self.max_tracked_threads:
            evicted_id, _ = self._history.popitem(last=False)
            self._warned.pop(evicted_id, None)
            self._tool_freq.pop(evicted_id, None)
            self._tool_freq_warned.pop(evicted_id, None)
            self._error_rounds.pop(evicted_id, None)
            self._storm_breakers.pop(evicted_id, None)
            logger.debug("Evicted loop tracking for thread %s (LRU)", evicted_id)

    def _track_and_check(self, state: AgentState, runtime: Runtime) -> tuple[str | None, bool]:
        """Track tool calls and check for loops.

        Three detection layers (checked in order):
          1. **Hash-based**: catches identical tool call sets.
          2. **Frequency-based**: catches the same *tool type* being
             called many times with varying arguments (e.g. ``read_file``
             on 40 different files).
          3. **Error-based convergence**: scans recent tool results for
             persistent unrecoverable error patterns and triggers early
             forced stop when the agent is stuck on unfixable failures.

        Returns:
            (warning_message_or_none, should_hard_stop)
        """
        messages = state.get("messages", [])
        if not messages:
            return None, False

        last_msg = messages[-1]
        if getattr(last_msg, "type", None) != "ai":
            return None, False

        tool_calls = getattr(last_msg, "tool_calls", None)
        if not tool_calls:
            return None, False

        thread_id = self._get_thread_id(runtime)
        call_hash = _hash_tool_calls(tool_calls)

        with self._lock:
            # Touch / create entry (move to end for LRU)
            if thread_id in self._history:
                self._history.move_to_end(thread_id)
            else:
                self._history[thread_id] = []
                self._evict_if_needed()

            history = self._history[thread_id]
            history.append(call_hash)
            if len(history) > self.window_size:
                history[:] = history[-self.window_size :]

            count = history.count(call_hash)
            tool_names = [tc.get("name", "?") for tc in tool_calls]

            # --- Layer 1: hash-based (identical call sets) ---
            if count >= self.hard_limit:
                logger.error(
                    "Loop hard limit reached — forcing stop",
                    extra={
                        "thread_id": thread_id,
                        "call_hash": call_hash,
                        "count": count,
                        "tools": tool_names,
                    },
                )
                return _HARD_STOP_MSG, True

            if count >= self.warn_threshold:
                warned = self._warned[thread_id]
                if call_hash not in warned:
                    warned.add(call_hash)
                    logger.warning(
                        "Repetitive tool calls detected — injecting warning",
                        extra={
                            "thread_id": thread_id,
                            "call_hash": call_hash,
                            "count": count,
                            "tools": tool_names,
                        },
                    )
                    return _WARNING_MSG, False

            # --- Layer 2: per-tool-type frequency ---
            freq = self._tool_freq[thread_id]
            for tc in tool_calls:
                name = tc.get("name", "")
                if not name:
                    continue
                freq[name] += 1
                tc_count = freq[name]

                if tc_count >= self.tool_freq_hard_limit:
                    logger.error(
                        "Tool frequency hard limit reached — forcing stop",
                        extra={
                            "thread_id": thread_id,
                            "tool_name": name,
                            "count": tc_count,
                        },
                    )
                    return _TOOL_FREQ_HARD_STOP_MSG.format(tool_name=name, count=tc_count), True

                if tc_count >= self.tool_freq_warn:
                    warned = self._tool_freq_warned[thread_id]
                    if name not in warned:
                        warned.add(name)
                        logger.warning(
                            "Tool frequency warning — too many calls to same tool type",
                            extra={
                                "thread_id": thread_id,
                                "tool_name": name,
                                "count": tc_count,
                            },
                        )
                        return _TOOL_FREQ_WARNING_MSG.format(tool_name=name, count=tc_count), False

            # --- Layer 3: error-based early convergence ---
            error_rounds = self._count_unrecoverable_error_rounds(messages)
            self._error_rounds[thread_id] = error_rounds
            if error_rounds >= self.error_round_threshold:
                logger.error(
                    "Error convergence hard stop — persistent unrecoverable errors",
                    extra={
                        "thread_id": thread_id,
                        "error_rounds": error_rounds,
                        "threshold": self.error_round_threshold,
                    },
                )
                return (
                    _ERROR_CONVERGENCE_HARD_STOP_MSG.format(
                        count=error_rounds, window=self.error_round_window
                    ),
                    True,
                )

        return None, False

    def _count_unrecoverable_error_rounds(self, messages: list) -> int:
        """Count recent tool result rounds that contain unrecoverable errors.

        Scans the last ``error_round_window`` ToolMessages in the message
        history and returns how many of them contain text matching any
        unrecoverable error pattern.

        A "round" here is one ToolMessage — each tool result that shows
        an unfixable error counts as one error round.
        """
        # Collect ToolMessages from the end, limited to window size
        tool_msgs: list = []
        for msg in reversed(messages):
            if getattr(msg, "type", None) == "tool" and getattr(msg, "status", None) == "error":
                tool_msgs.append(msg)
                if len(tool_msgs) >= self.error_round_window:
                    break

        # Count how many contain unrecoverable error patterns
        error_count = 0
        for msg in tool_msgs:
            content = getattr(msg, "content", "") or ""
            if isinstance(content, list):
                # Handle list content (rare for ToolMessage but be safe)
                content = " ".join(str(block) for block in content)
            if any(p.search(str(content)) for p in _UNRECOVERABLE_ERROR_PATTERNS):
                error_count += 1

        return error_count

    @staticmethod
    def _append_text(content: str | list | None, text: str) -> str | list:
        """Append *text* to AIMessage content, handling str, list, and None.

        When content is a list of content blocks (e.g. Anthropic thinking mode),
        we append a new ``{"type": "text", ...}`` block instead of concatenating
        a string to a list, which would raise ``TypeError``.
        """
        if content is None:
            return text
        if isinstance(content, list):
            return [*content, {"type": "text", "text": f"\n\n{text}"}]
        if isinstance(content, str):
            return content + f"\n\n{text}"
        # Fallback: coerce unexpected types to str to avoid TypeError
        return str(content) + f"\n\n{text}"

    @staticmethod
    def _build_hard_stop_update(last_msg, content: str | list, *, interrupt_info: dict | None = None) -> dict:
        """Clear tool-call metadata so forced-stop messages serialize as plain assistant text.

        Also marks the message with ``name="loop_warning"`` and
        ``additional_kwargs.hide_from_ui = True`` so the frontend
        ``isHiddenFromUIMessage`` filter hides it from the chat UI.

        When *interrupt_info* is provided (a dict with keys ``reason`` and
        ``message``), it is stored under ``additional_kwargs.task_interrupted``
        so the ``run_agent`` worker can detect it and publish a custom SSE
        event to the frontend.
        """
        update = {
            "tool_calls": [],
            "content": content,
        }

        additional_kwargs = dict(getattr(last_msg, "additional_kwargs", {}) or {})
        for key in ("tool_calls", "function_call"):
            additional_kwargs.pop(key, None)
        # Hide from frontend UI — the LLM still sees this content internally
        # but the user should not see raw middleware messages like
        # [LOOP DETECTED] or [FORCED STOP].
        additional_kwargs["hide_from_ui"] = True
        # Attach task_interrupted metadata for the worker to detect and
        # forward to the frontend as a custom SSE event.
        if interrupt_info is not None:
            additional_kwargs["task_interrupted"] = interrupt_info
        update["additional_kwargs"] = additional_kwargs
        # name="loop_warning" is checked by the frontend isHiddenFromUIMessage()
        update["name"] = "loop_warning"

        response_metadata = deepcopy(getattr(last_msg, "response_metadata", {}) or {})
        if response_metadata.get("finish_reason") == "tool_calls":
            response_metadata["finish_reason"] = "stop"
        update["response_metadata"] = response_metadata

        return update

    def _apply(self, state: AgentState, runtime: Runtime) -> dict | None:
        warning, hard_stop = self._track_and_check(state, runtime)

        if hard_stop:
            # Clear all tracking state for this thread so the model gets a
            # clean slate after the forced stop.  Without this, the hash
            # history retains the repeated patterns that triggered the first
            # hard stop, causing an immediate second hard stop on the very
            # next model response ("double kill").
            thread_id = self._get_thread_id(runtime)
            self.reset(thread_id)

            # Strip tool_calls from the last AIMessage to force text output
            messages = state.get("messages", [])
            last_msg = messages[-1]
            content = self._append_text(last_msg.content, warning or _HARD_STOP_MSG)
            # Build interrupt info for frontend notification
            interrupt_info = {
                "type": "task_interrupted",
                "reason": "tool_loop",
                "message": "由于重复调用工具超过安全限制，任务已中断。",
                "hint": '请输入"继续"完成任务或主动停止任务。',
            }
            stripped_msg = last_msg.model_copy(
                update=self._build_hard_stop_update(last_msg, content, interrupt_info=interrupt_info)
            )
            return {"messages": [stripped_msg]}

        if warning:
            # Strip tool_calls and append warning to the last AIMessage's content.
            # Previously we injected a HumanMessage, but that breaks the
            # AIMessage(tool_calls) → ToolMessage sequence required by the LLM API.
            # Instead, we strip tool_calls (like hard_stop) so the agent does NOT
            # execute the pending tools, and append the warning to the content so
            # the model sees it and produces a final answer.
            messages = state.get("messages", [])
            last_msg = messages[-1]
            content = self._append_text(last_msg.content, warning)
            stripped_msg = last_msg.model_copy(update=self._build_hard_stop_update(last_msg, content))
            return {"messages": [stripped_msg]}

        return None

    # ------------------------------------------------------------------
    # Layer 4: Storm Breaker (same-turn duplicate suppression)
    # ------------------------------------------------------------------

    def _get_storm_breaker(self, thread_id: str) -> ToolStormBreaker:
        """Get or create the Storm Breaker for *thread_id*."""
        if thread_id not in self._storm_breakers:
            self._storm_breakers[thread_id] = ToolStormBreaker(**self._storm_breaker_config)
        return self._storm_breakers[thread_id]

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        """Layer 4: Storm Breaker — suppress same-turn duplicate calls."""
        if not self.storm_breaker_enabled:
            return handler(request)

        tool_call = getattr(request, "tool_call", None)
        if tool_call is None:
            return handler(request)

        tool_name = tool_call.get("name", "") if isinstance(tool_call, dict) else getattr(tool_call, "name", "")
        tool_args = tool_call.get("args", {}) if isinstance(tool_call, dict) else getattr(tool_call, "args", {})
        tool_call_id = tool_call.get("id", "") if isinstance(tool_call, dict) else getattr(tool_call, "id", "")

        thread_id = self._get_thread_id_from_request(request)
        breaker = self._get_storm_breaker(thread_id)
        result = breaker.inspect(tool_name, tool_args)

        if result.suppress:
            logger.warning(
                "Storm Breaker suppressed duplicate tool call: %s",
                result.reason,
                extra={"thread_id": thread_id, "tool_name": tool_name},
            )
            return ToolMessage(
                content=result.reason or "Duplicate tool call suppressed by Storm Breaker.",
                tool_call_id=tool_call_id,
                name=tool_name,
                status="error",
            )

        return handler(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        """Layer 4: Storm Breaker — async version."""
        if not self.storm_breaker_enabled:
            return await handler(request)

        tool_call = getattr(request, "tool_call", None)
        if tool_call is None:
            return await handler(request)

        tool_name = tool_call.get("name", "") if isinstance(tool_call, dict) else getattr(tool_call, "name", "")
        tool_args = tool_call.get("args", {}) if isinstance(tool_call, dict) else getattr(tool_call, "args", {})
        tool_call_id = tool_call.get("id", "") if isinstance(tool_call, dict) else getattr(tool_call, "id", "")

        thread_id = self._get_thread_id_from_request(request)
        breaker = self._get_storm_breaker(thread_id)
        result = breaker.inspect(tool_name, tool_args)

        if result.suppress:
            logger.warning(
                "Storm Breaker suppressed duplicate tool call: %s",
                result.reason,
                extra={"thread_id": thread_id, "tool_name": tool_name},
            )
            return ToolMessage(
                content=result.reason or "Duplicate tool call suppressed by Storm Breaker.",
                tool_call_id=tool_call_id,
                name=tool_name,
                status="error",
            )

        return await handler(request)

    def _get_thread_id_from_request(self, request: ToolCallRequest) -> str:
        """Extract thread_id from a ToolCallRequest's runtime context."""
        runtime = getattr(request, "runtime", None)
        if runtime is None:
            return "default"
        thread_id = runtime.context.get("thread_id") if runtime.context else None
        return thread_id if thread_id else "default"

    @override
    def after_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        return self._apply(state, runtime)

    @override
    async def aafter_model(self, state: AgentState, runtime: Runtime) -> dict | None:
        return self._apply(state, runtime)

    def reset(self, thread_id: str | None = None) -> None:
        """Clear tracking state. If thread_id given, clear only that thread."""
        with self._lock:
            if thread_id:
                self._history.pop(thread_id, None)
                self._warned.pop(thread_id, None)
                self._tool_freq.pop(thread_id, None)
                self._tool_freq_warned.pop(thread_id, None)
                self._error_rounds.pop(thread_id, None)
                sb = self._storm_breakers.pop(thread_id, None)
                if sb is not None:
                    sb.reset_turn()
            else:
                self._history.clear()
                self._warned.clear()
                self._tool_freq.clear()
                self._tool_freq_warned.clear()
                self._error_rounds.clear()
                for sb in self._storm_breakers.values():
                    sb.reset_turn()
                self._storm_breakers.clear()
