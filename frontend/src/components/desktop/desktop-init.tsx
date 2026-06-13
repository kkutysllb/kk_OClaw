"use client";

import { useEffect } from "react";

import { isDesktop } from "@/core/config";
import { initDragDrop } from "@/core/desktop/dnd";

/**
 * Initializes desktop-specific integrations on mount.
 *
 * - Registers native drag-drop handler
 *
 * Renders nothing — purely a side-effect initializer.
 * Only active when running inside Tauri.
 */
export function DesktopInit() {
  useEffect(() => {
    if (!isDesktop()) return;

    let cleanup: (() => void) | undefined;

    void initDragDrop().then((fn) => {
      cleanup = fn;
    });

    return () => {
      cleanup?.();
    };
  }, []);

  return null;
}
