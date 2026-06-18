"""oclaw-code — Standalone CLI for the KKOCLAW Coding Agent.

Provides a terminal-native coding agent experience that runs the
``coding_agent`` graph locally with full access to the host file system.

Usage::

    # Interactive REPL (defaults to cwd as project root)
    python -m kkoclaw.coding_cli

    # Specify a project
    python -m kkoclaw.coding_cli --project /path/to/repo

    # One-shot mode
    python -m kkoclaw.coding_cli --message "Fix the failing test in auth.py"

    # After installing the entry point (oclaw-code):
    oclaw-code --project .

Slash commands (in REPL mode):
    /init         — Initialise .kkoclaw project context
    /commit       — Ask the agent to commit current changes
    /review       — Request a code review of uncommitted diff
    /model NAME   — Switch model at runtime
    /plan         — Toggle plan mode
    /clear        — Clear conversation context (new thread)
    /help         — Show available commands
    /exit         — Quit
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import uuid
from pathlib import Path

from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig

logger = logging.getLogger(__name__)

# ── ANSI colour helpers (no external dependency) ──────────────────────────

_RESET = "\033[0m"
_BOLD = "\033[1m"
_DIM = "\033[2m"
_CYAN = "\033[36m"
_GREEN = "\033[32m"
_YELLOW = "\033[33m"
_RED = "\033[31m"
_MAGENTA = "\033[35m"
_BLUE = "\033[34m"


def _c(code: str, text: str) -> str:
    """Wrap *text* in an ANSI colour sequence."""
    return f"{code}{text}{_RESET}"


# ── Slash commands ───────────────────────────────────────────────────────

_HELP_TEXT = f"""\
{_c(_BOLD, "oclaw-code — KKOCLAW Coding Agent CLI")}

{_c(_BOLD, "Slash commands:")}
  {_c(_CYAN, "/init")}         Initialise .kkoclaw project context in the current project
  {_c(_CYAN, "/commit")}       Ask the agent to stage and commit current changes
  {_c(_CYAN, "/review")}       Request a code review of uncommitted diff
  {_c(_CYAN, "/model <name>")} Switch to a different model
  {_c(_CYAN, "/plan")}         Toggle plan mode on/off
  {_c(_CYAN, "/clear")}        Start a fresh conversation thread
  {_c(_CYAN, "/help")}         Show this help message
  {_c(_CYAN, "/exit")}         Quit the CLI (Ctrl-D also works)

