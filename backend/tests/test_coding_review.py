from __future__ import annotations

import subprocess
from pathlib import Path


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True)


def test_coding_review_service_builds_structured_review_from_diff_changes_and_events(tmp_path, monkeypatch):
    from app.gateway.coding_review_services import CodingReviewService
    from kkoclaw.coding_core.change_tracking import QiongqiChangeTracker
    from kkoclaw.coding_core.session_store import QiongqiSessionStore

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "checkout", "-b", "master")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")
    (repo / "auth.py").write_text(
        "def login(user):\n"
        "    return user\n",
        encoding="utf-8",
    )
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")

    (repo / "auth.py").write_text(
        "def login(user):\n"
        "    password = \"secret\"\n"
        "    return user\n",
        encoding="utf-8",
    )

    store = QiongqiSessionStore.from_home()
    tracker = QiongqiChangeTracker(store)
    tracker.record_file_change(
        thread_id="thread-review",
        task_id="task-1",
        project_root=str(repo),
        path="auth.py",
        status="modified",
        additions=1,
        deletions=0,
        diff="diff --git a/auth.py b/auth.py\n+    password = \"secret\"\n",
    )
    store.append_event("thread-review", "tool_policy_decided", {"allowed_tools": ["read_file_lines"]})
    store.append_event("thread-review", "file_changed", {"path": "auth.py", "task_id": "task-1"})

    result = CodingReviewService.run_review(
        project_id="project-1",
        project_root=str(repo),
        thread_id="thread-review",
        scope="project_diff",
    )

    assert result["project_id"] == "project-1"
    assert result["thread_id"] == "thread-review"
    assert result["scope"] == "project_diff"
    assert result["summary"]["project_files"] == 1
    assert result["summary"]["task_changes"] == 1
    assert result["summary"]["qiongqi_events"] == 3
    assert result["summary"]["critical"] == 1
    assert result["decision"] == "request_changes"
    assert result["source"]["diff_files"][0]["path"] == "auth.py"
    assert result["source"]["task_changes"][0]["task_id"] == "task-1"
    assert result["source"]["events"][-1]["event_type"] == "file_changed"
    assert result["findings"][0]["severity"] == "critical"
    assert result["findings"][0]["category"] == "security"
    assert result["findings"][0]["file"] == "auth.py"
    assert result["findings"][0]["task_id"] == "task-1"
    assert "secret" in result["findings"][0]["message"].lower()
    assert (home / ".oclaw-coding" / "thread-review" / "reviews" / f"{result['review_id']}.json").is_file()


def test_coding_review_router_exposes_latest_review(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.gateway.routers import coding_review

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "checkout", "-b", "master")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")
    (repo / "app.py").write_text("print('hello')\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")
    (repo / "app.py").write_text("print('hello')\nprint('world')\n", encoding="utf-8")

    app = FastAPI()
    app.include_router(coding_review.router)

    with TestClient(app) as client:
        response = client.post(
            "/api/coding/reviews",
            json={
                "project_id": "project-1",
                "project_root": str(repo),
                "thread_id": "thread-review",
                "scope": "project_diff",
            },
        )
        latest = client.get("/api/coding/sessions/thread-review/review")

    assert response.status_code == 200
    assert response.json()["summary"]["project_files"] == 1
    assert latest.status_code == 200
    assert latest.json()["review"]["review_id"] == response.json()["review_id"]


def test_coding_review_router_applies_review_fix(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.gateway.routers import coding_review

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "checkout", "-b", "main")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")
    (repo / "auth.py").write_text("password = \"secret123\"\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")
    (repo / "auth.py").write_text("password = \"secret456\"\n", encoding="utf-8")

    app = FastAPI()
    app.include_router(coding_review.router)

    with TestClient(app) as client:
        review_response = client.post(
            "/api/coding/reviews",
            json={
                "project_id": "project-1",
                "project_root": str(repo),
                "thread_id": "thread-review",
                "scope": "project_diff",
            },
        )
        review = review_response.json()
        finding = next(item for item in review["findings"] if item["fix"]["applicable"])
        apply_response = client.post(
            "/api/coding/reviews/fixes/apply",
            json={
                "thread_id": "thread-review",
                "review_id": review["review_id"],
                "finding_id": finding["id"],
            },
        )

    assert apply_response.status_code == 200
    assert apply_response.json()["applied"] is True
    assert "os.environ.get" in (repo / "auth.py").read_text(encoding="utf-8")


