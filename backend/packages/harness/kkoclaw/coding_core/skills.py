"""Coding-specific skill discovery.

This registry is intentionally separate from ``kkoclaw.skills`` so Coding Agent
does not inherit lead-agent or task-global skill state.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import yaml

from kkoclaw.coding_core.paths import coding_home

logger = logging.getLogger(__name__)

# Relative suffix appended to a project root for project-scoped coding skills.
# The GLOBAL root is resolved via ``coding_home() / "skills"`` (see ``discover``)
# so the desktop shell redirects to ``~/.oclaw-coding-desktop/skills``.
CODING_SKILLS_DIR = ".oclaw-coding/skills"
SKILL_MD_FILE = "SKILL.md"
SKILL_JSON_FILE = "skill.json"


@dataclass(frozen=True)
class CodingSkill:
    id: str
    name: str
    description: str
    skill_dir: Path
    skill_file: Path
    scope: Literal["project", "global"]
    legacy: bool = False
    activation_keywords: tuple[str, ...] = ()
    always_activate: bool = False
    allowed_tools: tuple[str, ...] = ()
    permissions: dict[str, object] | None = None
    enabled: bool = True
    manifest_errors: tuple[str, ...] = ()
    commands: tuple[dict[str, str], ...] = ()
    ui: dict[str, object] | None = None


@dataclass(frozen=True)
class ActiveCodingSkill:
    skill: CodingSkill
    instructions: str


class CodingSkillRegistry:
    """Discover Coding-only skills from project and user Coding roots."""

    @classmethod
    def discover(cls, project_root: str | None = None) -> list[CodingSkill]:
        roots: list[tuple[Path, Literal["project", "global"]]] = []
        if project_root:
            roots.append((Path(project_root) / CODING_SKILLS_DIR, "project"))
        roots.append((coding_home() / "skills", "global"))
        builtin_root = _builtin_coding_skills_root()
        if builtin_root is not None:
            roots.append((builtin_root, "global"))

        discovered: list[CodingSkill] = []
        seen_ids: set[str] = set()
        for root, scope in roots:
            for skill in cls._discover_root(root, scope):
                if skill.id in seen_ids:
                    continue
                seen_ids.add(skill.id)
                discovered.append(_apply_enabled_state(skill, project_root=project_root))
        return discovered

    @classmethod
    def _discover_root(cls, root: Path, scope: Literal["project", "global"]) -> list[CodingSkill]:
        if not root.is_dir():
            return []

        skills: list[CodingSkill] = []
        for skill_dir in sorted(path for path in root.iterdir() if path.is_dir()):
            skill = cls._parse_skill_dir(skill_dir, scope)
            if skill is not None:
                skills.append(skill)
        return skills

    @classmethod
    def _parse_skill_dir(cls, skill_dir: Path, scope: Literal["project", "global"]) -> CodingSkill | None:
        manifest_file = skill_dir / SKILL_JSON_FILE
        if manifest_file.is_file():
            manifest_skill = cls._parse_manifest_skill(skill_dir, manifest_file, scope)
            if manifest_skill is not None:
                return manifest_skill

        skill_file = skill_dir / SKILL_MD_FILE
        if skill_file.is_file():
            return cls._parse_legacy_skill(skill_dir, skill_file, scope)
        return None

    @classmethod
    def _parse_manifest_skill(
        cls,
        skill_dir: Path,
        manifest_file: Path,
        scope: Literal["project", "global"],
    ) -> CodingSkill | None:
        try:
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to parse Coding skill manifest %s: %s", manifest_file, exc)
            return None
        if not isinstance(manifest, dict):
            return None

        raw_entry = manifest.get("entry") or SKILL_MD_FILE
        errors: list[str] = []

        skill_id = _clean_id(manifest.get("id"))
        if skill_id is None:
            errors.append("id must start with a letter or digit and contain only letters, digits, dot, underscore, or hyphen")
            skill_id = _slug(skill_dir.name)
        name = _clean_text(manifest.get("name")) or skill_id
        description = _clean_text(manifest.get("description"))
        if not description:
            errors.append("description is required")
            description = ""

        if not isinstance(raw_entry, str) or not raw_entry.strip():
            errors.append("entry is required")
            skill_file = skill_dir / SKILL_MD_FILE
        else:
            raw_entry_path = Path(raw_entry.strip())
            if raw_entry_path.is_absolute() or ".." in raw_entry_path.parts:
                errors.append("entry must stay inside the skill directory")
                skill_file = skill_dir / SKILL_MD_FILE
            else:
                skill_file = skill_dir / raw_entry_path
        if not skill_file.is_file():
            errors.append("entry file does not exist")

        tools, tool_errors = _parse_tools_with_errors(manifest.get("tools"))
        errors.extend(tool_errors)
        permissions, permission_errors = _parse_permissions_with_errors(manifest.get("permissions"))
        errors.extend(permission_errors)

        return CodingSkill(
            id=skill_id,
            name=name,
            description=description,
            skill_dir=skill_dir,
            skill_file=skill_file,
            scope=scope,
            legacy=False,
            activation_keywords=_parse_activation_keywords(manifest.get("activation")),
            always_activate=_parse_activation_always(manifest.get("activation")),
            allowed_tools=tools if not errors else (),
            permissions=permissions if not errors else {},
            enabled=not errors,
            manifest_errors=tuple(errors),
            commands=_parse_commands(manifest.get("commands")),
            ui=_parse_ui(manifest.get("ui")),
        )

    @classmethod
    def _parse_legacy_skill(
        cls,
        skill_dir: Path,
        skill_file: Path,
        scope: Literal["project", "global"],
    ) -> CodingSkill | None:
        try:
            content = skill_file.read_text(encoding="utf-8")
        except Exception as exc:
            logger.warning("Failed to read Coding skill %s: %s", skill_file, exc)
            return None

        metadata = _parse_frontmatter(content)
        if metadata is None:
            return None

        skill_id = _slug(skill_dir.name)
        name = _clean_text(metadata.get("name")) or skill_id
        description = _clean_text(metadata.get("description"))
        if not skill_id or not description:
            return None

        return CodingSkill(
            id=skill_id,
            name=name,
            description=description,
            skill_dir=skill_dir,
            skill_file=skill_file,
            scope=scope,
            legacy=True,
            activation_keywords=_parse_legacy_keywords(metadata.get("activation") or metadata.get("keywords")),
            always_activate=bool(metadata.get("always", False)),
        )


class CodingSkillStateStore:
    """Persist Coding skill enablement under Coding-only roots."""

    def set_enabled(
        self,
        skill_id: str,
        *,
        scope: Literal["project", "global"],
        enabled: bool,
        project_root: str | None = None,
    ) -> dict:
        path = _state_file_for_scope(scope=scope, project_root=project_root)
        data = _read_state_file(path)
        skills = data.setdefault("skills", {})
        skills[_slug(skill_id)] = {"enabled": bool(enabled)}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return data

    def is_enabled(
        self,
        skill_id: str,
        *,
        scope: Literal["project", "global"],
        project_root: str | None = None,
        default: bool = True,
    ) -> bool:
        path = _state_file_for_scope(scope=scope, project_root=project_root)
        data = _read_state_file(path)
        skill_state = data.get("skills", {}).get(skill_id)
        if isinstance(skill_state, dict) and isinstance(skill_state.get("enabled"), bool):
            return bool(skill_state["enabled"])
        return default


def load_skill_instructions(skill: CodingSkill, *, max_chars: int = 12000) -> str:
    """Read bounded skill instructions from a Coding skill entry file."""
    try:
        content = skill.skill_file.read_text(encoding="utf-8")
    except Exception as exc:
        logger.warning("Failed to load Coding skill instructions %s: %s", skill.skill_file, exc)
        return ""

    body = _strip_frontmatter(content).strip()
    if len(body) > max_chars:
        return body[:max_chars].rstrip() + "\n\n[Instructions truncated]"
    return body


def _strip_frontmatter(content: str) -> str:
    return re.sub(r"^---\s*\n.*?\n---\s*(?:\n|$)", "", content, count=1, flags=re.DOTALL)


def _builtin_coding_skills_root() -> Path | None:
    try:
        from kkoclaw.config import get_app_config

        root = get_app_config().skills.get_skills_path() / "public" / "coding"
    except Exception:
        return None
    return root if root.is_dir() else None


def _parse_frontmatter(content: str) -> dict | None:
    match = re.match(r"^---\s*\n(.*?)\n---\s*(?:\n|$)", content, re.DOTALL)
    if not match:
        return None
    try:
        metadata = yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        return None
    return metadata if isinstance(metadata, dict) else None


def _clean_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _clean_id(value: object) -> str | None:
    text = _clean_text(value)
    if text is None:
        return None
    return _slug(text)


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip().lower()).strip("-._")
    return slug


def _parse_activation_keywords(raw: object) -> tuple[str, ...]:
    if not isinstance(raw, dict):
        return ()
    return _parse_string_list(raw.get("keywords"))


def _parse_activation_always(raw: object) -> bool:
    if not isinstance(raw, dict):
        return False
    return bool(raw.get("always", False))


def _parse_legacy_keywords(raw: object) -> tuple[str, ...]:
    if isinstance(raw, dict):
        return _parse_string_list(raw.get("keywords"))
    return _parse_string_list(raw)


def _parse_tools(raw: object) -> tuple[str, ...]:
    return _parse_string_list(raw)


def _parse_permissions(raw: object) -> dict[str, object] | None:
    return raw if isinstance(raw, dict) else None


def _parse_tools_with_errors(raw: object) -> tuple[tuple[str, ...], list[str]]:
    if raw is None:
        return (), []
    if not isinstance(raw, list):
        return (), ["tools must be a list of strings"]
    values: list[str] = []
    errors: list[str] = []
    for item in raw:
        text = _clean_text(item)
        if text is None:
            errors.append("tools must be strings")
            continue
        values.append(text)
    return tuple(values), errors


def _parse_permissions_with_errors(raw: object) -> tuple[dict[str, object], list[str]]:
    if raw is None:
        return {}, []
    if not isinstance(raw, dict):
        return {}, ["permissions must be an object"]
    permissions: dict[str, object] = {}
    errors: list[str] = []
    for key, value in raw.items():
        if not isinstance(key, str):
            errors.append("permissions keys must be strings")
            continue
        if not isinstance(value, bool):
            errors.append("permissions values must be booleans")
            continue
        permissions[key] = value
    return permissions, errors


def _parse_commands(raw: object) -> tuple[dict[str, str], ...]:
    if not isinstance(raw, list):
        return ()
    commands: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        command_id = _clean_text(item.get("id"))
        title = _clean_text(item.get("title"))
        if not command_id or not _is_safe_id(command_id) or not title:
            continue
        command = {"id": command_id, "title": title}
        description = _clean_text(item.get("description"))
        if description:
            command["description"] = description
        commands.append(command)
    return tuple(commands)


def _parse_ui(raw: object) -> dict[str, object] | None:
    if not isinstance(raw, dict):
        return None
    views = raw.get("views")
    if not isinstance(views, list):
        return None
    clean_views: list[dict[str, str]] = []
    for view in views:
        if not isinstance(view, dict):
            continue
        view_id = _clean_text(view.get("id"))
        title = _clean_text(view.get("title"))
        if not view_id or not _is_safe_id(view_id) or not title:
            continue
        clean_view = {"id": view_id, "title": title}
        view_type = _clean_text(view.get("type"))
        if view_type:
            clean_view["type"] = view_type
        clean_views.append(clean_view)
    return {"views": clean_views} if clean_views else None


def _parse_string_list(raw: object) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    values: list[str] = []
    for item in raw:
        text = _clean_text(item)
        if text is not None:
            values.append(text)
    return tuple(values)


def _apply_enabled_state(skill: CodingSkill, *, project_root: str | None) -> CodingSkill:
    state_enabled = CodingSkillStateStore().is_enabled(
        skill.id,
        scope=skill.scope,
        project_root=project_root if skill.scope == "project" else None,
        default=True,
    )
    return CodingSkill(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        skill_dir=skill.skill_dir,
        skill_file=skill.skill_file,
        scope=skill.scope,
        legacy=skill.legacy,
        activation_keywords=skill.activation_keywords,
        always_activate=skill.always_activate,
        allowed_tools=skill.allowed_tools,
        permissions=skill.permissions,
        enabled=skill.enabled and state_enabled,
        manifest_errors=skill.manifest_errors,
        commands=skill.commands,
        ui=skill.ui,
    )


def _state_file_for_scope(*, scope: Literal["project", "global"], project_root: str | None) -> Path:
    if scope == "project":
        if not project_root:
            raise ValueError("project_root is required for project Coding skill state")
        return Path(project_root).expanduser().resolve() / ".oclaw-coding" / "skill-state.json"
    return coding_home() / "skill-state.json"


def _read_state_file(path: Path) -> dict:
    if not path.is_file():
        return {"skills": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"skills": {}}
    if not isinstance(data, dict):
        return {"skills": {}}
    if not isinstance(data.get("skills"), dict):
        data["skills"] = {}
    return data


def _is_safe_id(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", value))