{_c(_DIM, "Tip: type your request naturally and press Enter. The agent can read files,")}
{_c(_DIM, "search code, run tests, and apply diffs directly in your project.")}
"""

_SLASH_COMMANDS = {
    "/init": "Please scan the project structure and create a `.kkoclaw/project.yaml` summary with: project name, primary language, key directories, and detected framework. Then briefly describe what you found.",
    "/commit": "Review the current `git diff` (staged and unstaged). Summarise the changes, then create a well-structured commit message following conventional commits format and run `git commit`.",
    "/review": "Perform a thorough code review of the current uncommitted diff. For each file changed, comment on: correctness, style, potential bugs, and suggestions. Be concise but specific.",
}


# ── Core session ─────────────────────────────────────────────────────────


class CodingSession:
    """Manages a single coding agent CLI session.

    Builds the coding agent graph lazily, handles streaming output, and
    routes slash commands.
    """

    def __init__(
        self,
        *,
        project_root: Path,
        model_name: str | None = None,
        thinking: bool = True,
        plan_mode: bool = False,
        subagent: bool = False,
    ) -> None:
        self.project_root = project_root.resolve()
        self.model_name = model_name
        self.thinking_enabled = thinking
        self.plan_mode = plan_mode
        self.subagent_enabled = subagent
        self.thread_id = str(uuid.uuid4())
        self._agent = None
        self._checkpointer = None

    # ── Agent building ────────────────────────────────────────────────

    def _build_agent(self):
        """Build the coding agent graph via the factory."""
        from kkoclaw.agents.coding_agent.agent import make_coding_agent
        from kkoclaw.runtime.checkpointer import get_checkpointer

        self._checkpointer = get_checkpointer()

        config = self._make_config()
        agent = make_coding_agent(config)

        # If the factory didn't already attach a checkpointer (it goes through
        # create_agent which may not), attach it for multi-turn support.
        # The checkpointer is used at stream() time via config, so we keep
        # the reference for _make_config.
        return agent

    def _make_config(self) -> RunnableConfig:
        """Build RunnableConfig for the current session state."""
        configurable = {
            "thread_id": self.thread_id,
            "thinking_enabled": self.thinking_enabled,
            "is_plan_mode": self.plan_mode,
            "subagent_enabled": self.subagent_enabled,
            "project_root": str(self.project_root),
        }
        if self.model_name:
            configurable["model_name"] = self.model_name

        return RunnableConfig(
            configurable=configurable,
            recursion_limit=100,
        )

    @property
    def agent(self):
        if self._agent is None:
            self._agent = self._build_agent()
        return self._agent

    # ── Public API ────────────────────────────────────────────────────

    def send(self, message: str) -> str:
        """Send a message and stream the response. Returns accumulated AI text."""
        config = self._make_config()
        state = {"messages": [HumanMessage(content=message)]}

        accumulated: list[str] = []
        current_tool: str | None = None

        try:
            for chunk in self.agent.stream(
                state,
                config=config,
                stream_mode="messages",
            ):
                accumulated_text = self._handle_stream_chunk(chunk, accumulated, current_tool)
                if isinstance(accumulated_text, str):
                    accumulated.append(accumulated_text)
        except KeyboardInterrupt:
            print(f"\n{_c(_YELLOW, '⚠  Interrupted.')}")
        except Exception as exc:
            print(f"\n{_c(_RED, f'✘ Error: {exc}')}")
            logger.exception("Agent stream error")

        return "".join(accumulated)

    def _handle_stream_chunk(self, chunk, accumulated: list[str], current_tool: str | None) -> str | None:
        """Process a single stream-mode=messages chunk. Returns text delta or None."""
        if not isinstance(chunk, tuple) or len(chunk) != 2:
            return None

        msg, _metadata = chunk
        msg_type = getattr(msg, "type", "")

        if msg_type == "AIMessageChunk":
            content = msg.content
            if isinstance(content, str) and content:
                sys.stdout.write(content)
                sys.stdout.flush()
                return content
            # Tool call in the same chunk
            tool_calls = getattr(msg, "tool_call_chunks", None)
            if tool_calls:
                for tc in tool_calls:
                    name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
                    if name and name != current_tool:
                        print(f"\n{_c(_DIM, f'  → {name}')}")

        elif msg_type == "ToolMessage":
            tool_name = getattr(msg, "name", "tool")
            content_str = str(getattr(msg, "content", ""))
            # Show a truncated preview of the tool result
            preview = content_str.strip()
            if len(preview) > 200:
                preview = preview[:200] + "…"
            print(f"{_c(_DIM, f'  ✓ {tool_name}: {preview}')}")

        return None

    # ── Slash command handling ────────────────────────────────────────

    def handle_slash(self, raw: str) -> bool:
        """Handle a slash command. Returns True if handled (not sent to agent)."""
        parts = raw.strip().split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ""

        if cmd == "/help":
            print(_HELP_TEXT)
            return True

        if cmd == "/exit" or cmd == "/quit":
            raise SystemExit(0)

        if cmd == "/clear":
            self.thread_id = str(uuid.uuid4())
            self._agent = None
            print(f"{_c(_GREEN, '✓')} Conversation cleared. New thread started.")
            return True

        if cmd == "/plan":
            self.plan_mode = not self.plan_mode
            state = "ON" if self.plan_mode else "OFF"
            print(f"{_c(_CYAN, f'Plan mode: {state}')}")
            return True

        if cmd == "/model":
            if not arg:
                print(f"{_c(_YELLOW, 'Usage: /model <name>')} (e.g. /model claude-sonnet-4-5)")
                return True
            self.model_name = arg
            self._agent = None  # Force rebuild
            print(f"{_c(_GREEN, '✓')} Model set to {_c(_BOLD, arg)}. Agent will rebuild on next message.")
            return True

        if cmd in _SLASH_COMMANDS:
            # These map to predefined prompts sent to the agent
            label = f"  Executing {cmd}…"
            print(_c(_DIM, label))
            self.send(_SLASH_COMMANDS[cmd])
            return True

        print(f"{_c(_YELLOW, f'Unknown command: {cmd}. Type /help for available commands.')}")
        return True


# ── REPL ─────────────────────────────────────────────────────────────────


def _print_banner(session: CodingSession) -> None:
    print()
    print(f"  {_c(_BOLD, 'oclaw-code')}  {_c(_DIM, '— KKOCLAW Coding Agent')}")
    print()
    print(f"  {_c(_DIM, 'Project:')} {session.project_root}")
    parts = []
    if session.model_name:
        parts.append(f"model={session.model_name}")
    else:
        parts.append("model=default")
    parts.append(f"thinking={'on' if session.thinking_enabled else 'off'}")
    if session.plan_mode:
        parts.append("plan=on")
    if session.subagent_enabled:
        parts.append("subagent=on")
    print(f"  {_c(_DIM, ' · '.join(parts))}")
    print()
    print(f"  {_c(_DIM, 'Type your request, or /help for commands. Ctrl-D to exit.')}")
    print(f"  {_c(_DIM, '─' * 60)}")
    print()


def run_repl(session: CodingSession) -> None:
    """Run the interactive read-eval-print loop."""
    _print_banner(session)

    while True:
        try:
            raw = input(f"{_c(_CYAN, '❯')} ")
        except EOFError:
            print(f"\n{_c(_DIM, 'Goodbye.')}")
            break
        except KeyboardInterrupt:
            print(f"\n{_c(_DIM, '(Ctrl-C — type /exit to quit)')}")
            continue

        text = raw.strip()
        if not text:
            continue

        if text.startswith("/"):
            try:
                session.handle_slash(text)
            except SystemExit:
                break
            print()  # blank line after slash command output
            continue

        # Normal message
        print()
        session.send(text)
        print("\n")


# ── Entry point ──────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Returns exit code."""
    parser = argparse.ArgumentParser(
        prog="oclaw-code",
        description="KKOCLAW Coding Agent — terminal-native coding assistant",
    )
    parser.add_argument(
        "-p", "--project",
        type=str,
        default=None,
        help="Project root directory (defaults to current working directory)",
    )
    parser.add_argument(
        "-m", "--model",
        type=str,
        default=None,
        help="Model name to use (overrides config default)",
    )
    parser.add_argument(
        "--message",
        type=str,
        default=None,
        help="One-shot mode: send a single message and exit",
    )
    parser.add_argument(
        "--no-thinking",
        action="store_true",
        help="Disable extended thinking",
    )
    parser.add_argument(
        "--plan",
        action="store_true",
        help="Start in plan mode",
    )
    parser.add_argument(
        "--subagent",
        action="store_true",
        help="Enable subagent delegation",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable debug logging",
    )

    args = parser.parse_args(argv)

    # Logging
    level = logging.DEBUG if args.verbose else logging.WARNING
    logging.basicConfig(level=level, format="%(levelname)s %(name)s: %(message)s")

    # Resolve project root
    project_root = Path(args.project).resolve() if args.project else Path.cwd().resolve()
    if not project_root.is_dir():
        print(_c(_RED, f"Error: project path '{project_root}' is not a directory."), file=sys.stderr)
        return 1

    # Load app config (needed for model resolution)
    from kkoclaw.config.app_config import reload_app_config
    reload_app_config()

    session = CodingSession(
        project_root=project_root,
        model_name=args.model,
        thinking=not args.no_thinking,
        plan_mode=args.plan,
        subagent=args.subagent,
    )

    if args.message:
        # One-shot mode
        session.send(args.message)
        print()
        return 0

    try:
        run_repl(session)
    except KeyboardInterrupt:
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
