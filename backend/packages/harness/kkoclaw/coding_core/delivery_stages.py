"""Authoritative definition of the Coding project delivery stages.

These seven stages form the canonical project delivery workflow:

    requirements → design → initialization → implementation →
    verification → review → delivery

The stage ids (kebab-case) are the stable contract used by:
  - ``coding_core/stage_state.py`` (persistent per-project state)
  - ``tools/coding/stage_tools.py`` (agent ``suggest_delivery_stage`` tool)
  - ``app/gateway/routers/coding_delivery.py`` (REST API)
  - the frontend ``CodingWorkflowInspector`` (via ``GET /api/coding/delivery-stages``)

Any change to the stage list here propagates to all of the above, so the
stage set is intentionally small and stable.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DeliveryStage:
    """A single stage in the project delivery workflow.

    Attributes
    ----------
    id:
        Stable kebab-case identifier. Used as the persistence key and the
        ``stage_id`` parameter accepted by the agent tool / REST API.
    title:
        Short human-readable label (Chinese).
    goal:
        One-line goal description shown on stage cards.
    recommended_skills:
        Skill ids that are typically useful for this stage. Used by the
        frontend to render skill badges; does NOT auto-activate skills
        (activation still goes through ``CodingSkillsMiddleware`` keyword
        matching).
    suggested_prompt:
        Prompt template the UI offers to inject when the user enters or
        accepts a suggestion for this stage.
    next_stage_id:
        The stage that naturally follows this one in the recommended
        flow. ``None`` for the terminal stage. Used to compute the
        "advance" default target. Jumping to any other stage is still
        allowed.
    """

    id: str
    title: str
    goal: str
    recommended_skills: tuple[str, ...]
    suggested_prompt: str
    next_stage_id: str | None
    completion_signals: tuple[str, ...] = ()

    # ``completion_signals`` are concrete, observable outcomes that indicate
    # the stage's goal has been substantially met. The Coding Agent reads
    # these via ``QiongqiEngine.build_dynamic_context`` and uses them to
    # decide when to proactively call ``suggest_delivery_stage``. Each entry
    # should be a short noun phrase describing a tangible artifact or event
    # (e.g. "需求文档已生成", "技术栈已确认").


DELIVERY_STAGES: tuple[DeliveryStage, ...] = (
    DeliveryStage(
        id="requirements",
        title="需求",
        goal="明确用户、目标、范围和验收标准。",
        recommended_skills=(
            "requirements-analysis",
            "product-spec",
            "acceptance-criteria",
        ),
        suggested_prompt=(
            "请基于当前项目目标进行需求分析，输出用户角色、核心场景、"
            "非目标和验收标准。"
        ),
        next_stage_id="design",
        completion_signals=(
            "需求文档已生成（requirements.md / PRD / 用户故事）",
            "用户角色、核心场景、验收标准均已明确写下",
            "用户与 agent 已就需求范围达成一致（不再有未解决的追问）",
        ),
    ),
    DeliveryStage(
        id="design",
        title="设计",
        goal="确定架构、模块边界、数据模型和 API 合约。",
        recommended_skills=(
            "technical-design",
            "architecture",
            "api-design",
            "database",
        ),
        suggested_prompt=(
            "请基于已确认需求制定技术设计，包含架构边界、数据模型、"
            "API 合约、风险和验证计划。"
        ),
        next_stage_id="initialization",
        completion_signals=(
            "技术设计文档已生成（design.md / 架构图）",
            "模块边界与依赖关系已明确",
            "数据模型 / API 合约已定义",
            "技术栈选型已与用户确认",
        ),
    ),
    DeliveryStage(
        id="initialization",
        title="初始化",
        goal="建立可运行、可测试、可构建的项目骨架。",
        recommended_skills=(
            "project-scaffolding",
            "environment-setup",
            "build-system",
            "ci-cd",
        ),
        suggested_prompt=(
            "请初始化项目工程结构，补齐环境配置、构建脚本、测试入口和 "
            "CI 基础命令。"
        ),
        next_stage_id="implementation",
        completion_signals=(
            "项目骨架已生成（目录结构 / 包管理文件 / 入口文件）",
            "环境配置与依赖列表已写入项目",
            "构建命令和测试入口可运行",
        ),
    ),
    DeliveryStage(
        id="implementation",
        title="实现",
        goal="按垂直切片交付可验证功能。",
        recommended_skills=(
            "vertical-slice-development",
            "implement",
            "test-driven-development",
        ),
        suggested_prompt=(
            "请按垂直切片实现下一组核心功能，保持小 diff，并补充必要测试。"
        ),
        next_stage_id="verification",
        completion_signals=(
            "本轮规划的全部垂直切片功能均已提交",
            "新增代码伴随必要的单元测试",
            "用户需求中要求的核心功能可用",
        ),
    ),
    DeliveryStage(
        id="verification",
        title="验证",
        goal="用自动化测试和浏览器验证确认功能可用。",
        recommended_skills=(
            "qa-test-plan",
            "webapp-testing",
            "playwright-verification",
        ),
        suggested_prompt=(
            "请制定并执行当前功能的 QA 验证，覆盖自动化测试、浏览器交互、"
            "错误状态和回归风险。"
        ),
        next_stage_id="review",
        completion_signals=(
            "自动化测试全部通过",
            "浏览器手动验证已记录关键路径可用",
            "错误状态与边界场景已检查",
        ),
    ),
    DeliveryStage(
        id="review",
        title="审查",
        goal="审查 diff、PR 风险、安全风险和可维护性。",
        recommended_skills=(
            "diff-analysis",
            "code-review",
            "security-review",
            "pr-review-advanced",
        ),
        suggested_prompt=(
            "请对当前项目 diff 和任务变更执行代码审查，输出阻塞问题、"
            "建议修复和合并风险。"
        ),
        next_stage_id="delivery",
        completion_signals=(
            "代码审查已完成并输出问题清单",
            "阻塞问题均已修复或已有明确的跟进计划",
            "安全 / 可维护性风险已评估",
        ),
    ),
    DeliveryStage(
        id="delivery",
        title="交付",
        goal="准备发布、部署、运维和交接材料。",
        recommended_skills=(
            "deployment",
            "release-engineering",
            "operations-runbook",
            "handoff-docs",
        ),
        suggested_prompt=(
            "请准备项目交付材料，包含部署步骤、发布检查、运维 runbook、"
            "回滚方案和交接文档。"
        ),
        next_stage_id=None,
        completion_signals=(
            "部署 / 发布文档已生成",
            "运维 runbook 和回滚方案已写入",
            "交接材料准备完毕",
        ),
    ),
)


def list_stages() -> list[DeliveryStage]:
    """Return all delivery stages in canonical order."""
    return list(DELIVERY_STAGES)


def get_stage(stage_id: str) -> DeliveryStage | None:
    """Look up a single stage by id. Returns ``None`` if not found."""
    for stage in DELIVERY_STAGES:
        if stage.id == stage_id:
            return stage
    return None


def is_valid_stage_id(stage_id: str) -> bool:
    """True if *stage_id* is a known delivery stage id."""
    return get_stage(stage_id) is not None


__all__ = [
    "DELIVERY_STAGES",
    "DeliveryStage",
    "get_stage",
    "is_valid_stage_id",
    "list_stages",
]
