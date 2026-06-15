"use client";

import { useEffect, useState } from "react";

import { isDesktopBackendManagedMode } from "@/core/config";
import { getBackendStatus, type BackendStatus } from "@/core/desktop";

export function shouldShowBackendSplash(
  status: BackendStatus | null,
  desktop: boolean,
): boolean {
  return desktop && status?.status === "starting";
}

/**
 * Splash screen shown while the backend is starting up.
 * Only rendered in desktop (Electron) mode while backend status is "starting".
 */
export function BackendSplashScreen() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [dots, setDots] = useState(0);

  useEffect(() => {
    if (!isDesktopBackendManagedMode()) return;

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

  if (!shouldShowBackendSplash(status, isDesktopBackendManagedMode())) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6">
        {/* Logo: OClaw octagonal O-ring */}
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-[#151527] shadow-lg">
          <svg viewBox="0 0 100 100" className="h-16 w-16">
            <defs>
              <linearGradient id="splashGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style={{ stopColor: '#FEF08A' }} />
                <stop offset="42%" style={{ stopColor: '#FACC15' }} />
                <stop offset="46%" style={{ stopColor: '#EAB308' }} />
                <stop offset="54%" style={{ stopColor: '#4ADE80' }} />
                <stop offset="100%" style={{ stopColor: '#16A34A' }} />
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
