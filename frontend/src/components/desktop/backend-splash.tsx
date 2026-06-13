"use client";

import { useEffect, useState } from "react";
import { getBackendStatus, type BackendStatus } from "@/core/desktop";
import { isDesktop } from "@/core/config";

/**
 * Splash screen shown while the backend is starting up.
 * Only rendered in desktop (Tauri) mode while backend status is "starting".
 */
export function BackendSplashScreen() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [dots, setDots] = useState(0);

  useEffect(() => {
    if (!isDesktop()) return;

    const check = async () => {
      const s = await getBackendStatus();
      setStatus(s);
    };

    void check();
    const interval = setInterval(() => void check(), 1000);
    return () => clearInterval(interval);
  }, []);

  // Animate dots
  useEffect(() => {
    const timer = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(timer);
  }, []);

  // Don't show splash if not in desktop mode, or if backend is already running/stopped
  if (!isDesktop()) return null;
  if (status?.status === "running") return null;
  if (status?.status === "error") return null;
  // Also don't show if we haven't checked yet and it might be running

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6">
        {/* Logo: OClaw knight */}
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-[#0f0f1a] shadow-lg">
          <svg viewBox="0 0 200 200" className="h-16 w-16">
            <defs>
              <linearGradient id="splashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{ stopColor: '#22d3ee' }} />
                <stop offset="50%" style={{ stopColor: '#a855f7' }} />
                <stop offset="100%" style={{ stopColor: '#ec4899' }} />
              </linearGradient>
            </defs>
            <path fill="url(#splashGrad)" d="M130 55c-3-2-8-4-12-3-5 1-9 5-10 10-1 3 0 6 2 9l-8 3c-5 2-10 6-13 11l-14 28c-8 2-15 6-20 12l-12 22c-3 6-4 13-2 19l3 10c2 4 6 7 10 8l5 1c4 0 8-2 10-5l8-14c3-6 8-10 14-12l6 8c-3 5-4 10-3 16l5 18c2 5 6 9 11 10l5 1c4 0 8-2 11-5l7-8c3-3 7-5 11-5l10 2c4 1 8 0 11-2l10-6c9-5 15-14 17-24l3-16c1-5 0-10-3-14l-8-10c-3-4-8-7-13-8l-9 2c-5 1-10 0-14-3l4-12c2-6 1-13-3-18l-10-12c-4-5-10-8-16-9z"/>
            <path fill="url(#splashGrad)" d="M110 30c-2-4-6-7-11-8l-10-1c-5 0-10 3-13 7l-6 10c-2 4-2 9 1 13l8 8c4 3 8 5 13 4l9-2c5-1 9-5 11-10l2-9c1-4 0-8-4-12z"/>
            <path fill="url(#splashGrad)" d="M55 85l-8 6c-6 4-10 10-11 17l-2 15c-1 6 1 12 5 16l15 14 8-5c3-2 6-6 7-10l2-12c1-5-1-10-5-14l-11-11z"/>
            <path fill="url(#splashGrad)" d="M30 130l-10 18c-3 6-4 13-2 20l3 12 12-3 5-6c2-3 3-7 2-11l-4-14c-2-5-4-9-6-16z"/>
          </svg>
        </div>

        {/* Loading text */}
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground">
            Starting OClaw{".".repeat(dots)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Initializing backend services
          </p>
        </div>

        {/* Spinner */}
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    </div>
  );
}
