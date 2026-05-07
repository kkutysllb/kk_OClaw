from .tools import get_available_tools

__all__ = ["get_available_tools", "skill_manage_tool", "cron_manage_tool"]


def __getattr__(name: str):
    if name == "skill_manage_tool":
        from .skill_manage_tool import skill_manage_tool

        return skill_manage_tool
    if name == "cron_manage_tool":
        from .cron_manage_tool import cron_manage_tool

        return cron_manage_tool
    raise AttributeError(name)
