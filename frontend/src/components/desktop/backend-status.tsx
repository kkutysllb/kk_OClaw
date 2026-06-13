"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getBackendStatus,
  restartBackend,
  getBackendLogs,
  type BackendStatus,
} from "@/core/desktop";
import { isDesktop } from "@/core/config";

/**
 * Backend status indicator for the desktop app.
 *
 * Shows a small pill in the bottom-left corner indicating whether the
 * embedded Python gateway is running, starting, stopped, or errored.
 * Only rendered when running inside Tauri.
 */
export function BackendStatusIndicator() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const s = await getBackendStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;

    // Poll status every 3 seconds
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!showLogs || !isDesktop()) return;
    let alive = true;
    getBackendLogs().then((l) => {
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

  // Don't render anything outside Tauri
  if (!isDesktop()) return null;

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
    <>
      {/* Status pill */}
      <div className="fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 text-xs shadow-md backdrop-blur-sm border">
        <span className={`inline-block h-2 w-2 rounded-full ${statusColor}`} />
        <span className="text-muted-foreground">
          Backend: {statusText}
          {status?.port ? ` :${status.port}` : ""}
        </span>
        {status?.status === "error" && (
          <button
            onClick={handleRestart}
            className="ml-1 rounded bg-primary px-2 py-0.5 text-primary-foreground text-[10px] hover:bg-primary/90"
          >
            Restart
          </button>
        )}
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="ml-1 text-muted-foreground hover:text-foreground"
        >
          {showLogs ? "Hide" : "Logs"}
        </button>
      </div>

      {/* Log panel */}
      {showLogs && (
        <div className="fixed bottom-12 left-3 z-50 max-h-60 w-96 overflow-y-auto rounded-lg bg-black/90 p-3 text-xs font-mono text-green-400 shadow-lg backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-gray-400">Backend Logs</span>
            <button
              onClick={() => setShowLogs(false)}
              className="text-gray-500 hover:text-gray-300"
            >
              x
            </button>
          </div>
          {logs.length === 0 ? (
            <div className="text-gray-500">No logs available</div>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap leading-5">
                {line}
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
