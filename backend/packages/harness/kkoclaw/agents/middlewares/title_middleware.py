"""Middleware for automatic thread title generation."""

import asyncio
import logging
import re
from typing import TYPE_CHECKING, Any, NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.config import get_config
from langgraph.runtime import Runtime

from kkoclaw.config.title_config import get_title_config
from kkoclaw.models import create_chat_model

if TYPE_CHECKING:
    from kkoclaw.config.app_config import AppConfig
    from kkoclaw.config.title_config import TitleConfig

_REMINDER_KWARG_KEY = "dynamic_context_reminder"


def _is_reminder(message: object) -> bool:
    """Return True if *message* is a DynamicContextMiddleware reminder."""
    return bool(getattr(message, "additional_kwargs", {}).get(_REMINDER_KWARG_KEY))


def _is_real_user(message: object) -> bool:
    """Return True if *message* is a genuine HumanMessage (not a reminder, summary, or memory injection)."""
    name = getattr(message, "name", None)
    return (
        isinstance(message, HumanMessage)
        and not _is_reminder(message)
        and name not in ("summary", "memory_context")
        and not getattr(message, "additional_kwargs", {}).get("hide_from_ui", False)
    )


logger = logging.getLogger(__name__)


class TitleMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    title: NotRequired[str | None]


class TitleMiddleware(AgentMiddleware[TitleMiddlewareState]):
    """Automatically generate a title for the thread after the first user message."""

    state_schema = TitleMiddlewareState

    def __init__(self, *, app_config: "AppConfig | None" = None, title_config: "TitleConfig | None" = None):
        super().__init__()
        self._app_config = app_config
        self._title_config = title_config

    def _get_title_config(self):
        if self._title_config is not None:
            return self._title_config
        if self._app_config is not None:
            return self._app_config.title
        return get_title_config()

    def _normalize_content(self, content: object) -> str:
        if isinstance(content, str):
            return content

        if isinstance(content, list):
            parts = [self._normalize_content(item) for item in content]
            return "\n".join(part for part in parts if part)

        if isinstance(content, dict):
            text_value = content.get("text")
            if isinstance(text_value, str):
                return text_value

            nested_content = content.get("content")
            if nested_content is not None:
                return self._normalize_content(nested_content)

        return ""

    def _should_generate_title(self, state: TitleMiddlewareState) -> bool:
        """Check if we should generate a title for this thread."""
        config = self._get_title_config()
        if not config.enabled:
            return False

        # Check if thread already has a title in state
        if state.get("title"):
            return False

        # Check if this is the first turn (has at least one user message and one assistant response)
        messages = state.get("messages", [])
        if len(messages) < 2:
            return False

        # Count real user messages (exclude dynamic-context reminders injected by
        # DynamicContextMiddleware which are also typed as "human" but carry
        # the ``dynamic_context_reminder`` marker in additional_kwargs).
        real_user_messages = [m for m in messages if _is_real_user(m)]
        assistant_messages = [m for m in messages if m.type == "ai"]

        # Generate title after first complete exchange
        return len(real_user_messages) == 1 and len(assistant_messages) >= 1

    def _build_title_prompt(self, state: TitleMiddlewareState) -> tuple[str, str]:
        """Extract user/assistant messages and build the title prompt.

        Strips ``<uploaded_files>`` blocks from the user message so that
        the title model sees the actual question, not the injected file list.

        Returns (prompt_string, user_msg) so callers can use user_msg as fallback.
        """
        config = self._get_title_config()
        messages = state.get("messages", [])

        user_msg_content = next((m.content for m in messages if _is_real_user(m)), "")
        assistant_msg_content = next((m.content for m in messages if m.type == "ai"), "")

        user_msg = self._normalize_content(user_msg_content)
        # Strip <uploaded_files> blocks injected by UploadsMiddleware
        _uploaded_files_re = re.compile(r"<uploaded_files>.*?</uploaded_files>\n*", re.DOTALL)
        user_msg = _uploaded_files_re.sub("", user_msg).strip()
        assistant_msg = self._strip_think_tags(self._normalize_content(assistant_msg_content))

        prompt = config.prompt_template.format(
            max_words=config.max_words,
            user_msg=user_msg[:500],
            assistant_msg=assistant_msg[:500],
        )
        return prompt, user_msg

    def _strip_think_tags(self, text: str) -> str:
        """Remove <think>...</think> blocks emitted by reasoning models (e.g. minimax, DeepSeek-R1)."""
        return re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()

    def _parse_title(self, content: object) -> str:
        """Normalize model output into a clean title string."""
        config = self._get_title_config()
        title_content = self._normalize_content(content)
        title_content = self._strip_think_tags(title_content)
        title = title_content.strip().strip('"').strip("'")
        return title[: config.max_chars] if len(title) > config.max_chars else title

    def _fallback_title(self, user_msg: str) -> str:
        config = self._get_title_config()
        fallback_chars = min(config.max_chars, 50)
        if len(user_msg) > fallback_chars:
            return user_msg[:fallback_chars].rstrip() + "..."
        return user_msg if user_msg else "New Conversation"

    def _get_runnable_config(self) -> dict[str, Any]:
        """Inherit the parent RunnableConfig and add middleware tag.

        This ensures RunJournal identifies LLM calls from this middleware
        as ``middleware:title`` instead of ``lead_agent``.
        """
        try:
            parent = get_config()
        except Exception:
            parent = {}
        config = {**parent}
        config["run_name"] = "title_agent"
        config["tags"] = [*(config.get("tags") or []), "middleware:title"]
        return config

    def _generate_title_result(self, state: TitleMiddlewareState) -> dict | None:
        """Generate a title synchronously by running the async path in an event loop."""
        if not self._should_generate_title(state):
            return None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            # Already inside an async context – fall back to local title
            # to avoid "asyncio.run() cannot be called from a running event loop".
            _, user_msg = self._build_title_prompt(state)
            return {"title": self._fallback_title(user_msg)}
        return asyncio.run(self._agenerate_title_result(state))

    async def _agenerate_title_result(self, state: TitleMiddlewareState) -> dict | None:
        """Generate a title asynchronously and fall back locally on failure."""
        if not self._should_generate_title(state):
            return None

        config = self._get_title_config()
        prompt, user_msg = self._build_title_prompt(state)

        try:
            model_kwargs = {"thinking_enabled": False}
            if self._app_config is not None:
                model_kwargs["app_config"] = self._app_config
            if config.model_name:
                model = create_chat_model(name=config.model_name, **model_kwargs)
            else:
                model = create_chat_model(**model_kwargs)
            from langchain_core.messages import HumanMessage
            response = await model.ainvoke(
                [HumanMessage(content=prompt)],
                config=self._get_runnable_config(),
            )
            title = self._parse_title(response.content)
            if title:
                logger.info("Generated thread title via LLM: %s", title)
                return {"title": title}
            logger.warning("LLM returned empty title; falling back")
        except Exception:
            logger.warning("Failed to generate title via LLM; falling back to local title", exc_info=True)
        return {"title": self._fallback_title(user_msg)}

    @override
    def after_model(self, state: TitleMiddlewareState, runtime: Runtime) -> dict | None:
        return self._generate_title_result(state)

    @override
    async def aafter_model(self, state: TitleMiddlewareState, runtime: Runtime) -> dict | None:
        return await self._agenerate_title_result(state)
