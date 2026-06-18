"use client";

import { useEffect, useState } from "react";

import { isDesktopBackendManagedMode } from "@/core/config";
import {
  getBackendStatus,
  getStartupInfo,
  type BackendStatus,
  type StartupDiagnostics,
} from "@/core/desktop";

export function shouldShowBackendSplash(
  status: BackendStatus | null,
  desktop: boolean,
): boolean {
  // In managed mode the desktop shell owns the gateway lifecycle, so the
  // splash should remain visible until the backend reports "running".
  // This covers null (not yet polled), "stopped", "starting", and "error" —
  // all states where the user should see the startup panel.
  if (!desktop) return false;
  return status?.status !== "running";
}

const STATUS_STYLES: Record<string, string> = {
  stopped: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
  starting: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
  running: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
  error: "bg-red-500/15 text-red-400 ring-red-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  error: "错误",
};

/**
 * Startup splash panel shown while the desktop shell initializes its services.
 *
 * Displays three sections:
 * 1. Service status — live state of each managed service (Gateway, etc.)
 * 2. Environment check — repo root, .env presence, uv binary, resolved ports
 * 3. Environment variables — keys loaded from .env (secrets redacted)
 *
 * Auto-dismisses 1.5s after all services reach "running". The panel can be
 * manually expanded/collapsed to inspect details.
 */
