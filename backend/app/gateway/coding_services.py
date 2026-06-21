"""Service layer for the coding-agent project & worktree management.

``ProjectService`` persists registered coding projects as JSON in the
KKOCLAW data directory (``{base_dir}/coding/projects.json``).  Each project
record links a human-friendly name to an absolute filesystem path, optional
metadata, and a free-form config block.

``WorktreeService`` wraps ``git worktree`` subcommands via ``subprocess`` so
the REST layer never needs to shell out directly.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from kkoclaw.config.paths import get_paths

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PROJECTS_DIR = "coding"
_PROJECTS_FILE = "projects.json"
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\- ]{0,62}$")
_MAX_NAME_LEN = 64


def _utc_now_iso() -> str:
    """Return the current UTC timestamp in ISO-8601."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _generate_id() -> str:
    """Generate a short unique project identifier."""
    return uuid.uuid4().hex[:12]


def _validate_project_name(name: str) -> str:
    """Validate a project name, returning the stripped value."""
    name = name.strip()
    if not name or len(name) > _MAX_NAME_LEN or not _SAFE_NAME_RE.match(name):
        raise ValueError(
            f"Invalid project name {name!r}: must be 1-{_MAX_NAME_LEN} chars, "
            "start with an alphanumeric character, and contain only letters, "
            "digits, spaces, hyphens, underscores, or dots."
        )
    return name


# ---------------------------------------------------------------------------
# ProjectService
# ---------------------------------------------------------------------------


