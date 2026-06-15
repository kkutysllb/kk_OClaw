"use client";

import { useEffect, useState } from "react";

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

/**
 * Desktop auto-update checker.
 *
 * On mount (desktop only), waits 5 seconds then checks GitHub Releases
 * for a newer version. If found, shows a dialog prompting the user to
 * download and install.
 *
 * Renders nothing in web mode.
 */
export function UpdateChecker() {
  const [update, setUpdate] = useState<Awaited<ReturnType<typeof checkForUpdates>> | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isDesktop()) return;

    const timer = setTimeout(() => {
      void checkForUpdates().then((info) => {
        if (info?.available) setUpdate(info);
      });
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    const ok = await installUpdate();
    if (!ok) {
      setInstalling(false);
      setDismissed(true);
    }
    // If ok, the app will restart automatically
  };

  if (!update || dismissed) return null;

  return (
    <Dialog open={true} onOpenChange={(v) => !v && setDismissed(true)}>
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
          <Button
            variant="ghost"
            onClick={() => setDismissed(true)}
            disabled={installing}
          >
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
