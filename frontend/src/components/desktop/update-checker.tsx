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
import {
  checkForUpdates,
  installUpdate,
  onUpdateDownloading,
  onUpdateReady,
} from "@/core/desktop/updater";

type UpdateInfo = Awaited<ReturnType<typeof checkForUpdates>>;

/**
 * UI state for the update checker.
 *
 * Lifecycle with ``autoDownload=true`` (the silent background-download
 * model). Each state maps to a distinct UI surface:
 *
 * - `idle`: nothing to show.
 * - `checking`: manual check in progress — show "Checking…".
 * - `downloading`: a new version was found (manual path only),
 *   download in progress. Automatic path stays silent.
 * - `ready`: download finished, installer staged — show the modal
 *   "restart now to install" prompt.
 * - `no-update`: manual check finished, app is up-to-date.
 */
type CheckState =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "no-update";

/**
 * Desktop auto-update checker.
 *
 * Three trigger paths:
 *
 * 1. **Automatic** (silent): on mount (desktop only), waits 5 seconds
 *    then checks GitHub Releases for a newer version. With
 *    ``autoDownload=true``, finding one kicks off a background download.
 *    The renderer is notified via ``onUpdateReady`` (user-facing prompt)
 *    once the download finishes. No modal is shown before that.
 *
 * 2. **Manual**: the app menu's "Check for Updates…" item sends a
 *    `menu:check-update` IPC event. This shows the full feedback flow:
 *    "Checking…" → "Downloading…" → "Ready to install", or "Up-to-date".
 *
 * 3. **Push**: even without any user action, if the background download
 *    completes while the app is running, the ``onUpdateReady``
 *    subscription surfaces the "restart now" modal.
 *
 * Renders nothing in web mode.
 */
export function UpdateChecker() {
  const [state, setState] = useState<CheckState>("idle");
  const [update, setUpdate] = useState<UpdateInfo>(null);
  const [readyVersion, setReadyVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  /**
   * Run an update check.
   *
   * @param silent — when `true` (automatic check on mount), no UI is
   *   shown unless the download later completes. When `false` (manual
   *   menu trigger), the "Checking…" → "Downloading…" feedback is shown
   *   so the user gets immediate response to their click.
   */
  const doCheck = useCallback(async (silent: boolean) => {
    if (!silent) setState("checking");
    const info = await checkForUpdates();
    if (info?.available) {
      setUpdate(info);
      // With autoDownload=true, the main process starts the background
      // download immediately on its own. We don't trigger anything
      // here — just wait for the `onUpdateReady` push event. The silent
      // path stays in `idle` (no modal); the manual path advances to
      // `downloading` so the user sees their click had an effect.
      if (!silent) setState("downloading");
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

  // Push subscription: download started (silent, non-blocking).
  // We intentionally do NOT change state here for the automatic path —
  // the user should not be interrupted by a modal while they're working.
  // The manual path has already transitioned to `downloading` and will
  // be advanced by the `onUpdateReady` subscription below.
  useEffect(() => {
    if (!isDesktop()) return;
    return onUpdateDownloading((_info) => {
      // No-op for automatic path. For manual path, we're already in
      // `downloading` state — nothing to change.
    });
  }, []);

  // Push subscription: download complete → show the restart prompt.
  // This is the user-facing notification. Works for BOTH automatic and
  // manual paths — whenever the background download finishes, we surface
  // the modal.
  useEffect(() => {
    if (!isDesktop()) return;
    return onUpdateReady((info) => {
      setReadyVersion(info.version);
      setState("ready");
    });
  }, []);

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

  // ── Update ready (download complete) ─────────────────────────────
  // This is the main user-facing modal. By the time we get here, the
  // installer is fully staged — clicking "restart now" triggers an
  // immediate relaunch.
  if (state === "ready") {
    const version = readyVersion ?? update?.version ?? "";
    return (
      <Dialog open={true} onOpenChange={(v) => !v && dismiss()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>更新已就绪 v{version}</DialogTitle>
            <DialogDescription>
              新版本已下载完成，重启 OClaw 即可完成安装。
              {update?.body && (
                <span className="mt-2 block whitespace-pre-wrap text-xs opacity-80">
                  {update.body}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={dismiss} disabled={installing}>
              下次退出时安装
            </Button>
            <Button onClick={handleInstall} disabled={installing}>
              {installing ? "正在重启…" : "立即重启安装"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Downloading (manual path only) ───────────────────────────────
  // After a manual check that found an update, show a brief status.
  // This modal will be replaced by `ready` once the download completes
  // (via the push subscription above).
  if (state === "downloading" && update) {
    return (
      <Dialog open={true}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>发现新版本 v{update.version}</DialogTitle>
            <DialogDescription>
              正在后台下载更新，下载完成后会自动提示安装。
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Checking (manual only) ─────────────────────────────────────
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

  // ── Up-to-date (manual only) ─────────────────────────────────
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
