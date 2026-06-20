"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isDesktop } from "@/core/config";
import { checkForUpdates, installUpdate } from "@/core/desktop/updater";

type UpdateInfo = Awaited<ReturnType<typeof checkForUpdates>>;

/**
 * UI state for the update checker.
 *
 * - `idle`: nothing to show (background or dismissed).
 * - `checking`: a manual check is in progress — show the "Checking…"
 *   dialog so the user gets immediate feedback from the menu click.
 * - `update-available`: a newer version was found — show the update
 *   prompt dialog.
 * - `no-update`: the manual check finished and the app is up-to-date —
 *   show a brief confirmation dialog.
 */
type CheckState = "idle" | "checking" | "update-available" | "no-update";

/**
 * Desktop auto-update checker.
 *
 * Two trigger paths:
 *
 * 1. **Automatic** (silent): on mount (desktop only), waits 5 seconds
 *    then checks GitHub Releases for a newer version. The check is
 *    silent — only surfaces a dialog when an update is actually found.
 *
 * 2. **Manual**: the app menu's "Check for Updates…" item sends a
 *    `menu:check-update` IPC event (see `main.ts` → `preload.ts`).
 *    This shows the full feedback flow: "Checking…" → either
 *    "Update available" or "Up-to-date".
 *
 * Renders nothing in web mode.
 */
export function UpdateChecker() {
  const [state, setState] = useState<CheckState>("idle");
  const [update, setUpdate] = useState<UpdateInfo>(null);
  const [installing, setInstalling] = useState(false);

  /**
   * Run an update check.
   *
   * @param silent — when `true` (automatic check on mount), no UI is
   *   shown unless an update is found. When `false` (manual menu
   *   trigger), the "Checking…" and "Up-to-date" states are shown so
   *   the user gets feedback for their explicit action.
   */
  const doCheck = useCallback(async (silent: boolean) => {
    if (!silent) setState("checking");
    const info = await checkForUpdates();
    if (info?.available) {
      setUpdate(info);
      setState("update-available");
    } else if (!silent) {
      setState("no-update");
    }
  }, []);

  // Automatic silent check 5s after mount (desktop only).
  useEffect(() => {
    if (!isDesktop()) return;
    const timer = setTimeout(() => {
      void doCheck(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [doCheck]);

  // Manual check via app menu "Check for Updates…" (desktop only).
  useEffect(() => {
    if (!isDesktop()) return;
    const bridge = window.oclawDesktop;
    if (!bridge?.onCheckUpdateRequest) return;
    const unsubscribe = bridge.onCheckUpdateRequest(() => {
      void doCheck(false);
    });
    return unsubscribe;
  }, [doCheck]);

  const handleInstall = async () => {
    setInstalling(true);
    const ok = await installUpdate();
    if (!ok) {
      setInstalling(false);
      setState("idle");
    }
    // If ok, electron-updater restarts the app automatically.
  };

  const dismiss = () => setState("idle");

  // ── Update available ──────────────────────────────────────────────
  if (state === "update-available" && update) {
    return (
      <Dialog open={true} onOpenChange={(v) => !v && dismiss()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发现新版本 v{update.version}</DialogTitle>
            <DialogDescription>
              OClaw 有新版本可用，建议立即更新以获取最新功能和修复。
              {update.body && (
                <span className="mt-2 block whitespace-pre-wrap text-xs opacity-80">
                  {update.body}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={dismiss} disabled={installing}>
              稍后再说
            </Button>
            <Button onClick={handleInstall} disabled={installing}>
              {installing ? "正在下载…" : "立即更新"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Checking (manual only) ────────────────────────────────────────
  if (state === "checking") {
    return (
      <Dialog open={true}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>正在检查更新…</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Up-to-date (manual only) ──────────────────────────────────────
  if (state === "no-update") {
    return (
      <Dialog open={true} onOpenChange={dismiss}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>已是最新版本</DialogTitle>
            <DialogDescription>
              OClaw 当前版本已是最新，无需更新。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={dismiss}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