class ProjectService:
    """CRUD service for registered coding projects.

    Projects are persisted as a JSON file in the KKOCLAW data directory.
    The service is designed as a *stateless* collection of class-methods
    that read/write the file on each call — this keeps the API layer
    trivially stateless and avoids stale caches.
    """

    @classmethod
    def _projects_dir(cls) -> Path:
        """Return the directory where ``projects.json`` lives."""
        d = get_paths().base_dir / _PROJECTS_DIR
        d.mkdir(parents=True, exist_ok=True)
        return d

    @classmethod
    def _projects_file(cls) -> Path:
        """Return the full path to ``projects.json``."""
        return cls._projects_dir() / _PROJECTS_FILE

    @classmethod
    def _load_all(cls) -> dict[str, dict[str, Any]]:
        """Load the raw projects mapping from disk."""
        f = cls._projects_file()
        if not f.exists():
            return {}
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to read %s: %s — starting empty", f, exc)
            return {}
        if not isinstance(data, dict):
            return {}
        return data

    @classmethod
    def _save_all(cls, data: dict[str, dict[str, Any]]) -> None:
        """Persist the projects mapping to disk."""
        f = cls._projects_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(f)

    # -- public API --------------------------------------------------------

    @classmethod
    def list_projects(cls) -> list[dict[str, Any]]:
        """Return all registered projects as a list of dicts."""
        data = cls._load_all()
        return list(data.values())

    @classmethod
    def get_project(cls, project_id: str) -> dict[str, Any] | None:
        """Return a single project dict by id, or ``None`` if not found."""
        return cls._load_all().get(project_id)

    @classmethod
    def create_project(
        cls,
        *,
        name: str,
        path: str,
        description: str = "",
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Register a new coding project.

        Raises ``ValueError`` if the name is invalid or the path does not
        point to an existing directory.
        """
        name = _validate_project_name(name)
        resolved = Path(path).expanduser().resolve()
        if not resolved.is_dir():
            raise ValueError(f"Project path does not exist or is not a directory: {resolved}")

        # Reject duplicate names (case-insensitive)
        existing = cls._load_all()
        for proj in existing.values():
            if proj.get("name", "").lower() == name.lower():
                raise ValueError(f"A project named {name!r} already exists")

        project_id = _generate_id()
        now = _utc_now_iso()
        record: dict[str, Any] = {
            "id": project_id,
            "name": name,
            "path": str(resolved),
            "description": description.strip(),
            "config": config or {},
            "is_git_repo": _is_git_repo(resolved),
            "created_at": now,
            "updated_at": now,
        }
        existing[project_id] = record
        cls._save_all(existing)
        logger.info("Created coding project %s (%s) -> %s", project_id, name, resolved)
        return record

    @classmethod
    def update_project(
        cls,
        project_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Update mutable fields of an existing project."""
        data = cls._load_all()
        proj = data.get(project_id)
        if proj is None:
            raise KeyError(f"Project {project_id!r} not found")

        if name is not None:
            new_name = _validate_project_name(name)
            # Check for duplicate names excluding self
            for pid, other in data.items():
                if pid != project_id and other.get("name", "").lower() == new_name.lower():
                    raise ValueError(f"A project named {new_name!r} already exists")
            proj["name"] = new_name

        if description is not None:
            proj["description"] = description.strip()

        if config is not None:
            # Merge rather than replace so partial updates are safe
            merged = {**proj.get("config", {}), **config}
            proj["config"] = merged

        proj["updated_at"] = _utc_now_iso()
        data[project_id] = proj
        cls._save_all(data)
        return proj

    @classmethod
    def delete_project(cls, project_id: str) -> bool:
        """Remove a project registration.  Returns ``True`` if deleted."""
        data = cls._load_all()
        if project_id not in data:
            return False
        del data[project_id]
        cls._save_all(data)
        logger.info("Deleted coding project %s", project_id)
        return True


# ---------------------------------------------------------------------------
# WorktreeService
# ---------------------------------------------------------------------------


def _run_git(cwd: str, args: list[str]) -> tuple[int, str, str]:
    """Run a git command and return (returncode, stdout, stderr)."""
    cmd = ["git", *args]
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except FileNotFoundError:
        return -1, "", "git executable not found"
    except subprocess.TimeoutExpired:
        return -2, "", "git command timed out"


def _run_command(cwd: str, args: list[str], timeout: int = 30) -> tuple[int, str, str]:
    """Run a generic command and return (returncode, stdout, stderr)."""
    try:
        proc = subprocess.run(
            args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except FileNotFoundError:
        executable = args[0] if args else "command"
        return -1, "", f"{executable} executable not found"
    except subprocess.TimeoutExpired:
        return -2, "", "command timed out"


def _is_git_repo(path: Path) -> bool:
    """Return True if *path* is inside a git working tree."""
    rc, _, _ = _run_git(str(path), ["rev-parse", "--is-inside-work-tree"])
    return rc == 0


def _get_repo_root(path: str) -> str:
    """Return the absolute repo root for *path*."""
    rc, out, _ = _run_git(path, ["rev-parse", "--show-toplevel"])
    if rc != 0:
        raise ValueError(f"Not a git repository: {path}")
    return out.strip()


def _git_current_branch(repo_root: str) -> str:
    """Return the current branch name for *repo_root*."""
    rc, out, err = _run_git(repo_root, ["rev-parse", "--abbrev-ref", "HEAD"])
    if rc != 0:
        raise RuntimeError(f"git rev-parse failed: {err.strip()}")
    return out.strip()


def _git_head_sha(repo_root: str) -> str:
    """Return the current HEAD SHA."""
    rc, out, err = _run_git(repo_root, ["rev-parse", "HEAD"])
    if rc != 0:
        raise RuntimeError(f"git rev-parse HEAD failed: {err.strip()}")
    return out.strip()


def _git_upstream_branch(repo_root: str) -> str | None:
    """Return the upstream ref for the current branch if configured."""
    rc, out, _err = _run_git(repo_root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
    if rc != 0:
        return None
    value = out.strip()
    return value or None


def _git_ahead_behind(repo_root: str, upstream: str | None) -> tuple[int, int]:
    """Return (ahead, behind) relative to upstream."""
    if not upstream:
        return (0, 0)
    rc, out, err = _run_git(repo_root, ["rev-list", "--left-right", "--count", f"{upstream}...HEAD"])
    if rc != 0:
        raise RuntimeError(f"git rev-list failed: {err.strip()}")
    parts = out.strip().split()
    if len(parts) != 2:
        return (0, 0)
    behind = int(parts[0] or 0)
    ahead = int(parts[1] or 0)
    return (ahead, behind)


def _git_remote_url(repo_root: str, remote_name: str) -> str | None:
    """Return the URL for a git remote."""
    rc, out, _err = _run_git(repo_root, ["remote", "get-url", remote_name])
    if rc != 0:
        return None
    value = out.strip()
    return value or None


def _infer_source_label(remote_url: str | None) -> str:
    """Infer a human-facing source label from a remote URL."""
    if not remote_url:
        return "仅本地"
    lowered = remote_url.lower()
    if "github.com" in lowered:
        return "GitHub"
    if "gitlab" in lowered:
        return "GitLab"
    if "bitbucket" in lowered:
        return "Bitbucket"
    return "远程仓库"


def _gh_auth_status(repo_root: str) -> dict[str, Any]:
    """Return GitHub CLI availability and auth state."""
    rc, out, err = _run_command(
        repo_root,
        ["gh", "auth", "status", "--hostname", "github.com"],
    )
    combined = "\n".join(part.strip() for part in (out, err) if part.strip()).strip()
    if rc == -1:
        return {
            "available": False,
            "authenticated": False,
            "username": None,
            "host": None,
            "detail": "GitHub CLI 未安装",
        }

    username_match = re.search(r"account\s+([^\s]+)", combined, re.IGNORECASE)
    host_match = re.search(r"github\.com", combined, re.IGNORECASE)
    authenticated = rc == 0
    if not authenticated and "not logged into any accounts" in combined.lower():
        detail = "未登录 GitHub CLI"
    elif authenticated:
        detail = "已连接 GitHub CLI"
    else:
        detail = combined.splitlines()[0] if combined else "GitHub CLI 状态未知"
    return {
        "available": True,
        "authenticated": authenticated,
        "username": username_match.group(1) if username_match else None,
        "host": "github.com" if host_match else None,
        "detail": detail,
    }


def _git_changed_files(repo_root: str) -> list[dict[str, Any]]:
    """Return working-tree changed files with status and line counts."""
    rc, out, err = _run_git(repo_root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    if rc != 0:
        raise RuntimeError(f"git status failed: {err.strip()}")

    stats = _git_numstat(repo_root)
    files: list[dict[str, Any]] = []
    records = [record for record in out.split("\0") if record]
    index = 0
    while index < len(records):
        record = records[index]
        code = record[:2]
        path = record[3:]
        status_code = code.strip()
        if status_code.startswith("R") or status_code.startswith("C"):
            old_path = path
            index += 1
            if index >= len(records):
                break
            path = records[index]
            file_status = "renamed" if status_code.startswith("R") else "copied"
            previous_path = old_path
        else:
            file_status = _git_status_label(status_code)
            previous_path = None

        stat = stats.get(path, stats.get(previous_path or "", {"additions": 0, "deletions": 0}))
        if status_code == "??" and stat["additions"] == 0 and stat["deletions"] == 0:
            stat = _untracked_file_stat(repo_root, path)
        files.append(
            {
                "path": path,
                "status": file_status,
                "additions": stat["additions"],
                "deletions": stat["deletions"],
                **({"previous_path": previous_path} if previous_path else {}),
            }
        )
        index += 1

    files.sort(key=lambda item: item["path"].lower())
    return files


def _git_status_label(status_code: str) -> str:
    """Map porcelain status codes to UI-facing status labels."""
    if status_code == "??" or "A" in status_code:
        return "added"
    if "D" in status_code:
        return "deleted"
    if "R" in status_code:
        return "renamed"
    if "C" in status_code:
        return "copied"
    return "modified"


def _git_numstat(repo_root: str) -> dict[str, dict[str, int]]:
    """Return ``git diff --numstat`` keyed by path."""
    rc, out, err = _run_git(repo_root, ["diff", "--numstat", "HEAD", "--"])
    if rc != 0:
        raise RuntimeError(f"git diff --numstat failed: {err.strip()}")

    stats: dict[str, dict[str, int]] = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        additions_raw, deletions_raw, path = parts[0], parts[1], parts[-1]
        stats[path] = {
            "additions": _parse_numstat_count(additions_raw),
            "deletions": _parse_numstat_count(deletions_raw),
        }
    return stats


def _parse_numstat_count(value: str) -> int:
    """Parse a numstat count, treating binary-file ``-`` as zero."""
    try:
        return int(value)
    except ValueError:
        return 0


def _git_unified_diff(repo_root: str) -> str:
    """Return unified diff including untracked files."""
    rc, out, err = _run_git(repo_root, ["diff", "--binary", "HEAD", "--"])
    if rc != 0:
        raise RuntimeError(f"git diff failed: {err.strip()}")
    untracked_diffs = [
        _untracked_file_diff(repo_root, file["path"])
        for file in _git_changed_files(repo_root)
        if file["status"] == "added"
    ]
    extra = "\n".join(chunk for chunk in untracked_diffs if chunk)
    if out and extra:
        return f"{out.rstrip()}\n{extra}\n"
    return out or extra


def _split_unified_diff_by_file(diff_text: str) -> dict[str, str]:
    """Return unified diff chunks keyed by their destination file path."""
    chunks: dict[str, str] = {}
    current_key: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        if current_key and current_lines:
            chunks[current_key] = "\n".join(current_lines).rstrip() + "\n"

    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            flush()
            current_lines = [line]
            current_key = _diff_header_destination_path(line)
            continue
        if current_key is not None:
            current_lines.append(line)
    flush()
    return chunks


def _diff_header_destination_path(header: str) -> str | None:
    match = re.match(r"^diff --git a/(.+) b/(.+)$", header)
    if not match:
        return None
    return match.group(2)


def _untracked_file_stat(repo_root: str, path: str) -> dict[str, int]:
    """Return line count for an untracked text file."""
    try:
        content = _read_untracked_text(repo_root, path)
    except ValueError:
        return {"additions": 0, "deletions": 0}
    return {"additions": len(content.splitlines()), "deletions": 0}


def _untracked_file_diff(repo_root: str, path: str) -> str:
    """Build a minimal unified diff for an untracked text file."""
    try:
        content = _read_untracked_text(repo_root, path)
    except ValueError:
        return ""
    lines = content.splitlines()
    body = "\n".join(f"+{line}" for line in lines)
    return (
        f"diff --git a/{path} b/{path}\n"
        "new file mode 100644\n"
        "index 0000000..0000000\n"
        "--- /dev/null\n"
        f"+++ b/{path}\n"
        f"@@ -0,0 +1,{len(lines)} @@\n"
        f"{body}\n"
    )


def _read_untracked_text(repo_root: str, path: str) -> str:
    """Read an untracked file safely inside *repo_root* as text."""
    base = Path(repo_root).resolve()
    target = (base / path).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise ValueError("Path is outside the repository") from None
    if not target.is_file():
        raise ValueError("Path is not a file")
    if target.stat().st_size > _MAX_FILE_SIZE:
        raise ValueError("File is too large for diff preview")
    raw = target.read_bytes()
    if b"\0" in raw:
        raise ValueError("Binary files are not rendered as text diffs")
    return raw.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# FileService — directory browsing & file reading for the web UI
# ---------------------------------------------------------------------------

_IGNORED_DIRS: set[str] = {
    ".git", "node_modules", ".venv", "venv", "env", "__pycache__",
    ".next", "dist", "build", ".kkoclaw", ".mypy_cache", ".pytest_cache",
    ".tox", ".eggs", ".sass-cache", ".turbo",
}

_MAX_FILE_SIZE = 512 * 1024  # 512 KB read limit

_EXT_LANGUAGE_MAP: dict[str, str] = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".mjs": "javascript",
    ".json": "json", ".md": "markdown", ".yaml": "yaml", ".yml": "yaml",
    ".html": "html", ".htm": "html", ".css": "css", ".scss": "scss",
    ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin",
    ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".sql": "sql", ".xml": "xml", ".toml": "toml", ".ini": "ini",
    ".rb": "ruby", ".php": "php", ".swift": "swift",
    ".vue": "vue", ".svelte": "svelte",
    ".dockerfile": "dockerfile", ".makefile": "makefile",
    ".txt": "text", ".log": "text", ".env": "ini",
}


class FileService:
    """Browse directories and read files within a registered project root."""

    @staticmethod
    def list_directory(project_path: str, subpath: str = ".") -> list[dict[str, Any]]:
        """List the contents of *subpath* relative to *project_path*.

        Returns a list of dicts: ``{"name", "path", "type", "size"}``.
        Directories are listed first, then files, each sorted alphabetically.
        """
        base = Path(project_path).resolve()
        target = (base / subpath).resolve()

        # Security: prevent path traversal outside the project root
        try:
            target.relative_to(base)
        except ValueError:
            raise ValueError("Path is outside the project root") from None

        if not target.is_dir():
            raise ValueError(f"Not a directory: {subpath}")

        entries: list[dict[str, Any]] = []
        for item in target.iterdir():
            if item.name in _IGNORED_DIRS:
                continue
            is_dir = item.is_dir()
            entries.append({
                "name": item.name,
                "path": str(item.relative_to(base)),
                "type": "directory" if is_dir else "file",
                "size": 0 if is_dir else item.stat().st_size,
                "ext": "" if is_dir else item.suffix.lower(),
            })

        entries.sort(key=lambda e: (e["type"] != "directory", e["name"].lower()))
        return entries

    @staticmethod
    def read_file(project_path: str, subpath: str) -> dict[str, Any]:
        """Read the content of *subpath* relative to *project_path*.

        Returns ``{"path", "content", "size", "language"}``.
        """
        base = Path(project_path).resolve()
        target = (base / subpath).resolve()

        try:
            target.relative_to(base)
        except ValueError:
            raise ValueError("Path is outside the project root") from None

        if not target.is_file():
            raise ValueError(f"Not a file: {subpath}")

        size = target.stat().st_size
        if size > _MAX_FILE_SIZE:
            raise ValueError(
                f"File too large ({size} bytes, max {_MAX_FILE_SIZE} bytes)"
            )

        content = target.read_text(encoding="utf-8", errors="replace")
        return {
            "path": subpath,
            "content": content,
            "size": size,
            "language": FileService.detect_language(target.name),
        }

    @staticmethod
    def detect_language(filename: str) -> str:
        """Return the language identifier for a filename based on extension."""
        name_lower = filename.lower()
        if name_lower in ("dockerfile",):
            return "dockerfile"
        if name_lower in ("makefile", "gnumakefile"):
            return "makefile"
        ext = Path(filename).suffix.lower()
        return _EXT_LANGUAGE_MAP.get(ext, "text")


class WorktreeService:
    """Thin wrapper around ``git worktree`` for project-scoped operations."""

    @staticmethod
    def list_worktrees(project_path: str) -> list[dict[str, str]]:
        """List all worktrees in the repository.

        Returns a list of dicts: ``{"path": ..., "branch": ..., "head": ..., "bare": bool}``
        """
        repo_root = _get_repo_root(project_path)
        rc, out, err = _run_git(repo_root, ["worktree", "list", "--porcelain"])
        if rc != 0:
            raise RuntimeError(f"git worktree list failed: {err}")

        results: list[dict[str, str]] = []
        current: dict[str, str] | None = None
        for line in out.splitlines():
            if not line:
                if current:
                    results.append(current)
                    current = None
                continue
            if line.startswith("worktree "):
                if current:
                    results.append(current)
                current = {"path": line[len("worktree "):]}
            elif line.startswith("HEAD ") and current is not None:
                current["head"] = line[len("HEAD "):]
            elif line.startswith("branch ") and current is not None:
                current["branch"] = line[len("branch "):]
            elif line == "bare" and current is not None:
                current["bare"] = "true"
            elif line == "detached" and current is not None:
                current["detached"] = "true"
        if current:
            results.append(current)
        return results

    @staticmethod
    def create_worktree(
        project_path: str,
        *,
        branch: str,
        base_branch: str | None = None,
        worktree_path: str | None = None,
    ) -> dict[str, str]:
        """Create a new git worktree.

        Args:
            project_path: Path inside the git repo.
            branch: New branch name for the worktree.
            base_branch: Starting point for the new branch (default: repo HEAD).
            worktree_path: Explicit path for the worktree. If omitted,
                           defaults to ``{repo_parent}/.worktrees/{branch}``.

        Returns metadata about the created worktree.
        """
        repo_root = _get_repo_root(project_path)
        repo_root_path = Path(repo_root)

        if not worktree_path:
            wt_dir = repo_root_path.parent / ".worktrees"
            wt_dir.mkdir(parents=True, exist_ok=True)
            worktree_path = str(wt_dir / branch)

        args = ["worktree", "add", "-b", branch, worktree_path]
        if base_branch:
            args.append(base_branch)

        rc, out, err = _run_git(repo_root, args)
        if rc != 0:
            raise RuntimeError(f"git worktree add failed: {err.strip()}")

        logger.info("Created worktree %s (branch %s) for %s", worktree_path, branch, repo_root)
        return {
            "path": worktree_path,
            "branch": branch,
            "base_branch": base_branch or "",
            "repo_root": repo_root,
        }

    @staticmethod
    def remove_worktree(
        project_path: str,
        *,
        worktree_path: str,
        force: bool = False,
        delete_branch: bool = False,
    ) -> dict[str, str]:
        """Remove a git worktree.

        Args:
            project_path: Path inside the git repo.
            worktree_path: Path of the worktree to remove.
            force: Force removal even if the worktree is dirty or locked.
            delete_branch: Also delete the associated branch after removing the worktree.
        """
        repo_root = _get_repo_root(project_path)

        args = ["worktree", "remove", worktree_path]
        if force:
            args.insert(2, "--force")

        rc, out, err = _run_git(repo_root, args)
        if rc != 0:
            raise RuntimeError(f"git worktree remove failed: {err.strip()}")

        deleted_branch = ""
        if delete_branch:
            # Extract branch name from the worktree path
            branch_name = Path(worktree_path).name
            rc2, _, err2 = _run_git(repo_root, ["branch", "-D", branch_name])
            if rc2 == 0:
                deleted_branch = branch_name
            else:
                logger.warning("Failed to delete branch %s: %s", branch_name, err2.strip())

        logger.info("Removed worktree %s from %s", worktree_path, repo_root)
        return {
            "path": worktree_path,
            "removed": "true",
            "deleted_branch": deleted_branch,
        }


class GitDiffService:
    """Read Git working-tree changes for a registered coding project."""

    @staticmethod
    def get_diff(project_path: str) -> dict[str, Any]:
        """Return changed files and unified diff for *project_path*.

        The diff is based on ``HEAD`` and includes unstaged, staged, and
        untracked files. Non-Git projects raise ``ValueError`` so callers can
        show a clear unsupported state.
        """
        try:
            repo_root = _get_repo_root(project_path)
        except ValueError:
            return {
                "is_git_repo": False,
                "has_changes": False,
                "files": [],
                "diff": "",
            }
        files = _git_changed_files(repo_root)
        diff = _git_unified_diff(repo_root)
        diffs_by_file = _split_unified_diff_by_file(diff)
        for file in files:
            file["diff"] = diffs_by_file.get(file["path"], "")
        return {
            "is_git_repo": True,
            "has_changes": bool(files),
            "files": files,
            "diff": diff,
        }

    @staticmethod
    def discard_file_change(project_path: str, file_path: str) -> dict[str, Any]:
        """Discard working-tree changes for one file inside *project_path*."""
        repo_root = _get_repo_root(project_path)
        relative_path = _validate_repo_relative_path(repo_root, file_path)
        rc, out, err = _run_git(
            repo_root,
            ["status", "--porcelain=v1", "--", relative_path],
        )
        if rc != 0:
            raise RuntimeError(f"git status failed: {err.strip()}")
        status = out[:2].strip()
        target = (Path(repo_root) / relative_path).resolve()

        if status == "??":
            if target.is_dir():
                raise ValueError("Refusing to discard untracked directory")
            if target.exists():
                target.unlink()
        else:
            rc, _out, err = _run_git(
                repo_root,
                ["restore", "--source=HEAD", "--staged", "--worktree", "--", relative_path],
            )
            if rc != 0:
                raise RuntimeError(f"git restore failed: {err.strip()}")

        return {"path": relative_path, "discarded": True}


class ProjectEnvironmentService:
    """Project-scoped git and GitHub CLI environment data."""

    @staticmethod
    def get_environment(project_path: str) -> dict[str, Any]:
        """Return git environment summary for a project."""
        try:
            repo_root = _get_repo_root(project_path)
        except ValueError:
            return {
                "is_git_repo": False,
                "branch": None,
                "head": None,
                "upstream": None,
                "ahead": 0,
                "behind": 0,
                "changed_files": 0,
                "additions": 0,
                "deletions": 0,
                "github_cli": _gh_auth_status(project_path),
                "source": {
                    "label": "仅本地",
                    "remote": None,
                    "provider": "local",
                },
            }

        files = _git_changed_files(repo_root)
        upstream = _git_upstream_branch(repo_root)
        ahead, behind = _git_ahead_behind(repo_root, upstream)
        remote_name = upstream.split("/", 1)[0] if upstream and "/" in upstream else "origin"
        remote_url = _git_remote_url(repo_root, remote_name)
        provider_label = _infer_source_label(remote_url)
        provider_key = "github" if provider_label == "GitHub" else "local" if remote_url is None else "remote"
        return {
            "is_git_repo": True,
            "branch": _git_current_branch(repo_root),
            "head": _git_head_sha(repo_root),
            "upstream": upstream,
            "ahead": ahead,
            "behind": behind,
            "changed_files": len(files),
            "additions": sum(int(file.get("additions", 0)) for file in files),
            "deletions": sum(int(file.get("deletions", 0)) for file in files),
            "github_cli": _gh_auth_status(repo_root),
            "source": {
                "label": provider_label,
                "remote": remote_url,
                "provider": provider_key,
            },
        }

    @staticmethod
    def commit_changes(project_path: str, message: str) -> dict[str, Any]:
        """Create a commit for all current tracked/untracked changes."""
        repo_root = _get_repo_root(project_path)
        commit_message = message.strip()
        if not commit_message:
            raise ValueError("Commit message is required")

        files = _git_changed_files(repo_root)
        if not files:
            raise ValueError("No changes available to commit")

        rc, _out, err = _run_git(repo_root, ["add", "-A"])
        if rc != 0:
            raise RuntimeError(f"git add failed: {err.strip()}")

        rc, out, err = _run_git(repo_root, ["commit", "-m", commit_message])
        if rc != 0:
            raise RuntimeError(f"git commit failed: {err.strip()}")

        head = _git_head_sha(repo_root)
        summary = next((line.strip() for line in out.splitlines() if line.strip()), "提交完成")
        return {
            "head": head,
            "summary": summary,
            "message": commit_message,
        }

    @staticmethod
    def push_branch(project_path: str) -> dict[str, Any]:
        """Push the current branch to its remote."""
        repo_root = _get_repo_root(project_path)
        branch = _git_current_branch(repo_root)
        upstream = _git_upstream_branch(repo_root)
        if upstream:
            args = ["push"]
        else:
            args = ["push", "--set-upstream", "origin", branch]

        rc, out, err = _run_git(repo_root, args)
        if rc != 0:
            raise RuntimeError(f"git push failed: {err.strip()}")

        upstream = _git_upstream_branch(repo_root)
        summary = next((line.strip() for line in (out + "\n" + err).splitlines() if line.strip()), "推送完成")
        return {
            "branch": branch,
            "upstream": upstream,
            "summary": summary,
        }


def _validate_repo_relative_path(repo_root: str, file_path: str) -> str:
    """Return a safe repo-relative path or raise ValueError."""
    if not file_path or Path(file_path).is_absolute():
        raise ValueError("Path must be relative to the repository")
    root = Path(repo_root).resolve()
    target = (root / file_path).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise ValueError("Path is outside the repository") from None
    return target.relative_to(root).as_posix()
