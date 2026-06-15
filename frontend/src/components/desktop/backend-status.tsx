"use client";

import { useCallback, useEffect, useState } from "react";

import { isDesktopBackendManagedMode } from "@/core/config";
import {
  getBackendLogs,
  getBackendStatus,
  restartBackend,
  type BackendStatus,
} from "@/core/desktop";

/**
 * Backend status indicator for the desktop app.
 *
 * Shows a small pill in the bottom-left corner indicating whether the
 * embedded Python gateway is running, starting, stopped, or errored.
 * Only rendered when running inside Electron.
 */
export function BackendStatusIndicator() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!isDesktopBackendManagedMode()) return;
    const s = await getBackendStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    if (!isDesktopBackendManagedMode()) return;

    // Poll status every 3 seconds
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!showLogs || !isDesktopBackendManagedMode()) return;
    let alive = true;
    void getBackendLogs().then((l) => {
      if (alive) setLogs(l);
    });
    return () => {
      alive = false;
    };
  }, [showLogs, status?.status]);

  const handleRestart = async () => {
    await restartBackend();
    setTimeout(() => void refresh(), 1000);
  };

  // Don't render anything outside Electron
  if (!isDesktopBackendManagedMode()) return null;

  const statusColor =
    status?.status === "running"
      ? "bg-green-500"
      : status?.status === "starting"
        ? "bg-yellow-500 animate-pulse"
        : status?.status === "error"
          ? "bg-red-500"
          : "bg-gray-500";

  const statusText =
    status?.status === "running"
      ? "Running"
      : status?.status === "starting"
        ? "Starting..."
        : status?.status === "error"
          ? `Error${status.error ? `: ${status.error.slice(0, 40)}` : ""}`
          : "Stopped";

  return (
    <div className="relative flex items-center">
      {/* Log panel — opens downward from the bar */}
      {showLogs && (
        <div className="absolute top-full right-0 z-[100] mt-1 w-[560px] overflow-hidden rounded-md border bg-zinc-950/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <span className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
              Backend Logs
            </span>
            <button
              onClick={() => setShowLogs(false)}
              className="text-zinc-600 transition-colors hover:text-zinc-300"
            >
              ✕
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-green-400">
            {logs.length === 0 ? (
              <div className="text-zinc-600">No logs available</div>
            ) : (
              logs.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Status bar — long horizontal strip */}
      <div className="flex h-7 items-center gap-2 rounded-md border bg-background/80 px-2.5 text-xs shadow-sm backdrop-blur-sm">
        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} />
        <span className="whitespace-nowrap text-muted-foreground">
          {statusText}
          {status?.port ? ` :${status.port}` : ""}
        </span>
        {status?.status === "error" && (
          <button
            onClick={handleRestart}
            className="ml-0.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-red-700"
          >
            Restart
          </button>
        )}
        <span className="mx-0.5 h-3 w-px shrink-0 bg-border" />
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
        >
          {showLogs ? "Hide" : "Logs"}
        </button>
      </div>
    </div>
  );
}
