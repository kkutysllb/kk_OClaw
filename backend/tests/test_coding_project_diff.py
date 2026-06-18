import subprocess
from pathlib import Path

import pytest

from app.gateway.coding_services import GitDiffService


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


@pytest.fixture()
def git_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")
    (repo / "app.py").write_text("print('hello')\n", encoding="utf-8")
    (repo / "old.txt").write_text("old\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")
    return repo


def test_git_diff_service_lists_modified_added_and_deleted_files(git_repo: Path):
    (git_repo / "app.py").write_text("print('hello')\nprint('world')\n", encoding="utf-8")
    (git_repo / "new.txt").write_text("new\n", encoding="utf-8")
    (git_repo / "old.txt").unlink()

    result = GitDiffService.get_diff(str(git_repo))

    files = {item["path"]: item for item in result["files"]}
    assert result["is_git_repo"] is True
    assert result["has_changes"] is True
    assert files["app.py"]["status"] == "modified"
    assert files["app.py"]["additions"] >= 1
    assert "diff --git a/app.py b/app.py" in files["app.py"]["diff"]
    assert "+print('world')" in files["app.py"]["diff"]
    assert files["new.txt"]["status"] == "added"
    assert files["new.txt"]["additions"] == 1
    assert "diff --git a/new.txt b/new.txt" in files["new.txt"]["diff"]
    assert "+new" in files["new.txt"]["diff"]
    assert files["old.txt"]["status"] == "deleted"
    assert "diff --git a/old.txt b/old.txt" in files["old.txt"]["diff"]
    assert "diff --git a/app.py b/app.py" in result["diff"]
    assert "diff --git a/new.txt b/new.txt" in result["diff"]
    assert "+new" in result["diff"]


def test_git_diff_service_returns_empty_diff_for_clean_repo(git_repo: Path):
    result = GitDiffService.get_diff(str(git_repo))

    assert result["is_git_repo"] is True
    assert result["has_changes"] is False
    assert result["files"] == []
    assert result["diff"] == ""


def test_git_diff_service_returns_structured_non_git_state(tmp_path: Path):
    result = GitDiffService.get_diff(str(tmp_path))

    assert result["is_git_repo"] is False
    assert result["has_changes"] is False
    assert result["files"] == []
    assert result["diff"] == ""


def test_git_diff_service_discard_file_change_restores_modified_file(git_repo: Path):
    (git_repo / "app.py").write_text("print('changed')\n", encoding="utf-8")

    result = GitDiffService.discard_file_change(str(git_repo), "app.py")

    assert result == {"path": "app.py", "discarded": True}
    assert (git_repo / "app.py").read_text(encoding="utf-8") == "print('hello')\n"
    assert GitDiffService.get_diff(str(git_repo))["files"] == []


def test_git_diff_service_discard_file_change_removes_untracked_file(git_repo: Path):
    (git_repo / "scratch.txt").write_text("temporary\n", encoding="utf-8")

    result = GitDiffService.discard_file_change(str(git_repo), "scratch.txt")

    assert result == {"path": "scratch.txt", "discarded": True}
    assert not (git_repo / "scratch.txt").exists()


def test_git_diff_service_discard_file_change_rejects_path_traversal(git_repo: Path):
    with pytest.raises(ValueError, match="outside the repository"):
        GitDiffService.discard_file_change(str(git_repo), "../outside.txt")
