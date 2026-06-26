import builtins

import kkoclaw.sandbox.local.local_sandbox as local_sandbox
from kkoclaw.sandbox.local.local_sandbox import LocalSandbox


def _open(base, file, mode="r", *args, **kwargs):
    if "b" in mode:
        return base(file, mode, *args, **kwargs)
    return base(file, mode, *args, encoding=kwargs.pop("encoding", "gbk"), **kwargs)


class _FakePopen:
    stdout = "ok"
    stderr = ""
    returncode = 0

    def __init__(self, calls, *args, **kwargs):
        calls.append((args[0], kwargs))

    def communicate(self, timeout=None):
        return self.stdout, self.stderr

    def poll(self):
        return self.returncode


def _mock_popen(monkeypatch):
    calls: list[tuple[object, dict]] = []

    def fake_popen(*args, **kwargs):
        return _FakePopen(calls, *args, **kwargs)

    monkeypatch.setattr(local_sandbox.subprocess, "Popen", fake_popen)
    return calls


def test_read_file_uses_utf8_on_windows_locale(tmp_path, monkeypatch):
    path = tmp_path / "utf8.txt"
    text = "\u201cutf8\u201d"
    path.write_text(text, encoding="utf-8")
    base = builtins.open

    monkeypatch.setattr(local_sandbox, "open", lambda file, mode="r", *args, **kwargs: _open(base, file, mode, *args, **kwargs), raising=False)

    assert LocalSandbox("t").read_file(str(path)) == text


def test_write_file_uses_utf8_on_windows_locale(tmp_path, monkeypatch):
    path = tmp_path / "utf8.txt"
    text = "emoji \U0001f600"
    base = builtins.open

    monkeypatch.setattr(local_sandbox, "open", lambda file, mode="r", *args, **kwargs: _open(base, file, mode, *args, **kwargs), raising=False)

    LocalSandbox("t").write_file(str(path), text)

    assert path.read_text(encoding="utf-8") == text


def test_get_shell_prefers_posix_shell_from_path_before_windows_fallback(monkeypatch):
    monkeypatch.setattr(local_sandbox.os, "name", "nt")
    monkeypatch.setattr(LocalSandbox, "_find_first_available_shell", lambda candidates: r"C:\Program Files\Git\bin\sh.exe" if candidates == ("/bin/zsh", "/bin/bash", "/bin/sh", "sh") else None)

    assert LocalSandbox._get_shell() == r"C:\Program Files\Git\bin\sh.exe"


def test_get_shell_uses_powershell_fallback_on_windows(monkeypatch):
    calls: list[tuple[str, ...]] = []

    def fake_find(candidates: tuple[str, ...]) -> str | None:
        calls.append(candidates)
        if candidates == ("/bin/zsh", "/bin/bash", "/bin/sh", "sh"):
            return None
        return r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

    monkeypatch.setattr(local_sandbox.os, "name", "nt")
    monkeypatch.setattr(local_sandbox.os, "environ", {"SystemRoot": r"C:\Windows"})
    monkeypatch.setattr(LocalSandbox, "_find_first_available_shell", fake_find)

    assert LocalSandbox._get_shell() == r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    assert calls[1] == (
        "pwsh",
        "pwsh.exe",
        "powershell",
        "powershell.exe",
        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
        "cmd.exe",
    )


def test_get_shell_uses_cmd_as_last_windows_fallback(monkeypatch):
    def fake_find(candidates: tuple[str, ...]) -> str | None:
        if candidates == ("/bin/zsh", "/bin/bash", "/bin/sh", "sh"):
            return None
        return r"C:\Windows\System32\cmd.exe"

    monkeypatch.setattr(local_sandbox.os, "name", "nt")
    monkeypatch.setattr(local_sandbox.os, "environ", {"SystemRoot": r"C:\Windows"})
    monkeypatch.setattr(LocalSandbox, "_find_first_available_shell", fake_find)

    assert LocalSandbox._get_shell() == r"C:\Windows\System32\cmd.exe"


def test_execute_command_uses_powershell_command_mode_on_windows(monkeypatch):
    calls = _mock_popen(monkeypatch)
    monkeypatch.setattr(local_sandbox.os, "name", "nt")
    monkeypatch.setattr(LocalSandbox, "_get_shell", staticmethod(lambda: r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"))

    output = LocalSandbox("t").execute_command("Write-Output hello")

    assert output == "ok"
    assert calls == [
        (
            [
                r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
                "-NoProfile",
                "-Command",
                "Write-Output hello",
            ],
            {
                "shell": False,
                "stdout": local_sandbox.subprocess.PIPE,
                "stderr": local_sandbox.subprocess.PIPE,
                "text": True,
                "env": None,
            },
        )
    ]


def test_execute_command_uses_posix_shell_command_mode_on_windows(monkeypatch):
    calls = _mock_popen(monkeypatch)
    monkeypatch.setattr(local_sandbox.os, "name", "nt")
    monkeypatch.setattr(local_sandbox.os, "environ", {})
    monkeypatch.setattr(LocalSandbox, "_get_shell", staticmethod(lambda: r"C:\Program Files\Git\bin\sh.exe"))

    output = LocalSandbox("t").execute_command("echo hello")

    assert output == "ok"
    assert calls == [
        (
            [r"C:\Program Files\Git\bin\sh.exe", "-c", "echo hello"],
            {
                "shell": False,
                "stdout": local_sandbox.subprocess.PIPE,
                "stderr": local_sandbox.subprocess.PIPE,
                "text": True,
                "env": {
                    **{},
                    "MSYS_NO_PATHCONV": "1",
                    "MSYS2_ARG_CONV_EXCL": "*",
                },
            },
        )
    ]


def test_execute_command_uses_cmd_command_mode_on_windows(monkeypatch):
    calls = _mock_popen(monkeypatch)
    monkeypatch.setattr(local_sandbox.os, "name", "nt")
    monkeypatch.setattr(LocalSandbox, "_get_shell", staticmethod(lambda: r"C:\Windows\System32\cmd.exe"))

    output = LocalSandbox("t").execute_command("echo hello")

    assert output == "ok"
    assert calls == [
        (
            [r"C:\Windows\System32\cmd.exe", "/c", "echo hello"],
            {
                "shell": False,
                "stdout": local_sandbox.subprocess.PIPE,
                "stderr": local_sandbox.subprocess.PIPE,
                "text": True,
                "env": None,
            },
        )
    ]
