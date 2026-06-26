"""Middleware for memory mechanism."""

import logging
import re
from typing import TYPE_CHECKING, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.runtime import Runtime

from kkoclaw.agents.middlewares.internal_messages import internal_human_message
from kkoclaw.agents.memory.message_processing import detect_correction, detect_reinforcement, filter_messages_for_memory
from kkoclaw.agents.memory.prompt import build_memory_injection_view, format_memory_for_injection
from kkoclaw.agents.memory.queue import get_memory_queue
from kkoclaw.agents.memory.retrieval import (
    extract_current_context,
    filter_memory_facts_for_scope,
    get_retrieval_stats,
    rank_memory_facts,
    record_retrieval_injection_stats,
)
from kkoclaw.agents.memory.scope import resolve_active_scope
from kkoclaw.agents.memory.updater import get_memory_data
from kkoclaw.config.memory_config import get_memory_config
from kkoclaw.runtime.user_context import resolve_runtime_user_id

if TYPE_CHECKING:
    from kkoclaw.config.memory_config import MemoryConfig

logger = logging.getLogger(__name__)


class MemoryMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    pass


class MemoryMiddleware(AgentMiddleware[MemoryMiddlewareState]):
    """Middleware that queues conversation for memory update after agent execution.

    This middleware:
    1. After each agent execution, queues the conversation for memory update
    2. Only includes user inputs and final assistant responses (ignores tool calls)
    3. The queue uses debouncing to batch multiple updates together
    4. Memory is updated asynchronously via LLM summarization
    """

    state_schema = MemoryMiddlewareState

    def __init__(self, agent_name: str | None = None, *, memory_config: "MemoryConfig | None" = None):
        """Initialize the MemoryMiddleware.

        Args:
            agent_name: If provided, memory is stored per-agent. If None, uses global memory.
            memory_config: Explicit memory config. When omitted, legacy global
                config fallback is used.
        """
        super().__init__()
        self._agent_name = agent_name
        self._memory_config = memory_config

    @staticmethod
    def _count_injected_fact_lines(memory_content: str) -> int:
        """Count rendered fact rows from the formatted memory content."""
        if not memory_content.strip():
            return 0

        in_facts_section = False
        count = 0
        for raw_line in memory_content.splitlines():
            line = raw_line.strip()
            if line == "Facts:":
                in_facts_section = True
                continue
            if not in_facts_section:
                continue
            if not line:
                continue
            if re.match(r"^[A-Za-z][A-Za-z ]*:$", line):
                break
            if line.startswith("- ["):
                count += 1
        return count

    def _build_retrieval_injection(
        self,
        messages: list,
        config: "MemoryConfig",
        runtime_context: dict | None = None,
        user_id: str | None = None,
    ) -> dict | None:
        retrieval_config = getattr(config, "retrieval", None)
        if not (config.enabled and config.injection_enabled and retrieval_config and retrieval_config.enabled):
            return None

        stats_before = get_retrieval_stats()
        current_context = extract_current_context(
            messages,
            max_turns=retrieval_config.context_max_turns,
            max_chars=retrieval_config.context_max_chars,
        )
        memory_data = get_memory_data(self._agent_name, user_id=user_id)
        active_scope = self._resolve_active_scope(runtime_context)
        scoped_memory = build_memory_injection_view(
            memory_data,
            active_scope=active_scope,
            include_legacy_unscoped_facts=active_scope is None,
        )
        scoped_facts = scoped_memory.get("facts", [])
        ranked_facts = rank_memory_facts(
            scoped_facts,
            current_context=current_context,
            similarity_weight=retrieval_config.similarity_weight,
            confidence_weight=retrieval_config.confidence_weight,
            min_similarity=retrieval_config.min_similarity,
        )
        memory_content = format_memory_for_injection(
            {"facts": scoped_facts},
            max_tokens=config.max_injection_tokens,
            ranked_facts=ranked_facts,
        )
        injected_facts_count = self._count_injected_fact_lines(memory_content)
        record_retrieval_injection_stats(
            budget=config.max_injection_tokens,
            injected_facts_count=injected_facts_count,
        )
        stats_after = get_retrieval_stats()
        cache_event = "hit"
        if stats_after["cache_misses"] > stats_before["cache_misses"]:
            cache_event = "miss"
        elif stats_after["cache_hits"] == stats_before["cache_hits"]:
            cache_event = "n/a"
        fallback_used = stats_after["fallback_confidence_only_calls"] > stats_before["fallback_confidence_only_calls"]
        logger.debug(
            "memory.retrieval ranked facts=%s context_chars=%s query_tokens=%s cache=%s fallback=%s injected=%s budget=%s top_scores=%s",
            stats_after["last_facts_count"],
            stats_after["last_context_chars"],
            stats_after["last_query_tokens"],
            cache_event,
            fallback_used,
            stats_after["last_injected_facts_count"],
            stats_after["last_injection_tokens_budget"],
            stats_after["last_top_scores"],
        )
        if not memory_content.strip():
            return None

        reminder = internal_human_message(
            name="memory_context",
            marker="memory_context",
            content=f"<memory>\n{memory_content}\n</memory>",
        )
        return {"messages": [reminder]}

    @staticmethod
    def _resolve_active_scope(runtime_context: dict | None = None) -> dict | None:
        return resolve_active_scope(runtime_context)

    @override
    def before_agent(self, state: MemoryMiddlewareState, runtime: Runtime) -> dict | None:
        """Inject context-aware memory facts before each agent execution."""
        config = self._memory_config or get_memory_config()
        messages = list(state.get("messages", []))
        if not messages:
            return None

        try:
            return self._build_retrieval_injection(
                messages,
                config,
                runtime.context if runtime.context else None,
                user_id=resolve_runtime_user_id(runtime),
            )
        except Exception:
            logger.exception("Failed to inject context-aware memory facts")
            return None

    @override
    async def abefore_agent(self, state: MemoryMiddlewareState, runtime: Runtime) -> dict | None:
        """Async version of before_agent."""
        return self.before_agent(state, runtime)

    @override
    def after_agent(self, state: MemoryMiddlewareState, runtime: Runtime) -> dict | None:
        """Queue conversation for memory update after agent completes.

        Args:
            state: The current agent state.
            runtime: The runtime context.

        Returns:
            None (no state changes needed from this middleware).
        """
        config = self._memory_config or get_memory_config()
        if not config.enabled:
            return None

        # Get thread ID from runtime context first, then fall back to LangGraph's configurable metadata
        thread_id = runtime.context.get("thread_id") if runtime.context else None
        if thread_id is None:
            config_data = get_config()
            thread_id = config_data.get("configurable", {}).get("thread_id")
        if not thread_id:
            logger.debug("No thread_id in context, skipping memory update")
            return None

        # Get messages from state
        messages = state.get("messages", [])
        if not messages:
            logger.debug("No messages in state, skipping memory update")
            return None

        # Filter to only keep user inputs and final assistant responses
        filtered_messages = filter_messages_for_memory(messages)

        # Only queue if there's meaningful conversation
        # At minimum need one user message and one assistant response
        user_messages = [m for m in filtered_messages if getattr(m, "type", None) == "human"]
        assistant_messages = [m for m in filtered_messages if getattr(m, "type", None) == "ai"]

        if not user_messages or not assistant_messages:
            return None

        # Queue the filtered conversation for memory update
        correction_detected = detect_correction(filtered_messages)
        reinforcement_detected = not correction_detected and detect_reinforcement(filtered_messages)
        # Capture user_id at enqueue time while the request context is still alive.
        # threading.Timer fires on a different thread where ContextVar values are not
        # propagated, so we must store user_id explicitly in ConversationContext.
        user_id = resolve_runtime_user_id(runtime)
        active_scope = self._resolve_active_scope(runtime.context if runtime.context else None)
        queue = get_memory_queue()
        queue.add(
            thread_id=thread_id,
            messages=filtered_messages,
            agent_name=self._agent_name,
            user_id=user_id,
            active_scope=active_scope,
            correction_detected=correction_detected,
            reinforcement_detected=reinforcement_detected,
        )

        return None