export function BackendSplashScreen() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<StartupDiagnostics | null>(null);
  const [dots, setDots] = useState(0);
  const [expanded, setExpanded] = useState(false);
  // "loading" → services still starting; "fading" → all running, animating
  // out; "hidden" → unmounted.
  const [phase, setPhase] = useState<"loading" | "fading" | "hidden">(
    "loading",
  );

  // Poll backend status + full diagnostics.
  useEffect(() => {
    if (!isDesktopBackendManagedMode()) return;

    let cancelled = false;
    const check = async () => {
      const [s, d] = await Promise.all([
        getBackendStatus(),
        getStartupInfo(),
      ]);
      if (cancelled) return;
      setStatus(s);
      if (d) setDiagnostics(d);
    };

    void check();
    const interval = setInterval(() => void check(), 800);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Auto-expand when there's an error so the user sees what went wrong.
  useEffect(() => {
    if (diagnostics?.services.some((s) => s.status === "error")) {
      setExpanded(true);
    }
  }, [diagnostics]);

  // When the backend reports "running", begin the fade-out sequence.
  // We check `status` (single gateway state) rather than waiting for the
  // full diagnostics payload, so the transition fires as soon as the
  // gateway is ready — even if diagnostics hasn't arrived yet.
  useEffect(() => {
    if (phase !== "loading") return;
    // Gateway is the only managed service, so its status is the signal.
    if (status?.status === "running") {
      // Small delay so the user sees the green “running” badge before fade.
      const timer = setTimeout(() => setPhase("fading"), 1000);
      return () => clearTimeout(timer);
    }
  }, [status, phase]);

  // Animate dots.
  useEffect(() => {
    const timer = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(timer);
  }, []);

  const isManaged = isDesktopBackendManagedMode();

  // The component only renders in desktop managed mode. Once hidden, stay
  // hidden until the component is re-mounted by a route change.
  if (!isManaged || phase === "hidden") return null;

  // Fading-out overlay: a blank background that animates to transparent.
  if (phase === "fading") {
    return <FadingOverlay onDone={() => setPhase("hidden")} />;
  }

  // In "loading" phase the panel is always visible — the phase only
  // transitions to "fading" once `status` reports "running" (see the
  // effect above). This avoids a race where the panel flickers off
  // before the fade-out animation starts.

  const services = diagnostics?.services ?? [];
  const envCheck = diagnostics?.env_check;
  const envVars = diagnostics?.env_vars ?? [];
  const hasError = services.some((s) => s.status === "error");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
        {/* Header: logo + title */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-[#151527] shadow-lg">
            <svg viewBox="0 0 100 100" className="h-12 w-12">
              <defs>
                <linearGradient id="splashGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" style={{ stopColor: "#FEF08A" }} />
                  <stop offset="42%" style={{ stopColor: "#FACC15" }} />
                  <stop offset="46%" style={{ stopColor: "#EAB308" }} />
                  <stop offset="54%" style={{ stopColor: "#4ADE80" }} />
                  <stop offset="100%" style={{ stopColor: "#16A34A" }} />
                </linearGradient>
              </defs>
              <g transform="rotate(-35, 50, 50)">
                <path
                  d="M 89,50 L 78,78 L 50,89 L 22,78 L 11,50 L 22,22 L 50,11 L 78,22 Z M 75,50 L 68,68 L 50,75 L 32,68 L 25,50 L 32,32 L 50,25 L 68,32 Z"
                  fill="url(#splashGrad)"
                  fillRule="evenodd"
                />
              </g>
            </svg>
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-foreground">
              {hasError ? "启动遇到问题" : `正在启动 OClaw${".".repeat(dots)}`}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {hasError ? "请检查下方的服务状态与环境信息" : "正在初始化后端服务"}
            </p>
          </div>
        </div>

        {/* Section 1: Service status */}
        <div className="rounded-xl border border-border/50 bg-card/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              服务状态
            </h3>
            {!hasError && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            {services.length === 0 && (
              <p className="text-sm text-muted-foreground">正在获取状态…</p>
            )}
            {services.map((svc) => (
              <div
                key={svc.name}
                className="flex items-center justify-between gap-3 rounded-lg bg-background/40 px-3 py-2"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {svc.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      :{svc.port}
                    </span>
                    {svc.pid != null && (
                      <span className="text-xs text-muted-foreground">
                        PID {svc.pid}
                      </span>
                    )}
                  </div>
                  {svc.error && (
                    <span className="truncate text-xs text-red-400">
                      {svc.error}
                    </span>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                    STATUS_STYLES[svc.status] ?? STATUS_STYLES.stopped
                  } ${svc.status === "starting" ? "animate-pulse" : ""}`}
                >
                  {STATUS_LABELS[svc.status] ?? svc.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Expand/collapse toggle for detailed sections */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-center gap-1 rounded-lg border border-border/40 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/30"
        >
          {expanded ? "收起详细信息" : "展开环境信息"}
          <svg
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Sections 2 & 3: collapsible */}
        {expanded && envCheck && (
          <div className="flex flex-col gap-4">
            {/* Section 2: Environment check */}
            <div className="rounded-xl border border-border/50 bg-card/30 p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                环境检查
              </h3>
              <div className="flex flex-col gap-2 text-xs">
                <EnvRow
                  label="运行模式"
                  value={envCheck.is_dev ? "开发模式" : "生产模式"}
                />
                <EnvRow
                  label="仓库根目录"
                  value={envCheck.repo_root}
                  ok
                />
                <EnvRow
                  label=".env 配置文件"
                  value={envCheck.env_file}
                  ok={envCheck.env_file_exists}
                  warn={!envCheck.env_file_exists}
                />
                <EnvRow
                  label="Gateway 端口"
                  value={String(envCheck.gateway_port)}
                  ok
                />
                <EnvRow
                  label="Frontend 端口"
                  value={String(envCheck.frontend_port)}
                  ok
                />
                <EnvRow
                  label="uv 解释器"
                  value={envCheck.uv_binary}
                  ok={envCheck.uv_binary_exists}
                  warn={!envCheck.uv_binary_exists}
                />
              </div>
            </div>

            {/* Section 3: Environment variables */}
            {envVars.length > 0 && (
              <div className="rounded-xl border border-border/50 bg-card/30 p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  已加载环境变量 ({envVars.length})
                </h3>
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto font-mono text-xs">
                  {envVars.map((v) => (
                    <div
                      key={v.key}
                      className="flex items-start gap-2 rounded px-2 py-0.5 hover:bg-background/30"
                    >
                      <span className="shrink-0 text-cyan-400">{v.key}</span>
                      <span className="text-muted-foreground">=</span>
                      <span
                        className={`min-w-0 break-all ${
                          v.value === "***" ? "text-amber-400" : "text-zinc-300"
                        }`}
                      >
                        {v.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Full-screen overlay that fades from opaque to transparent, then calls
 * `onDone`. Uses `requestAnimationFrame` so the initial `opacity: 1` state
 * is painted before transitioning to 0 — otherwise the transition never fires.
 */
function FadingOverlay({ onDone }: { onDone: () => void }) {
  const [opacity, setOpacity] = useState(1);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpacity(0));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className="bg-background fixed inset-0 z-[100] transition-opacity duration-700"
      style={{ opacity }}
      onTransitionEnd={onDone}
    />
  );
}

/** A single row in the environment-check section. */
function EnvRow({
  label,
  value,
  ok,
  warn,
}: {
  label: string;
  value: string;
  ok?: boolean;
  warn?: boolean;
}) {
  const icon = ok ? (
    <span className="shrink-0 text-emerald-400">✓</span>
  ) : warn ? (
    <span className="shrink-0 text-amber-400">⚠</span>
  ) : null;
  return (
    <div className="flex items-start gap-2">
      {icon}
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-zinc-300">{value}</span>
    </div>
  );
}
