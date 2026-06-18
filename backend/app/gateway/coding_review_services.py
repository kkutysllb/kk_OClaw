"""Gateway service for Qiongqi-backed Coding code reviews."""

from __future__ import annotations

import difflib
import json
import re
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.gateway.coding_services import GitDiffService
from kkoclaw.coding_core.change_tracking import QiongqiChangeTracker
from kkoclaw.coding_core.session_store import QiongqiSessionStore

_SECRET_RE = re.compile(
    r"(?i)(password|passwd|secret|api[_-]?key|token|private[_-]?key)\s*[:=]\s*['\"][^'\"]{4,}['\"]"
)
_HIGH_RISK_PATH_RE = re.compile(
    r"(?i)(auth|login|permission|policy|security|csrf|jwt|oauth|payment|billing|database|migration|router|middleware|config|env)"
)
_PY_SECRET_ASSIGN_RE = re.compile(
    r"^(?P<indent>\s*)(?P<name>(?=[A-Za-z_][A-Za-z0-9_]*)(?=[A-Za-z0-9_]*(?:password|passwd|secret|token|api_key|apikey|private_key))[A-Za-z_][A-Za-z0-9_]*)\s*=\s*['\"][^'\"]{4,}['\"]\s*$",
    re.IGNORECASE,
)


