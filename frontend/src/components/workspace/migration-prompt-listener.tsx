"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImportWizardDialog } from "@/components/workspace/settings/import-wizard-dialog";
import { isDesktop } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import type { DetectedSource } from "@/core/desktop/types";

/**
 * Listens for the backend's `migration:available` event (fired once on first
 * launch when a web deployment is detected) and shows a confirmation dialog.
 *
 * Mounted once at the workspace root so the prompt works regardless of which
 * page the user lands on. Inactive on web (no `window.oclawDesktop`).
 */
export function MigrationPromptListener() {
  const { t } = useI18n();
  const [sources, setSources] = useState<DetectedSource[] | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (!isDesktop() || !window.oclawDesktop?.onMigrationAvailable) return;
    const unsubscribe = window.oclawDesktop.onMigrationAvailable((next) => {
      if (next.length === 0) return;
      setSources(next);
    });
    return unsubscribe;
  }, []);

  const dismiss = () => setSources(null);
  const accept = () => {
    setSources(null);
    setWizardOpen(true);
  };

  if (!sources) {
    return (
      <ImportWizardDialog open={wizardOpen} onOpenChange={setWizardOpen} />
    );
  }

  const firstPath = sources[0]?.path;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && dismiss()}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t.settings.import.autoPromptTitle}</DialogTitle>
            <DialogDescription>
              {t.settings.import.autoPromptDescription}
              {firstPath && (
                <span className="mt-2 block font-mono text-xs">{firstPath}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={dismiss}>
              {t.settings.import.autoPromptLater}
            </Button>
            <Button onClick={accept}>
              {t.settings.import.autoPromptImport}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ImportWizardDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        presetSource={firstPath}
      />
    </>
  );
}
