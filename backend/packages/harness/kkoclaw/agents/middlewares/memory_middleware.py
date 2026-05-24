"""Middleware for memory mechanism."""

import logging
from typing import TYPE_CHECKING, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.config import get_config
from langgraph.runtime import Runtime

from kkoclaw.agents.memory.message_processing import detect_correction, detect_reinforcement, filter_messages_for_memory
from kkoclaw.agents.memory.prompt import format_memory_for_injection
from kkoclaw.agents.memory.queue import get_memory_queue
from kkoclaw.agents.memory.retrieval import extract_current_context, rank_memory_facts
from kkoclaw.agents.memory.updater import get_memory_data
from kkoclaw.config.memory_config import get_memory_config
from kkoclaw.runtime.user_context import get_effective_user_id

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

    def _build_retrieval_injection(self, messages: list, config: "MemoryConfig") -> dict | None:
        retrieval_config = getattr(config, "retrieval", None)
        if not (config.enabled and config.injection_enabled and retrieval_config and retrieval_config.enabled):
            return None

        current_context = extract_current_context(
            messages,
            max_turns=retrieval_config.context_max_turns,
            max_chars=retrieval_config.context_max_chars,
        )
        memory_data = get_memory_data(self._agent_name, user_id=get_effective_user_id())
        ranked_facts = rank_memory_facts(
            memory_data.get("facts", []),
            current_context=current_context,
            similarity_weight=retrieval_config.similarity_weight,
            confidence_weight=retrieval_config.confidence_weight,
            min_similarity=retrieval_config.min_similarity,
        )
        memory_content = format_memory_for_injection(
            {"facts": memory_data.get("facts", [])},
            max_tokens=config.max_injection_tokens,
            ranked_facts=ranked_facts,
        )
        if not memory_content.strip():
            return None

        reminder = HumanMessage(
            name="memory_context",
            content=f"<memory>\n{memory_content}\n</memory>",
            additional_kwargs={"hide_from_ui": True},
        )
        return {"messages": [reminder]}

    @override
    def before_agent(self, state: MemoryMiddlewareState, runtime: Runtime) -> dict | None:
        """Inject context-aware memory facts before each agent execution."""
        config = self._memory_config or get_memory_config()
        messages = list(state.get("messages", []))
        if not messages:
            return None

        try:
            return self._build_retrieval_injection(messages, config)
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
        user_id = get_effective_user_id()
        queue = get_memory_queue()
        queue.add(
            thread_id=thread_id,
            messages=filtered_messages,
            agent_name=self._agent_name,
            user_id=user_id,
            correction_detected=correction_detected,
            reinforcement_detected=reinforcement_detected,
        )

        return None
