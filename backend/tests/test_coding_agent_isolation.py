from kkoclaw.agents.coding_agent.prompt import apply_coding_prompt_template


def test_coding_prompt_separates_project_root_from_scratch_workspace():
    prompt = apply_coding_prompt_template(project_root="/tmp/project")

    assert "source repository root" in prompt
    assert "isolated scratch workspace" in prompt
    assert "Only write inside `/tmp/project`" in prompt
    assert "All file paths are relative to this root" not in prompt