class CodingReviewService:
    """Build and persist structured code review snapshots."""

    @classmethod
    def run_review(
        cls,
        *,
        project_id: str,
        project_root: str,
        thread_id: str,
        scope: str = "project_diff",
        base_ref: str | None = None,
    ) -> dict[str, Any]:
        if scope == "pr":
            repo_root = _git_output(project_root, ["rev-parse", "--show-toplevel"])
            resolved_base_ref = _resolve_pr_base_ref(repo_root, base_ref)
            project_diff = _get_pr_diff(repo_root, resolved_base_ref)
            pr_context = _get_pr_context(
                repo_root,
                resolved_base_ref,
                requested_base_ref=base_ref,
            )
        else:
            project_diff = GitDiffService.get_diff(project_root)
            pr_context = None
        store = QiongqiSessionStore.from_home()
        changes = QiongqiChangeTracker(store).list_changes(thread_id)
        events = store.list_events(thread_id, limit=200)

        findings = _build_findings(
            project_root=project_root,
            diff_files=project_diff.get("files", []),
            task_changes=changes,
            events=events,
        )
        summary = _build_summary(
            diff_files=project_diff.get("files", []),
            task_changes=changes,
            events=events,
            findings=findings,
            pr_context=pr_context,
        )
        review_id = uuid.uuid4().hex[:12]
        review = {
            "review_id": review_id,
            "project_id": project_id,
            "project_root": project_root,
            "thread_id": thread_id,
            "scope": scope,
            "decision": _decision_for_findings(findings),
            "summary": summary,
            "findings": findings,
            "source": {
                "diff_files": project_diff.get("files", []),
                "task_changes": changes,
                "events": events,
                **({"pr_context": pr_context} if pr_context else {}),
            },
            "created_at": datetime.now(UTC).isoformat(),
            "next_plan": [
                "自动修复建议与一键应用",
                "PR 级复杂审查与跨提交上下文",
            ],
        }
        _persist_review(store, thread_id, review)
        return review

    @classmethod
    def get_latest_review(cls, thread_id: str) -> dict[str, Any] | None:
        review_dir = QiongqiSessionStore.from_home().session_dir(thread_id) / "reviews"
        if not review_dir.is_dir():
            return None
        reviews: list[dict[str, Any]] = []
        for path in review_dir.glob("*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                reviews.append(payload)
        if not reviews:
            return None
        reviews.sort(key=lambda item: str(item.get("created_at") or ""))
        return reviews[-1]

    @classmethod
    def apply_fix(cls, *, thread_id: str, review_id: str, finding_id: str) -> dict[str, Any]:
        store = QiongqiSessionStore.from_home()
        review = _read_review(store, thread_id, review_id)
        finding = next((item for item in review.get("findings", []) if item.get("id") == finding_id), None)
        if not isinstance(finding, dict):
            raise ValueError(f"Review finding {finding_id!r} not found")
        fix = finding.get("fix")
        if not isinstance(fix, dict) or not fix.get("applicable"):
            raise ValueError("Finding does not have an applicable automatic fix")
        file_path = finding.get("file")
        if not isinstance(file_path, str) or not file_path:
            raise ValueError("Finding fix requires a file path")

        project_root = str(review.get("project_root") or "")
        target = _safe_project_file(project_root, file_path)
        before = target.read_text(encoding="utf-8")
        expected = str(fix.get("expected") or "")
        replacement = str(fix.get("replacement") or "")
        if expected not in before:
            raise ValueError("Automatic fix is stale; expected text no longer exists")
        after = before.replace(expected, replacement, 1)
        target.write_text(after, encoding="utf-8")

        finding["fix"]["applied"] = True
        finding["fix"]["applied_at"] = datetime.now(UTC).isoformat()
        review["updated_at"] = datetime.now(UTC).isoformat()
        _persist_review(store, thread_id, review)
        return {
            "thread_id": thread_id,
            "review_id": review_id,
            "finding_id": finding_id,
            "file": file_path,
            "applied": True,
        }


def _build_findings(
    *,
    project_root: str,
    diff_files: list[dict[str, Any]],
    task_changes: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    task_by_path = {str(change.get("path")): change for change in task_changes}

    for diff_file in diff_files:
        path = str(diff_file.get("path") or "")
        diff = str(diff_file.get("diff") or "")
        task = task_by_path.get(path)
        if _SECRET_RE.search(diff):
            fix = _build_secret_fix(project_root=project_root, path=path)
            findings.append(
                _finding(
                    severity="critical",
                    category="security",
                    file=path,
                    task_id=task.get("task_id") if task else None,
                    message="疑似硬编码 secret/token/password 出现在变更中。",
                    suggestion="移除硬编码敏感信息，改为从安全配置或 secret manager 读取，并轮换已经暴露的凭据。",
                    fix=fix,
                )
            )
        if _HIGH_RISK_PATH_RE.search(path) and (diff_file.get("additions", 0) or diff_file.get("deletions", 0)):
            findings.append(
                _finding(
                    severity="major",
                    category="risk",
                    file=path,
                    task_id=task.get("task_id") if task else None,
                    message="变更命中认证、权限、配置、路由或数据相关高风险路径。",
                    suggestion="确认已有对应测试或人工复核边界条件，重点检查权限绕过、路径穿越和配置泄露。",
                )
            )
        if int(diff_file.get("additions") or 0) + int(diff_file.get("deletions") or 0) >= 250:
            findings.append(
                _finding(
                    severity="minor",
                    category="maintainability",
                    file=path,
                    task_id=task.get("task_id") if task else None,
                    message="单文件变更较大，审查成本和回归风险上升。",
                    suggestion="优先按行为边界拆分审查，并确认关键路径有测试覆盖。",
                )
            )

    if diff_files and not _has_test_signal(diff_files, events):
        findings.append(
            _finding(
                severity="minor",
                category="tests",
                file=None,
                task_id=None,
                message="未看到测试文件变更或 Qiongqi 测试运行事件。",
                suggestion="在合并前运行相关测试；如果是行为变更，补充覆盖本次 diff 的回归测试。",
            )
        )

    findings.sort(key=lambda item: _severity_rank(str(item["severity"])))
    return findings


def _finding(
    *,
    severity: str,
    category: str,
    file: str | None,
    task_id: str | None,
    message: str,
    suggestion: str,
    fix: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex[:10],
        "severity": severity,
        "category": category,
        "file": file,
        "line": None,
        "task_id": task_id,
        "message": message,
        "suggestion": suggestion,
        "evidence": [],
        "fix": fix
        or {
            "applicable": False,
            "kind": None,
            "description": "",
            "patch": "",
            "applied": False,
        },
    }


def _build_summary(
    *,
    diff_files: list[dict[str, Any]],
    task_changes: list[dict[str, Any]],
    events: list[dict[str, Any]],
    findings: list[dict[str, Any]],
    pr_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    counts = {"critical": 0, "major": 0, "minor": 0, "nitpick": 0}
    for finding in findings:
        severity = str(finding.get("severity") or "")
        if severity in counts:
            counts[severity] += 1
    return {
        "project_files": len(diff_files),
        "task_changes": len(task_changes),
        "qiongqi_events": len(events),
        "additions": sum(int(file.get("additions") or 0) for file in diff_files),
        "deletions": sum(int(file.get("deletions") or 0) for file in diff_files),
        "commits": len(pr_context.get("commits", [])) if pr_context else 0,
        **counts,
    }


def _decision_for_findings(findings: list[dict[str, Any]]) -> str:
    severities = {str(finding.get("severity") or "") for finding in findings}
    if "critical" in severities:
        return "request_changes"
    if "major" in severities:
        return "needs_review"
    return "pass"


def _has_test_signal(diff_files: list[dict[str, Any]], events: list[dict[str, Any]]) -> bool:
    if any(_looks_like_test_path(str(file.get("path") or "")) for file in diff_files):
        return True
    for event in events:
        payload = event.get("payload") if isinstance(event, dict) else None
        payload_text = json.dumps(payload, ensure_ascii=False) if isinstance(payload, dict) else ""
        if "test" in str(event.get("event_type") or "").lower() or "pytest" in payload_text or "test" in payload_text.lower():
            return True
    return False


def _looks_like_test_path(path: str) -> bool:
    lowered = path.lower()
    return "/test" in lowered or "test_" in lowered or "_test." in lowered or lowered.startswith("tests/")


def _severity_rank(severity: str) -> int:
    return {"critical": 0, "major": 1, "minor": 2, "nitpick": 3}.get(severity, 9)


def _build_secret_fix(*, project_root: str, path: str) -> dict[str, Any]:
    if not path.endswith(".py"):
        return {
            "applicable": False,
            "kind": None,
            "description": "仅支持 Python 单行 secret 赋值的自动修复。",
            "patch": "",
            "applied": False,
        }
    try:
        target = _safe_project_file(project_root, path)
        before = target.read_text(encoding="utf-8")
    except (OSError, ValueError):
        return {
            "applicable": False,
            "kind": None,
            "description": "无法安全读取目标文件。",
            "patch": "",
            "applied": False,
        }
    lines = before.splitlines(keepends=True)
    for index, line in enumerate(lines):
        match = _PY_SECRET_ASSIGN_RE.match(line.rstrip("\n"))
        if not match:
            continue
        env_name = _env_name(match.group("name"))
        replacement_line = f'{match.group("indent")}{match.group("name")} = os.environ.get("{env_name}", "")\n'
        next_lines = list(lines)
        next_lines[index] = replacement_line
        if not any(existing.startswith("import os") or existing.startswith("from os ") for existing in next_lines):
            insert_at = 0
            if next_lines and next_lines[0].startswith("#!"):
                insert_at = 1
            next_lines.insert(insert_at, "import os\n")
        after = "".join(next_lines)
        patch = "".join(
            difflib.unified_diff(
                before.splitlines(keepends=True),
                after.splitlines(keepends=True),
                fromfile=f"a/{path}",
                tofile=f"b/{path}",
            )
        )
        return {
            "applicable": True,
            "kind": "replace_python_secret_with_env",
            "description": f"将硬编码 secret 改为读取环境变量 {env_name}。",
            "patch": patch,
            "expected": before,
            "replacement": after,
            "applied": False,
        }
    return {
        "applicable": False,
        "kind": None,
        "description": "未找到可安全自动替换的 Python secret 赋值。",
        "patch": "",
        "applied": False,
    }


def _env_name(name: str) -> str:
    chars: list[str] = []
    previous_lower = False
    for char in name:
        if char.isupper() and previous_lower:
            chars.append("_")
        if char.isalnum():
            chars.append(char.upper())
            previous_lower = char.islower()
        else:
            chars.append("_")
            previous_lower = False
    return re.sub(r"_+", "_", "".join(chars)).strip("_")


def _safe_project_file(project_root: str, path: str) -> Path:
    root = Path(project_root).expanduser().resolve()
    target = (root / path).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise ValueError("Fix target is outside the project root") from None
    if not target.is_file():
        raise ValueError(f"Fix target is not a file: {path}")
    return target


def _get_pr_context(
    project_root: str,
    base_ref: str,
    *,
    requested_base_ref: str | None = None,
) -> dict[str, Any]:
    repo_root = _git_output(project_root, ["rev-parse", "--show-toplevel"])
    merge_base = _git_output(repo_root, ["merge-base", base_ref, "HEAD"])
    log = _git_output(repo_root, ["log", "--format=%H%x09%s", f"{merge_base}..HEAD"])
    commits = []
    for line in log.splitlines():
        if not line.strip():
            continue
        sha, _, subject = line.partition("\t")
        commits.append({"sha": sha, "subject": subject})
    return {
        "base_ref": base_ref,
        "requested_base_ref": requested_base_ref,
        "merge_base": merge_base,
        "head": _git_output(repo_root, ["rev-parse", "HEAD"]),
        "commits": commits,
    }


def _get_pr_diff(project_root: str, base_ref: str) -> dict[str, Any]:
    repo_root = _git_output(project_root, ["rev-parse", "--show-toplevel"])
    merge_base = _git_output(repo_root, ["merge-base", base_ref, "HEAD"])
    diff = _git_output(repo_root, ["diff", "--binary", merge_base, "HEAD", "--"])
    numstat = _git_output(repo_root, ["diff", "--numstat", merge_base, "HEAD", "--"])
    files = []
    chunks = _split_unified_diff_by_file(diff)
    for line in numstat.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        path = parts[-1]
        files.append(
            {
                "path": path,
                "status": "modified",
                "additions": _parse_count(parts[0]),
                "deletions": _parse_count(parts[1]),
                "diff": chunks.get(path, ""),
            }
        )
    return {
        "is_git_repo": True,
        "has_changes": bool(files),
        "files": files,
        "diff": diff,
    }


def _resolve_pr_base_ref(repo_root: str, requested_base_ref: str | None) -> str:
    candidates = []
    if requested_base_ref:
        candidates.append(requested_base_ref)
    candidates.extend(
        [
            "main",
            "master",
            "origin/main",
            "origin/master",
        ]
    )

    current_branch = _git_output(repo_root, ["rev-parse", "--abbrev-ref", "HEAD"])
    for candidate in candidates:
        if candidate == current_branch:
            continue
        if _git_ref_exists(repo_root, candidate) and _git_merge_base_exists(repo_root, candidate):
            return candidate

    available = _git_output(repo_root, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"])
    raise RuntimeError(
        "Unable to resolve PR base ref. "
        f"Requested: {requested_base_ref or 'auto'}; available refs: {available or '(none)'}"
    )


def _git_ref_exists(repo_root: str, ref: str) -> bool:
    proc = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", ref],
        cwd=repo_root,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return proc.returncode == 0


def _git_merge_base_exists(repo_root: str, ref: str) -> bool:
    proc = subprocess.run(
        ["git", "merge-base", ref, "HEAD"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return proc.returncode == 0


def _split_unified_diff_by_file(diff_text: str) -> dict[str, str]:
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
            match = re.match(r"^diff --git a/(.+) b/(.+)$", line)
            current_key = match.group(2) if match else None
            continue
        if current_key is not None:
            current_lines.append(line)
    flush()
    return chunks


def _parse_count(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return 0


def _git_output(cwd: str, args: list[str]) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"git {' '.join(args)} failed")
    return proc.stdout.strip()


def _read_review(store: QiongqiSessionStore, thread_id: str, review_id: str) -> dict[str, Any]:
    path = store.session_dir(thread_id) / "reviews" / f"{review_id}.json"
    if not path.is_file():
        raise ValueError(f"Review {review_id!r} not found")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Review {review_id!r} is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"Review {review_id!r} is invalid")
    return payload


def _persist_review(store: QiongqiSessionStore, thread_id: str, review: dict[str, Any]) -> None:
    review_dir = store.session_dir(thread_id) / "reviews"
    review_dir.mkdir(parents=True, exist_ok=True)
    path = review_dir / f"{review['review_id']}.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(review, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)
