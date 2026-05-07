from pydantic import BaseModel, Field


class CronManagementConfig(BaseModel):
    """Configuration for agent-managed cron jobs."""

    enabled: bool = Field(
        default=False,
        description="Whether the agent can manage cron jobs through conversation.",
    )
