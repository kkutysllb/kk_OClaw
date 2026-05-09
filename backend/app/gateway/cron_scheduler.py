"""Cron scheduler service — reads cron_config.json and executes enabled jobs.

Started as a background asyncio task during gateway lifespan.  Uses
``croniter`` to parse 6-field cron expressions and schedules agent
invocations via the LangGraph SDK client (same path as IM channels).

Lifecycle:
    - ``start()`` spawns the scheduler background task
    - ``stop()`` cancels the task and waits for graceful shutdown
    - The scheduler re-reads ``cron_config.json`` every 30 seconds so
      that changes made through the REST API or agent tool take effect
      without a gateway restart.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from croniter import croniter

logger = logging.getLogger(__name__)

# How often (seconds) the scheduler polls cron_config.json for changes.
_CONFIG_POLL_INTERVAL = 30

# ---------------------------------------------------------------------------
# Config helpers (shared logic with routers/crons.py)
# ---------------------------------------------------------------------------

CRON_CONFIG_FILENAME = "cron_config.json"


def _resolve_cron_config_path() -> Path:
    from kkoclaw.config.app_config import AppConfig

    config_path = AppConfig.resolve_config_path()
    if config_path is not None:
        return config_path.parent / CRON_CONFIG_FILENAME
    return Path.cwd().parent / CRON_CONFIG_FILENAME


def _load_cron_config() -> dict[str, Any]:
    path = _resolve_cron_config_path()
    if not path.exists():
        return {"cronJobs": {}}
    with open(path, encoding="utf-8") as f:
        return json.load(f) or {"cronJobs": {}}


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------


class CronScheduler:
    """Background cron job scheduler.

    Reads ``cron_config.json``, tracks each enabled job's next fire time,
    and invokes the specified agent when the schedule triggers.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._running = False
        # job_name -> next fire datetime (UTC)
        self._next_fire: dict[str, datetime] = {}
        # Lazy-init: LangGraph SDK client with internal auth + CSRF
        self._client = None
        self._csrf_token: str | None = None

    # -- public API --

    def start(self) -> None:
        """Start the scheduler as a background asyncio task."""
        if self._task is not None and not self._task.done():
            logger.warning("CronScheduler already running")
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop(), name="cron-scheduler")
        logger.info("CronScheduler started")

    async def stop(self) -> None:
        """Signal the scheduler to stop and wait for it to finish."""
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("CronScheduler stopped")

    # -- internals --

    @staticmethod
    def _local_now() -> datetime:
        """Current time in the server's local timezone.

        Cron expressions should be interpreted in local time so that
        ``7-23`` means 7am-11pm in the user's timezone, not UTC.
        """
        return datetime.now().astimezone()

    def _croniter(self, cron_expr: str, base: datetime) -> croniter:
        """Create a croniter instance with correct 6-field support."""
        parts = cron_expr.strip().split()
        if len(parts) == 6:
            return croniter(cron_expr, base, second_at_beginning=True)
        return croniter(cron_expr, base)

    async def _run_loop(self) -> None:
        """Main scheduling loop."""
        # Initial load
        now = self._local_now()
        self._refresh_schedule(now)
        logger.info("CronScheduler initial schedule: %s", {
            k: v.isoformat() for k, v in self._next_fire.items()
        })
        while self._running:
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("CronScheduler tick failed (will retry)")
            await asyncio.sleep(1)

    async def _tick(self) -> None:
        """One iteration of the scheduling loop."""
        now = self._local_now()

        # Reload config periodically to pick up changes (every ~30s)
        if now.second % _CONFIG_POLL_INTERVAL == 0:
            self._refresh_schedule(now)

        # Check each job to see if it should fire
        for name, fire_time in list(self._next_fire.items()):
            if now >= fire_time:
                try:
                    config = _load_cron_config()
                    job = config.get("cronJobs", {}).get(name)
                    if job and job.get("enabled", True):
                        cron_expr = job.get("cron", "")
                        cron = self._croniter(cron_expr, fire_time)
                        next_fire = cron.get_next(datetime)
                        self._next_fire[name] = next_fire
                        logger.info(
                            "CronScheduler firing job '%s' at %s, next fire at %s",
                            name, fire_time.isoformat(), next_fire.isoformat(),
                        )
                        # Fire the job in a separate task so the scheduler
                        # loop is not blocked by a slow agent invocation.
                        asyncio.create_task(
                            self._invoke_job(name, job),
                            name=f"cron-job-{name}-{uuid.uuid4().hex[:8]}",
                        )
                    else:
                        # Job was deleted or disabled — remove from tracking
                        self._next_fire.pop(name, None)
                except Exception:
                    logger.exception("Failed to compute next fire time for '%s'", name)
                    # Re-schedule from now to avoid permanent failure
                    self._next_fire[name] = now + timedelta(minutes=1)

    def _refresh_schedule(self, now: datetime) -> None:
        """Re-read cron_config.json and update next fire times."""
        try:
            config = _load_cron_config()
        except Exception:
            logger.exception("Failed to reload cron_config.json")
            return

        jobs = config.get("cronJobs", {})
        current_names = set(jobs.keys())

        # Remove deleted jobs
        for name in list(self._next_fire.keys()):
            if name not in current_names:
                del self._next_fire[name]

        # Add new jobs (only compute next_fire for jobs not yet tracked)
        for name, job in jobs.items():
            if not job.get("enabled", True):
                self._next_fire.pop(name, None)
                continue
            cron_expr = job.get("cron", "")
            if not cron_expr:
                continue
            # Skip jobs that are already scheduled — refresh must NOT
            # overwrite a fire_time that the tick loop is counting down to.
            if name in self._next_fire:
                continue
            try:
                cron = self._croniter(cron_expr, now)
                self._next_fire[name] = cron.get_next(datetime)
            except (ValueError, KeyError):
                logger.warning("Invalid cron expression '%s' for job '%s'", cron_expr, name)
                self._next_fire.pop(name, None)

    async def _invoke_job(self, name: str, job: dict[str, Any]) -> None:
        """Invoke the agent for a scheduled cron job."""
        agent_name = job.get("agent", "lead_agent")
        model = job.get("model")
        prompt = job.get("prompt", "")
        if not prompt:
            logger.warning("Cron job '%s' has no prompt — skipping", name)
            return

        logger.info(
            "CronScheduler firing job '%s': agent=%s model=%s prompt=%r",
            name,
            agent_name,
            model or "default",
            prompt[:100],
        )

        try:
            await self._invoke_via_client(agent_name, model, prompt)
            logger.info("Cron job '%s' completed successfully", name)
        except Exception:
            logger.exception("Cron job '%s' invocation failed", name)

    def _get_client(self):
        """Return the LangGraph SDK async client with internal auth + CSRF.

        Mirrors ChannelManager._get_client() so that both CSRF middleware
        and AuthMiddleware accept the request.
        """
        if self._client is None:
            from langgraph_sdk import get_client

            from app.gateway.config import get_gateway_config
            from app.gateway.csrf_middleware import CSRF_COOKIE_NAME, CSRF_HEADER_NAME, generate_csrf_token
            from app.gateway.internal_auth import create_internal_auth_headers

            gw = get_gateway_config()
            self._csrf_token = generate_csrf_token()
            self._client = get_client(
                url=f"http://{gw.host}:{gw.port}",
                headers={
                    **create_internal_auth_headers(),
                    CSRF_HEADER_NAME: self._csrf_token,
                    "Cookie": f"{CSRF_COOKIE_NAME}={self._csrf_token}",
                },
            )
        return self._client

    async def _invoke_via_client(
        self, agent_name: str, model: str | None, prompt: str
    ) -> None:
        """Use the LangGraph SDK client to invoke the agent.

        Connects to the gateway/langgraph service via HTTP with internal
        auth and CSRF headers, same as the IM channel manager does.
        """
        client = self._get_client()
        thread_id = str(uuid.uuid4())

        # Create a thread for this invocation
        await client.threads.create(thread_id=thread_id)

        config: dict[str, Any] = {}
        if model:
            config.setdefault("configurable", {})["model_name"] = model

        # Stream the run to completion (fire-and-forget)
        async for _ in client.runs.stream(
            thread_id,
            agent_name,
            input={"messages": [{"role": "human", "content": prompt}]},
            config=config,
            stream_mode=["values"],
        ):
            pass  # Drain the stream until the run completes


# ---------------------------------------------------------------------------
# Singleton lifecycle (mirrors channel service pattern)
# ---------------------------------------------------------------------------

_scheduler: CronScheduler | None = None


async def start_cron_scheduler() -> CronScheduler:
    """Create and start the global cron scheduler."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    _scheduler = CronScheduler()
    _scheduler.start()
    return _scheduler


async def stop_cron_scheduler() -> None:
    """Stop the global cron scheduler."""
    global _scheduler
    if _scheduler is None:
        return
    await _scheduler.stop()
    _scheduler = None
