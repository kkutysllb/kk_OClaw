"use client";

import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { SettingsSection } from "./settings-section";

interface ImportSettingsPageProps {
  onOpenWizard: () => void;
}

export function ImportSettingsPage({
  onOpenWizard,
}: ImportSettingsPageProps) {
  const { t } = useI18n();
  return (
    <SettingsSection
      title={t.settings.import.title}
      description={t.settings.import.description}
      icon={<DownloadIcon className="w-5 h-5 text-emerald-500" />}
    >
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t.settings.import.description}
        </p>
        <Button onClick={onOpenWizard}>
          <DownloadIcon className="mr-2 h-4 w-4" />
          {t.settings.import.openWizard}
        </Button>
      </div>
    </SettingsSection>
  );
}
