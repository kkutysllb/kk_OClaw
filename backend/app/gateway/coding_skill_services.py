"""Gateway service helpers for Coding-only skills."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from kkoclaw.coding_core.skills import CodingSkill, CodingSkillRegistry, CodingSkillStateStore, load_skill_instructions

_SKILL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")


class CodingSkillService:
    """Read-only service for Coding Agent skills.

    This deliberately uses ``kkoclaw.coding_core`` instead of global
    ``kkoclaw.skills`` storage so Coding skills remain isolated.
    """

    @classmethod
    def list_skills(cls, *, project_root: str | None = None) -> list[dict[str, Any]]:
        return [_skill_to_dict(skill) for skill in CodingSkillRegistry.discover(project_root=project_root)]

    @classmethod
    def get_skill(cls, skill_id: str, *, project_root: str | None = None) -> dict[str, Any] | None:
        normalized_id = skill_id.strip().lower()
        for skill in CodingSkillRegistry.discover(project_root=project_root):
            if skill.id == normalized_id:
                return {
                    "skill": _skill_to_dict(skill),
                    "instructions": load_skill_instructions(skill),
                }
        return None

    @classmethod
    def create_project_skill(
        cls,
        *,
        project_root: str | None,
        skill_id: str,
        name: str,
        description: str,
        instructions: str,
        activation_keywords: list[str] | None = None,
        always_activate: bool = False,
        allowed_tools: list[str] | None = None,
        permissions: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        skill_dir = _project_skill_dir(project_root, skill_id)
        if skill_dir.exists():
            raise ValueError(f"Coding skill '{skill_id}' already exists")
        return cls._write_project_skill(
            project_root=project_root,
            skill_id=skill_id,
            name=name,
            description=description,
            instructions=instructions,
            activation_keywords=activation_keywords,
            always_activate=always_activate,
            allowed_tools=allowed_tools,
            permissions=permissions,
        )

    @classmethod
    def update_project_skill(
        cls,
        *,
        project_root: str | None,
        skill_id: str,
        name: str,
        description: str,
        instructions: str,
        activation_keywords: list[str] | None = None,
        always_activate: bool = False,
        allowed_tools: list[str] | None = None,
        permissions: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return cls._write_project_skill(
            project_root=project_root,
            skill_id=skill_id,
            name=name,
            description=description,
            instructions=instructions,
            activation_keywords=activation_keywords,
            always_activate=always_activate,
            allowed_tools=allowed_tools,
            permissions=permissions,
        )

    @classmethod
    def delete_project_skill(cls, *, project_root: str | None, skill_id: str) -> dict[str, Any]:
        normalized_id = _validate_skill_id(skill_id)
        skill_dir = _project_skill_dir(project_root, normalized_id)
        if not skill_dir.exists() or not skill_dir.is_dir():
            raise FileNotFoundError(f"Project Coding skill '{normalized_id}' not found")
        shutil.rmtree(skill_dir)
        return {"deleted": True, "skill_id": normalized_id}

    @classmethod
    def set_skill_enabled(
        cls,
        *,
        project_root: str | None,
        skill_id: str,
        scope: str,
        enabled: bool,
    ) -> dict[str, Any]:
        normalized_id = _validate_skill_id(skill_id)
        if scope not in ("project", "global"):
            raise ValueError("scope must be 'project' or 'global'")
        CodingSkillStateStore().set_enabled(
            normalized_id,
            scope=scope,  # type: ignore[arg-type]
            enabled=enabled,
            project_root=project_root,
        )
        detail = cls.get_skill(normalized_id, project_root=project_root)
        if detail is None:
            raise FileNotFoundError(f"Coding skill '{normalized_id}' not found")
        return detail

    @classmethod
    def _write_project_skill(
        cls,
        *,
        project_root: str | None,
        skill_id: str,
        name: str,
        description: str,
        instructions: str,
        activation_keywords: list[str] | None,
        always_activate: bool,
        allowed_tools: list[str] | None,
        permissions: dict[str, Any] | None,
    ) -> dict[str, Any]:
        normalized_id = _validate_skill_id(skill_id)
        _validate_required_text(name, "name")
        _validate_required_text(description, "description")
        _validate_required_text(instructions, "instructions")

        skill_dir = _project_skill_dir(project_root, normalized_id)
        skill_dir.mkdir(parents=True, exist_ok=True)

        manifest: dict[str, Any] = {
            "id": normalized_id,
            "name": name.strip(),
            "description": description.strip(),
            "entry": "SKILL.md",
            "activation": {
                "keywords": _clean_string_list(activation_keywords),
                "always": bool(always_activate),
            },
            "tools": _clean_string_list(allowed_tools),
            "permissions": permissions or {},
        }

        (skill_dir / "skill.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (skill_dir / "SKILL.md").write_text(instructions, encoding="utf-8")

        detail = cls.get_skill(normalized_id, project_root=project_root)
        if detail is None:
            raise RuntimeError(f"Failed to load written Coding skill '{normalized_id}'")
        return detail


def _skill_to_dict(skill: CodingSkill) -> dict[str, Any]:
    return {
        "id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "scope": skill.scope,
        "legacy": skill.legacy,
        "activation_keywords": list(skill.activation_keywords),
        "always_activate": skill.always_activate,
        "allowed_tools": list(skill.allowed_tools),
        "permissions": skill.permissions,
        "skill_file": str(skill.skill_file),
        "enabled": skill.enabled,
        "manifest_errors": list(skill.manifest_errors),
        "commands": list(skill.commands),
        "ui": skill.ui,
    }


def _project_skill_dir(project_root: str | None, skill_id: str) -> Path:
    if not project_root:
        raise ValueError("project_root is required for project Coding skill writes")
    root = Path(project_root).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError(f"project_root does not exist or is not a directory: {project_root}")
    normalized_id = _validate_skill_id(skill_id)
    return root / ".oclaw-coding" / "skills" / normalized_id


def _validate_skill_id(skill_id: str) -> str:
    normalized = skill_id.strip().lower()
    if not _SKILL_ID_RE.fullmatch(normalized):
        raise ValueError("skill id must start with a letter or digit and contain only lowercase letters, digits, dot, underscore, or hyphen")
    return normalized


def _validate_required_text(value: str, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")


def _clean_string_list(values: list[str] | None) -> list[str]:
    if not values:
        return []
    return [value.strip() for value in values if isinstance(value, str) and value.strip()]
