"""Middleware to fix dangling tool calls in message history.

A dangling tool call occurs when an AIMessage contains tool_calls but there are
no corresponding ToolMessages in the history (e.g., due to user interruption or
request cancellation). This causes LLM errors due to incomplete message format.

This middleware intercepts the model call to detect and patch such gaps by
inserting synthetic ToolMessages with an error indicator immediately after the
AIMessage that made the tool calls, ensuring correct message ordering.

Note: Uses wrap_model_call instead of before_model to ensure patches are inserted
at the correct positions (immediately after each dangling AIMessage), not appended
to the end of the message list as before_model + add_messages reducer would do.
"""

import json
import logging
from collections.abc import Awaitable, Callable
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest, ModelResponse
from langchain_core.messages import ToolMessage

logger = logging.getLogger(__name__)


class DanglingToolCallMiddleware(AgentMiddleware[AgentState]):
    """Inserts placeholder ToolMessages for dangling tool calls before model invocation.

    Scans the message history for AIMessages whose tool_calls lack corresponding
    ToolMessages, and injects synthetic error responses immediately after the
    offending AIMessage so the LLM receives a well-formed conversation.
    """

    @staticmethod
    def _message_tool_calls(msg) -> list[dict]:
        """Return normalized tool calls from structured fields or raw provider payloads."""
        tool_calls = getattr(msg, "tool_calls", None) or []
        if tool_calls:
            return list(tool_calls)

        raw_tool_calls = (getattr(msg, "additional_kwargs", None) or {}).get("tool_calls") or []
        normalized: list[dict] = []
        for raw_tc in raw_tool_calls:
            if not isinstance(raw_tc, dict):
                continue

            function = raw_tc.get("function")
            name = raw_tc.get("name")
            if not name and isinstance(function, dict):
                name = function.get("name")

            args = raw_tc.get("args", {})
            if not args and isinstance(function, dict):
                raw_args = function.get("arguments")
                if isinstance(raw_args, str):
                    try:
                        parsed_args = json.loads(raw_args)
                    except (TypeError, ValueError, json.JSONDecodeError):
                        parsed_args = {}
                    args = parsed_args if isinstance(parsed_args, dict) else {}

            normalized.append(
                {
                    "id": raw_tc.get("id"),
                    "name": name or "unknown",
                    "args": args if isinstance(args, dict) else {},
                }
            )

        return normalized

    def _build_patched_messages(self, messages: list) -> list | None:
        """Return a new message list with patches inserted at the correct positions.

        For each AIMessage with dangling tool_calls (no corresponding ToolMessage),
        a synthetic ToolMessage is inserted immediately after that AIMessage.

        Also handles **misordered** tool messages: if an AIMessage has tool_calls
        but the immediately following messages are not all the corresponding
        ToolMessages (e.g. a HumanMessage appears between the AIMessage and
        its ToolMessages), synthetic ToolMessages are inserted right after the
        AIMessage and the out-of-order ToolMessages are removed from their
        original position so that the sequence satisfies the API contract:
        AIMessage(tool_calls) → ToolMessage* → (other messages).

        Returns None if no patches are needed.
        """
        from langchain_core.messages import AIMessage

        # Collect IDs of all existing ToolMessages
        existing_tool_msg_ids: set[str] = set()
        for msg in messages:
            if isinstance(msg, ToolMessage):
                existing_tool_msg_ids.add(msg.tool_call_id)

        # Determine which tool_call_ids are misordered: they belong to an
        # AIMessage but are NOT immediately after it.
        misordered_ids: set[str] = set()
        for i, msg in enumerate(messages):
            if not isinstance(msg, AIMessage):
                continue
            tc_ids_for_msg = {tc.get("id") for tc in self._message_tool_calls(msg) if tc.get("id")}
            if not tc_ids_for_msg:
                continue
            # Check which tool_call_ids appear immediately after this AIMessage
            found_after: set[str] = set()
            j = i + 1
            while j < len(messages) and isinstance(messages[j], ToolMessage):
                found_after.add(messages[j].tool_call_id)
                j += 1
            # Any tool_call_id not found immediately after is misordered
            misordered_ids.update(tc_ids_for_msg - found_after)

        # Check if any patching is needed
        needs_patch = False
        for msg in messages:
            if not isinstance(msg, AIMessage):
                continue
            for tc in self._message_tool_calls(msg):
                tc_id = tc.get("id")
                if tc_id and (tc_id not in existing_tool_msg_ids or tc_id in misordered_ids):
                    needs_patch = True
                    break
            if needs_patch:
                break

        if not needs_patch:
            return None

        # Build new list with patches inserted right after each dangling AIMessage
        # and remove misordered ToolMessages from their original position
        patched: list = []
        patched_ids: set[str] = set()
        patch_count = 0
        for msg in messages:
            # Skip misordered ToolMessages — they'll be replaced by patches
            if isinstance(msg, ToolMessage) and msg.tool_call_id in misordered_ids:
                continue

            patched.append(msg)
            if not isinstance(msg, AIMessage):
                continue
            for tc in self._message_tool_calls(msg):
                tc_id = tc.get("id")
                if tc_id and (tc_id not in existing_tool_msg_ids or tc_id in misordered_ids) and tc_id not in patched_ids:
                    patched.append(
                        ToolMessage(
                            content="[Tool call was interrupted and did not return a result.]",
                            tool_call_id=tc_id,
                            name=tc.get("name", "unknown"),
                            status="error",
                        )
                    )
                    patched_ids.add(tc_id)
                    patch_count += 1

        # --- Post-validation: ensure no orphan ToolMessages remain ---
        # Scan the patched list to verify every ToolMessage has a preceding
        # AIMessage with matching tool_calls.  If any orphan is found, remove it.
        patched = self._remove_orphan_tool_messages(patched)

        logger.warning(
            "Injecting %d placeholder ToolMessage(s) for dangling/misordered tool calls "
            "(total messages: %d, existing ToolMessages: %d, misordered: %d)",
            patch_count,
            len(messages),
            len(existing_tool_msg_ids),
            len(misordered_ids),
        )
        return patched

    @staticmethod
    def _remove_orphan_tool_messages(messages: list) -> list:
        """Remove ToolMessages whose tool_call_id does not match any AIMessage's tool_calls.

        This is a safety net: after patching dangling calls and removing misordered
        ToolMessages, there might still be orphan ToolMessages (e.g. from corrupted
        checkpoint state) that would cause a 400 error from the LLM API.
        """
        from langchain_core.messages import AIMessage

        # Collect all valid tool_call_ids from AIMessages
        valid_tool_call_ids: set[str] = set()
        for msg in messages:
            if not isinstance(msg, AIMessage):
                continue
            for tc in DanglingToolCallMiddleware._message_tool_calls(msg):
                tc_id = tc.get("id")
                if tc_id:
                    valid_tool_call_ids.add(tc_id)

        # Build a map: tool_call_id -> index of the AIMessage that owns it
        ai_msg_positions: dict[str, int] = {}
        for i, msg in enumerate(messages):
            if not isinstance(msg, AIMessage):
                continue
            for tc in DanglingToolCallMiddleware._message_tool_calls(msg):
                tc_id = tc.get("id")
                if tc_id:
                    ai_msg_positions[tc_id] = i

        # Verify each ToolMessage appears right after its owning AIMessage
        cleaned: list = []
        for i, msg in enumerate(messages):
            if not isinstance(msg, ToolMessage):
                cleaned.append(msg)
                continue

            tc_id = msg.tool_call_id

            # ToolMessage with unknown tool_call_id (not matched to any AIMessage)
            if tc_id not in valid_tool_call_ids:
                logger.warning(
                    "Removing orphan ToolMessage with unknown tool_call_id=%s at position %d",
                    tc_id, i,
                )
                continue

            # Check if this ToolMessage appears in the correct position
            # (immediately after its owning AIMessage, possibly with sibling ToolMessages)
            ai_pos = ai_msg_positions.get(tc_id, -1)
            # Find the range [ai_pos+1, ...) of ToolMessages that belong to this AIMessage
            # The ToolMessage should be within this contiguous ToolMessage block
            if ai_pos >= 0:
                # Find the end of the ToolMessage block starting after the AIMessage
                block_end = ai_pos + 1
                while block_end < len(messages) and isinstance(messages[block_end], ToolMessage):
                    block_end += 1
                # Check if the current position (i) falls within this block
                # If not, it means the ToolMessage is still out of place after patching
                if i < ai_pos + 1 or i >= block_end:
                    logger.warning(
                        "Removing misplaced ToolMessage tool_call_id=%s at position %d "
                        "(expected after AIMessage at position %d, block ends at %d)",
                        tc_id, i, ai_pos, block_end,
                    )
                    continue

            cleaned.append(msg)

        return cleaned

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelCallResult:
        patched = self._build_patched_messages(request.messages)
        if patched is not None:
            request = request.override(messages=patched)
        elif self._has_orphan_tool_messages(request.messages):
            # Even if no dangling calls, clean up orphan ToolMessages
            cleaned = self._remove_orphan_tool_messages(request.messages)
            if len(cleaned) != len(request.messages):
                request = request.override(messages=cleaned)
        return handler(request)

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelCallResult:
        patched = self._build_patched_messages(request.messages)
        if patched is not None:
            request = request.override(messages=patched)
        elif self._has_orphan_tool_messages(request.messages):
            # Even if no dangling calls, clean up orphan ToolMessages
            cleaned = self._remove_orphan_tool_messages(request.messages)
            if len(cleaned) != len(request.messages):
                request = request.override(messages=cleaned)
        return await handler(request)

    @staticmethod
    def _has_orphan_tool_messages(messages: list) -> bool:
        """Quick check if any ToolMessage lacks a preceding AIMessage with matching tool_calls.

        This is a lightweight pre-check to avoid running the full _remove_orphan_tool_messages
        scan when there are no orphans.
        """
        from langchain_core.messages import AIMessage

        valid_ids: set[str] = set()
        for msg in messages:
            if isinstance(msg, AIMessage):
                for tc in DanglingToolCallMiddleware._message_tool_calls(msg):
                    tc_id = tc.get("id")
                    if tc_id:
                        valid_ids.add(tc_id)
            elif isinstance(msg, ToolMessage):
                if msg.tool_call_id not in valid_ids:
                    return True
        return False
