from __future__ import annotations

from types import SimpleNamespace


class _FakeSandbox:
    def __init__(self, *, files: dict[str, str] | None = None, commands: dict[str, str] | None = None) -> None:
        self.files = files or {}
        self.commands = commands or {}
        self.glob_calls: list[tuple[str, str]] = []
        self.write_calls: list[tuple[str, str]] = []

    def glob(self, root: str, pattern: str, include_dirs: bool = False, max_results: int = 1):
        self.glob_calls.append((root, pattern))
        candidate = f"{root.rstrip('/')}/{pattern}"
        if candidate in self.files:
            return [candidate], False
        return [], False

    def execute_command(self, command: str, *, run_id: str | None = None) -> str:
        for needle, output in self.commands.items():
            if needle in command:
                return output
        return ""

    def read_file(self, file_path: str) -> str:
        return self.files[file_path]

    def write_file(self, file_path: str, content: str) -> None:
        self.write_calls.append((file_path, content))
        self.files[file_path] = content


def _runtime(project_root: str = "/repo", thread_id: str = "thread-1"):
    return SimpleNamespace(context={"thread_id": thread_id}, config={"configurable": {"thread_id": thread_id, "project_root": project_root}})


def test_detect_test_framework_uses_project_root(monkeypatch):
    from kkoclaw.tools.coding import test_tools

    sandbox = _FakeSandbox(files={"/repo/pyproject.toml": ""})
    monkeypatch.setattr(test_tools, "ensure_sandbox_initialized", lambda runtime: sandbox)
    monkeypatch.setattr(test_tools, "ensure_thread_directories_exist", lambda runtime: None)
    monkeypatch.setattr(test_tools, "get_thread_data", lambda runtime: {"project_root": "/repo"})

    assert test_tools._detect_test_framework(_runtime()) == "pytest"
    assert ("/repo", "pyproject.toml") in sandbox.glob_calls


def test_typescript_linter_errors_are_not_marked_clean(monkeypatch):
    from kkoclaw.tools.coding import test_tools

    output = "src/index.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'."
    sandbox = _FakeSandbox(
        files={"/repo/package.json": "{}", "/repo/tsconfig.json": "{}"},
        commands={"which eslint": "", "which tsc": "/usr/bin/tsc", "npx tsc": output},
    )
    monkeypatch.setattr(test_tools, "ensure_sandbox_initialized", lambda runtime: sandbox)
    monkeypatch.setattr(test_tools, "ensure_thread_directories_exist", lambda runtime: None)
    monkeypatch.setattr(test_tools, "get_thread_data", lambda runtime: {"project_root": "/repo"})

    result = test_tools.run_linter_tool.func(_runtime(), linter="tsc")

    assert '"clean": false' in result
    assert '"issue_count": 1' in result
    assert "TS2322" in result


def test_file_edit_tools_record_snapshots_before_writing(monkeypatch):
    from kkoclaw.tools.coding import file_edit

    sandbox = _FakeSandbox(files={"/repo/app.py": "one\n"})
    events: list[str] = []
    monkeypatch.setattr(file_edit, "ensure_sandbox_initialized", lambda runtime: sandbox)
    monkeypatch.setattr(file_edit, "ensure_thread_directories_exist", lambda runtime: None)
    monkeypatch.setattr(file_edit, "is_local_sandbox", lambda runtime: False)
    monkeypatch.setattr(file_edit, "get_file_operation_lock", lambda sandbox, path: _NoopLock())
    monkeypatch.setattr(file_edit, "record_edit_snapshot", lambda *args, **kwargs: events.append("snapshot"))
    monkeypatch.setattr(file_edit, "record_runtime_file_change", lambda *args, **kwargs: events.append("change"))

    result = file_edit.apply_diff_tool.func(
        _runtime(),
        "/repo/app.py",
        "@@ -1 +1 @@\n-one\n+two\n",
    )

    assert result.startswith("OK:")
    assert events[:2] == ["snapshot", "change"]
    assert sandbox.write_calls == [("/repo/app.py", "two\n")]


def test_insert_at_line_records_snapshot(monkeypatch):
    from kkoclaw.tools.coding import file_edit

    sandbox = _FakeSandbox(files={"/repo/app.py": "one\n"})
    snapshots: list[dict] = []
    monkeypatch.setattr(file_edit, "ensure_sandbox_initialized", lambda runtime: sandbox)
    monkeypatch.setattr(file_edit, "ensure_thread_directories_exist", lambda runtime: None)
    monkeypatch.setattr(file_edit, "is_local_sandbox", lambda runtime: False)
    monkeypatch.setattr(file_edit, "get_file_operation_lock", lambda sandbox, path: _NoopLock())
    monkeypatch.setattr(file_edit, "record_edit_snapshot", lambda *args, **kwargs: snapshots.append(kwargs))
    monkeypatch.setattr(file_edit, "record_runtime_file_change", lambda *args, **kwargs: None)

    result = file_edit.insert_at_line_tool.func(_runtime(), "/repo/app.py", 1, "two")

    assert result.startswith("OK:")
    assert snapshots == [{"file_path": "/repo/app.py", "before": "one\n", "tool": "insert_at_line"}]


def test_multi_edit_is_all_or_nothing_across_files(monkeypatch):
    from kkoclaw.tools.coding import file_edit

    sandbox = _FakeSandbox(files={"/repo/a.py": "alpha\n", "/repo/b.py": "beta\n"})
    monkeypatch.setattr(file_edit, "ensure_sandbox_initialized", lambda runtime: sandbox)
    monkeypatch.setattr(file_edit, "ensure_thread_directories_exist", lambda runtime: None)
    monkeypatch.setattr(file_edit, "is_local_sandbox", lambda runtime: False)
    monkeypatch.setattr(file_edit, "get_file_operation_lock", lambda sandbox, path: _NoopLock())

    result = file_edit.multi_edit_tool.func(
        _runtime(),
        [
            {"file_path": "/repo/a.py", "old_string": "alpha", "new_string": "ALPHA"},
            {"file_path": "/repo/b.py", "old_string": "missing", "new_string": "BETA"},
        ],
    )

    assert result.startswith("Error:")
    assert sandbox.files["/repo/a.py"] == "alpha\n"
    assert sandbox.write_calls == []


class _NoopLock:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False
