"""Tests for skill frontmatter validation.

Consolidates all _validate_skill_frontmatter tests (previously split across
test_skills_router.py and this module) into a single dedicated module.

Also tests frontmatter normalisation for cross-platform compatibility
(_normalise_skill_frontmatter).
"""

from pathlib import Path

from kkoclaw.skills.validation import (
    ALLOWED_FRONTMATTER_PROPERTIES,
    _COMPAT_FRONTMATTER_KEYS,
    _normalise_skill_frontmatter,
    _validate_skill_frontmatter,
)


def _write_skill(tmp_path: Path, content: str) -> Path:
    """Write a SKILL.md file and return its parent directory."""
    skill_file = tmp_path / "SKILL.md"
    skill_file.write_text(content, encoding="utf-8")
    return tmp_path


class TestValidateSkillFrontmatter:
    def test_valid_minimal_skill(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: my-skill\ndescription: A valid skill\n---\n\nBody\n",
        )
        valid, msg, name = _validate_skill_frontmatter(skill_dir)
        assert valid is True
        assert msg == "Skill is valid!"
        assert name == "my-skill"

    def test_valid_with_all_allowed_fields(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: my-skill\ndescription: A skill\nlicense: MIT\nversion: '1.0'\nauthor: test\n---\n\nBody\n",
        )
        valid, msg, name = _validate_skill_frontmatter(skill_dir)
        assert valid is True
        assert msg == "Skill is valid!"
        assert name == "my-skill"

    def test_missing_skill_md(self, tmp_path):
        valid, msg, name = _validate_skill_frontmatter(tmp_path)
        assert valid is False
        assert "not found" in msg
        assert name is None

    def test_no_frontmatter(self, tmp_path):
        skill_dir = _write_skill(tmp_path, "# Just markdown\n\nNo front matter.\n")
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "frontmatter" in msg.lower()

    def test_invalid_yaml(self, tmp_path):
        skill_dir = _write_skill(tmp_path, "---\n[invalid yaml: {{\n---\n\nBody\n")
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "YAML" in msg

    def test_missing_name(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\ndescription: A skill without a name\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "name" in msg.lower()

    def test_missing_description(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: my-skill\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "description" in msg.lower()

    def test_unexpected_keys_rejected(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: my-skill\ndescription: test\ncustom-field: bad\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "custom-field" in msg

    def test_name_must_be_hyphen_case(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: MySkill\ndescription: test\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "hyphen-case" in msg

    def test_name_no_leading_hyphen(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: -my-skill\ndescription: test\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "hyphen" in msg

    def test_name_no_trailing_hyphen(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: my-skill-\ndescription: test\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "hyphen" in msg

    def test_name_no_consecutive_hyphens(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: my--skill\ndescription: test\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "hyphen" in msg

    def test_name_too_long(self, tmp_path):
        long_name = "a" * 65
        skill_dir = _write_skill(
            tmp_path,
            f"---\nname: {long_name}\ndescription: test\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "too long" in msg.lower()

    def test_description_no_angle_brackets(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: my-skill\ndescription: Has <html> tags\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "angle brackets" in msg.lower()

    def test_description_too_long(self, tmp_path):
        long_desc = "a" * 1025
        skill_dir = _write_skill(
            tmp_path,
            f"---\nname: my-skill\ndescription: {long_desc}\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "too long" in msg.lower()

    def test_empty_name_rejected(self, tmp_path):
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: ''\ndescription: test\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "empty" in msg.lower()

    def test_allowed_properties_constant(self):
        assert "name" in ALLOWED_FRONTMATTER_PROPERTIES
        assert "description" in ALLOWED_FRONTMATTER_PROPERTIES
        assert "license" in ALLOWED_FRONTMATTER_PROPERTIES

    def test_reads_utf8_on_windows_locale(self, tmp_path, monkeypatch):
        skill_dir = _write_skill(
            tmp_path,
            '---\nname: demo-skill\ndescription: "Curly quotes: \u201cutf8\u201d"\n---\n\n# Demo Skill\n',
        )
        original_read_text = Path.read_text

        def read_text_with_gbk_default(self, *args, **kwargs):
            kwargs.setdefault("encoding", "gbk")
            return original_read_text(self, *args, **kwargs)

        monkeypatch.setattr(Path, "read_text", read_text_with_gbk_default)

        valid, msg, name = _validate_skill_frontmatter(skill_dir)
        assert valid is True
        assert msg == "Skill is valid!"
        assert name == "demo-skill"


class TestNormaliseSkillFrontmatter:
    """Tests for _normalise_skill_frontmatter cross-platform compatibility."""

    def test_compat_keys_normalised_into_metadata(self):
        """Compatibility keys should be moved into metadata.compat."""
        fm = {
            "name": "my-skill",
            "description": "test",
            "capabilities": "data analysis",
            "tags": ["python", "analysis"],
            "requires": ["pandas"],
        }
        result = _normalise_skill_frontmatter(fm)
        assert "capabilities" not in result
        assert "tags" not in result
        assert "requires" not in result
        assert "metadata" in result
        assert result["metadata"]["compat"]["capabilities"] == "data analysis"
        assert result["metadata"]["compat"]["tags"] == ["python", "analysis"]
        assert result["metadata"]["compat"]["requires"] == ["pandas"]

    def test_compat_keys_merge_with_existing_metadata(self):
        """Compat keys should merge into existing metadata without clobbering."""
        fm = {
            "name": "my-skill",
            "description": "test",
            "metadata": {"source": "community"},
            "tags": ["ml"],
            "inputs": {"file": "path"},
        }
        result = _normalise_skill_frontmatter(fm)
        assert "tags" not in result
        assert "inputs" not in result
        assert result["metadata"]["source"] == "community"
        assert result["metadata"]["compat"]["tags"] == ["ml"]
        assert result["metadata"]["compat"]["inputs"] == {"file": "path"}

    def test_non_dict_metadata_preserved(self):
        """If metadata is not a dict, wrap it so compat data isn't lost."""
        fm = {
            "name": "my-skill",
            "description": "test",
            "metadata": "some-string",
            "tags": ["ref"],
        }
        result = _normalise_skill_frontmatter(fm)
        assert result["metadata"]["_value"] == "some-string"
        assert result["metadata"]["compat"]["tags"] == ["ref"]

    def test_no_compat_keys_no_change(self):
        """Frontmatter with only allowed keys should pass through unchanged."""
        fm = {
            "name": "my-skill",
            "description": "test",
            "license": "MIT",
        }
        result = _normalise_skill_frontmatter(fm)
        assert result == fm

    def test_unknown_key_not_touched(self):
        """Truly unknown keys are left in place (caller rejects them)."""
        fm = {
            "name": "my-skill",
            "description": "test",
            "custom-field": "bad",
        }
        result = _normalise_skill_frontmatter(fm)
        assert "custom-field" in result

    def test_all_compat_keys_normalised(self):
        """All five compat keys should be moved."""
        fm = {
            "name": "my-skill",
            "description": "test",
            "capabilities": "x",
            "inputs": "y",
            "permissions": "z",
            "requires": "w",
            "tags": ["a"],
        }
        result = _normalise_skill_frontmatter(fm)
        for key in _COMPAT_FRONTMATTER_KEYS:
            assert key not in result, f"{key} should have been moved"
        compat = result["metadata"]["compat"]
        assert compat["capabilities"] == "x"
        assert compat["inputs"] == "y"
        assert compat["permissions"] == "z"
        assert compat["requires"] == "w"
        assert compat["tags"] == ["a"]


class TestValidateFrontmatterWithCompatNormalisation:
    """Integration: validation passes when compat keys are present."""

    def test_skill_with_compat_keys_valid(self, tmp_path):
        """Skills with compat keys (tags, requires, etc.) should validate."""
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: my-skill\ndescription: A skill with compat fields\ntags: [python, analysis]\ncapabilities: data analysis\ninputs: {file: path}\npermissions: read\nrequires: [pandas]\n---\n\nBody\n",
        )
        valid, msg, name = _validate_skill_frontmatter(skill_dir)
        assert valid is True
        assert msg == "Skill is valid!"
        assert name == "my-skill"

    def test_skill_with_compat_and_allowed_keys_valid(self, tmp_path):
        """Skills with both compat and standard allowed keys should validate."""
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: my-skill\ndescription: A skill\nlicense: MIT\nversion: '1.0'\nauthor: test\ntags: [ml]\nmetadata:\n  source: community\n  compat:\n    extra: info\ncompatibility: kkoclaw\n---\n\nBody\n",
        )
        valid, msg, name = _validate_skill_frontmatter(skill_dir)
        assert valid is True
        assert msg == "Skill is valid!"
        assert name == "my-skill"

    def test_unknown_key_still_rejected(self, tmp_path):
        """Truly unknown keys should still cause validation failure."""
        skill_dir = _write_skill(
            tmp_path,
            "---\nname: my-skill\ndescription: test\ncustom-field: bad\n---\n\nBody\n",
        )
        valid, msg, _ = _validate_skill_frontmatter(skill_dir)
        assert valid is False
        assert "custom-field" in msg