def test_coding_review_builds_fix_patch_and_applies_safe_secret_fix(tmp_path, monkeypatch):
    from app.gateway.coding_review_services import CodingReviewService

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")
    (repo / "auth.py").write_text(
        "def login(user):\n"
        "    password = \"secret\"\n"
        "    return user\n",
        encoding="utf-8",
    )
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")
    (repo / "auth.py").write_text(
        "def login(user):\n"
        "    password = \"secret123\"\n"
        "    return user\n",
        encoding="utf-8",
    )

    review = CodingReviewService.run_review(
        project_id="project-1",
        project_root=str(repo),
        thread_id="thread-review",
        scope="project_diff",
    )
    finding = next(item for item in review["findings"] if item["category"] == "security")

    assert finding["fix"]["applicable"] is True
    assert "import os" in finding["fix"]["patch"]
    assert "os.environ" in finding["fix"]["patch"]

    applied = CodingReviewService.apply_fix(
        thread_id="thread-review",
        review_id=review["review_id"],
        finding_id=finding["id"],
    )

    assert applied["applied"] is True
    content = (repo / "auth.py").read_text(encoding="utf-8")
    assert "import os" in content
    assert "os.environ.get" in content
    assert "secret123" not in content


def test_coding_review_pr_scope_includes_cross_commit_context(tmp_path, monkeypatch):
    from app.gateway.coding_review_services import CodingReviewService

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "checkout", "-b", "master")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")
    (repo / "app.py").write_text("print('base')\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "base")
    _git(repo, "checkout", "-b", "feature")
    (repo / "app.py").write_text("print('feature 1')\n", encoding="utf-8")
    _git(repo, "commit", "-am", "feature one")
    (repo / "app.py").write_text("print('feature 2')\n", encoding="utf-8")
    _git(repo, "commit", "-am", "feature two")

    review = CodingReviewService.run_review(
        project_id="project-1",
        project_root=str(repo),
        thread_id="thread-review",
        scope="pr",
        base_ref="master",
    )

    assert review["scope"] == "pr"
    assert review["source"]["pr_context"]["base_ref"] == "master"
    assert len(review["source"]["pr_context"]["commits"]) == 2
    assert review["summary"]["commits"] == 2
    assert review["summary"]["project_files"] == 1


def test_coding_review_pr_scope_auto_detects_base_branch(tmp_path, monkeypatch):
    from app.gateway.coding_review_services import CodingReviewService

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "checkout", "-b", "master")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")
    (repo / "app.py").write_text("print('base')\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "base")
    _git(repo, "checkout", "-b", "feature")
    (repo / "app.py").write_text("print('feature')\n", encoding="utf-8")
    _git(repo, "commit", "-am", "feature")

    review = CodingReviewService.run_review(
        project_id="project-1",
        project_root=str(repo),
        thread_id="thread-review",
        scope="pr",
        base_ref="main",
    )

    assert review["scope"] == "pr"
    assert review["source"]["pr_context"]["base_ref"] == "master"
    assert review["source"]["pr_context"]["requested_base_ref"] == "main"
    assert review["summary"]["commits"] == 1


def test_coding_review_pr_scope_treats_auto_base_ref_as_auto(tmp_path, monkeypatch):
    from app.gateway.coding_review_services import CodingReviewService

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "checkout", "-b", "master")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")
    (repo / "app.py").write_text("print('base')\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "base")
    _git(repo, "checkout", "-b", "feature")
    (repo / "app.py").write_text("print('feature')\n", encoding="utf-8")
    _git(repo, "commit", "-am", "feature")

    review = CodingReviewService.run_review(
        project_id="project-1",
        project_root=str(repo),
        thread_id="thread-review",
        scope="pr",
        base_ref="auto",
    )

    assert review["scope"] == "pr"
    assert review["source"]["pr_context"]["base_ref"] == "master"
    assert review["source"]["pr_context"]["requested_base_ref"] == "auto"
    assert review["summary"]["commits"] == 1


def test_coding_review_pr_scope_auto_handles_single_main_branch(tmp_path, monkeypatch):
    from app.gateway.coding_review_services import CodingReviewService

    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "checkout", "-b", "main")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")
    (repo / "app.py").write_text("print('base')\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "base")

    review = CodingReviewService.run_review(
        project_id="project-1",
        project_root=str(repo),
        thread_id="thread-review",
        scope="pr",
        base_ref="auto",
    )

    assert review["scope"] == "pr"
    assert review["source"]["pr_context"]["base_ref"] == "main"
    assert review["source"]["pr_context"]["requested_base_ref"] == "auto"
    assert review["summary"]["commits"] == 0
    assert review["summary"]["project_files"] == 0


# ------------------------------------------------------------------ #
# Auto-fix: simple lint / config risk / test-gap                    #
# ------------------------------------------------------------------ #

def _init_repo(repo: Path) -> None:
    """Create a git repo with identity configured and an initial commit."""
    _git(repo, "init")
    _git(repo, "checkout", "-b", "master")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test User")


def test_whitespace_fix_unit_applicable_and_clean(tmp_path) -> None:
    from app.gateway.coding_review_services import _build_whitespace_fix

    (tmp_path / "app.py").write_text("x = 1   \ny = 2\n", encoding="utf-8")
    fix = _build_whitespace_fix(project_root=str(tmp_path), path="app.py")
    assert fix["applicable"] is True
    assert fix["kind"] == "normalize_whitespace"
    assert "x = 1   \n" in fix["expected"]
    assert "x = 1\n" in fix["replacement"]


def test_whitespace_fix_unit_already_clean(tmp_path) -> None:
    from app.gateway.coding_review_services import _build_whitespace_fix

    (tmp_path / "app.py").write_text("x = 1\ny = 2\n", encoding="utf-8")
    fix = _build_whitespace_fix(project_root=str(tmp_path), path="app.py")
    assert fix["applicable"] is False


def test_gitignore_dotenv_fix_unit_scenarios(tmp_path) -> None:
    from app.gateway.coding_review_services import _build_gitignore_dotenv_fix

    root = str(tmp_path)
    # .env absent
    assert _build_gitignore_dotenv_fix(project_root=root)["applicable"] is False

    # .env present, .gitignore absent
    (tmp_path / ".env").write_text("TOKEN=abc\n", encoding="utf-8")
    assert _build_gitignore_dotenv_fix(project_root=root)["applicable"] is False

    # .env + .gitignore without rule
    (tmp_path / ".gitignore").write_text("__pycache__/\n*.pyc\n", encoding="utf-8")
    fix = _build_gitignore_dotenv_fix(project_root=root)
    assert fix["applicable"] is True
    assert fix["kind"] == "gitignore_dotenv"
    assert ".env" in fix["replacement"]
    assert "__pycache__/" in fix["replacement"]  # original content preserved

    # .env + .gitignore already has rule
    (tmp_path / ".gitignore").write_text(".env\n", encoding="utf-8")
    assert _build_gitignore_dotenv_fix(project_root=root)["applicable"] is False


def test_test_skeleton_fix_unit_scenarios(tmp_path) -> None:
    from app.gateway.coding_review_services import _build_test_skeleton_fix

    root = str(tmp_path)
    # Non-python source
    assert _build_test_skeleton_fix(project_root=root, source_path="readme.md")[
        "applicable"
    ] is False

    # Python source present
    (tmp_path / "feature.py").write_text("def add(a,b): return a+b\n", encoding="utf-8")
    fix = _build_test_skeleton_fix(project_root=root, source_path="feature.py")
    assert fix["applicable"] is True
    assert fix["kind"] == "create_test_skeleton"
    assert fix["target_path"] == "tests/test_feature.py"
    assert fix["expected"] == ""  # new-file mode
    assert "pytest.mark.skip" in fix["replacement"]
    assert "def test_feature_skeleton" in fix["replacement"]

    # Existing test file blocks the fix
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_feature.py").write_text("# exists\n", encoding="utf-8")
    again = _build_test_skeleton_fix(project_root=root, source_path="feature.py")
    assert again["applicable"] is False


def test_review_applies_whitespace_fix_e2e(tmp_path, monkeypatch) -> None:
    from app.gateway.coding_review_services import CodingReviewService

    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    (repo / "utils.py").write_text("x = 1\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")
    # Introduce trailing whitespace to produce a diff.
    (repo / "utils.py").write_text("x = 1   \ny = 2\n", encoding="utf-8")

    review = CodingReviewService.run_review(
        project_id="p1", project_root=str(repo), thread_id="t-ws", scope="project_diff",
    )
    lint_findings = [f for f in review["findings"] if f["category"] == "lint"]
    assert len(lint_findings) == 1
    assert lint_findings[0]["fix"]["kind"] == "normalize_whitespace"

    applied = CodingReviewService.apply_fix(
        thread_id="t-ws", review_id=review["review_id"], finding_id=lint_findings[0]["id"],
    )
    assert applied["applied"] is True
    content = (repo / "utils.py").read_text(encoding="utf-8")
    assert "x = 1   \n" not in content
    assert "x = 1\ny = 2\n" == content


def test_review_applies_gitignore_dotenv_fix_e2e(tmp_path, monkeypatch) -> None:
    from app.gateway.coding_review_services import CodingReviewService

    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    (repo / "app.py").write_text("print('hi')\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")
    (repo / "app.py").write_text("print('bye')\n", encoding="utf-8")
    (repo / ".env").write_text("SECRET=abc123\n", encoding="utf-8")
    (repo / ".gitignore").write_text("__pycache__/\n", encoding="utf-8")

    review = CodingReviewService.run_review(
        project_id="p1", project_root=str(repo), thread_id="t-env", scope="project_diff",
    )
    config_findings = [f for f in review["findings"] if f["category"] == "config"]
    assert len(config_findings) == 1
    assert config_findings[0]["fix"]["kind"] == "gitignore_dotenv"

    applied = CodingReviewService.apply_fix(
        thread_id="t-env", review_id=review["review_id"], finding_id=config_findings[0]["id"],
    )
    assert applied["applied"] is True
    ignore = (repo / ".gitignore").read_text(encoding="utf-8")
    assert ".env" in ignore
    assert "__pycache__/" in ignore  # original rule preserved


def test_review_applies_test_skeleton_fix_e2e(tmp_path, monkeypatch) -> None:
    from app.gateway.coding_review_services import CodingReviewService

    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    (repo / "feature.py").write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")
    (repo / "feature.py").write_text("def add(a, b):\n    return a + b + 1\n", encoding="utf-8")

    review = CodingReviewService.run_review(
        project_id="p1", project_root=str(repo), thread_id="t-skel", scope="project_diff",
    )
    skel_findings = [
        f for f in review["findings"]
        if f["category"] == "tests" and f.get("fix", {}).get("kind") == "create_test_skeleton"
    ]
    assert len(skel_findings) == 1

    applied = CodingReviewService.apply_fix(
        thread_id="t-skel", review_id=review["review_id"], finding_id=skel_findings[0]["id"],
    )
    assert applied["applied"] is True
    test_file = repo / "tests" / "test_feature.py"
    assert test_file.is_file()
    content = test_file.read_text(encoding="utf-8")
    assert "pytest.mark.skip" in content
    assert "def test_feature_skeleton" in content
    assert "from feature import feature" in content


def test_apply_fix_refuses_to_overwrite_existing_test_file(tmp_path, monkeypatch) -> None:
    """New-file mode must fail if the target already exists (stale fix)."""
    from app.gateway.coding_review_services import CodingReviewService

    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    repo = tmp_path / "repo"
    repo.mkdir()
    _init_repo(repo)
    (repo / "feature.py").write_text("def f(): pass\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "initial")
    (repo / "feature.py").write_text("def f(): return 1\n", encoding="utf-8")

    review = CodingReviewService.run_review(
        project_id="p1", project_root=str(repo), thread_id="t-skel2", scope="project_diff",
    )
    skel = next(
        f for f in review["findings"]
        if f.get("fix", {}).get("kind") == "create_test_skeleton"
    )
    # Manually create the target file so the fix is now stale.
    (repo / "tests").mkdir(parents=True)
    (repo / "tests" / "test_feature.py").write_text("# manual\n", encoding="utf-8")

    import pytest

    with pytest.raises(ValueError, match="already exists"):
        CodingReviewService.apply_fix(
            thread_id="t-skel2", review_id=review["review_id"], finding_id=skel["id"],
        )
