"use client";

import { useEffect } from "react";

import { isDesktop, isDesktopBackendManagedMode } from "@/core/config";
import { startBackend } from "@/core/desktop";
import { initDragDrop } from "@/core/desktop/dnd";

/**
 * Initializes desktop-specific integrations on mount.
 *
 * - Ensures the embedded backend is started
 * - Registers native drag-drop handler
 *
 * Renders nothing — purely a side-effect initializer.
 * Only active when running inside Electron.
 */
export function DesktopInit() {
  useEffect(() => {
    if (!isDesktop()) return;

    let cleanup: (() => void) | undefined;

    // In packaged desktop, Electron owns the embedded backend. In desktop dev
    // the gateway is owned by desktop-electron/scripts/dev.mjs.
    if (isDesktopBackendManagedMode()) {
      void startBackend().catch((e) =>
        console.warn("[desktop-init] startBackend failed:", e),
      );
    }

    void initDragDrop().then((fn) => {
      cleanup = fn;
    });

    return () => {
      cleanup?.();
    };
  }, []);

  return null;
}
