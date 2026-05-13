"use client";

import {
  BellIcon,
  BrainIcon,
  PaletteIcon,
  SettingsIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AccountSettingsPage } from "@/components/workspace/settings/account-settings-page";
import { AppearanceSettingsPage } from "@/components/workspace/settings/appearance-settings-page";
import { MemorySettingsPage } from "@/components/workspace/settings/memory-settings-page";
import { NotificationSettingsPage } from "@/components/workspace/settings/notification-settings-page";
import { ToolSettingsPage } from "@/components/workspace/settings/tool-settings-page";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

type SettingsSection =
  | "account"
  | "appearance"
  | "memory"
  | "tools"
  | "notification";

type SettingsDialogProps = React.ComponentProps<typeof Dialog> & {
  defaultSection?: SettingsSection;
};

// Per-section color theme for the nav icons
const SECTION_COLORS: Record<string, { iconActive: string; iconInactive: string; bar: string; bg: string }> = {
  account: {
    iconActive: "text-sky-400",
    iconInactive: "text-sky-500",
    bar: "from-sky-400 to-blue-500",
    bg: "bg-sky-500/10",
  },
  appearance: {
    iconActive: "text-violet-400",
    iconInactive: "text-violet-500",
    bar: "from-violet-400 to-purple-500",
    bg: "bg-violet-500/10",
  },
  notification: {
    iconActive: "text-amber-400",
    iconInactive: "text-amber-500",
    bar: "from-amber-400 to-orange-500",
    bg: "bg-amber-500/10",
  },
  memory: {
    iconActive: "text-emerald-400",
    iconInactive: "text-emerald-500",
    bar: "from-emerald-400 to-teal-500",
    bg: "bg-emerald-500/10",
  },
  tools: {
    iconActive: "text-rose-400",
    iconInactive: "text-rose-500",
    bar: "from-rose-400 to-pink-500",
    bg: "bg-rose-500/10",
  },
};

export function SettingsDialog(props: SettingsDialogProps) {
  const { defaultSection = "appearance", ...dialogProps } = props;
  const { t } = useI18n();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(defaultSection);

  useEffect(() => {
    // When opening the dialog, ensure the active section follows the caller's intent.
    // This allows triggers like "About" to open the dialog directly on that page.
    if (dialogProps.open) {
      setActiveSection(defaultSection);
    }
  }, [defaultSection, dialogProps.open]);

  const sections = useMemo(
    () => [
      {
        id: "account",
        label: t.settings.sections.account,
        icon: UserIcon,
      },
      {
        id: "appearance",
        label: t.settings.sections.appearance,
        icon: PaletteIcon,
      },
      {
        id: "notification",
        label: t.settings.sections.notification,
        icon: BellIcon,
      },
      {
        id: "memory",
        label: t.settings.sections.memory,
        icon: BrainIcon,
      },
      { id: "tools", label: t.settings.sections.tools, icon: WrenchIcon },
    ],
    [
      t.settings.sections.account,
      t.settings.sections.appearance,
      t.settings.sections.memory,
      t.settings.sections.tools,
      t.settings.sections.notification,
    ],
  );
  return (
    <Dialog
      {...dialogProps}
      onOpenChange={(open) => props.onOpenChange?.(open)}
    >
      <DialogContent
        className="flex h-[75vh] max-h-[calc(100vh-2rem)] flex-col p-0 sm:max-w-5xl md:max-w-6xl"
        aria-describedby={undefined}
      >
        {/* Header with decorative gradient bar */}
        <div className="h-1.5 w-full rounded-t-lg bg-gradient-to-r from-violet-400 via-cyan-400 to-amber-400" />
        <DialogHeader className="gap-1 px-6 pt-4">
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 text-white">
              <SettingsIcon className="h-3.5 w-3.5" />
            </span>
            {t.settings.title}
          </DialogTitle>
          <p className="text-muted-foreground text-sm">
            {t.settings.description}
          </p>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 px-6 pb-6 md:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="bg-sidebar min-h-0 overflow-y-auto rounded-lg border p-2">
            <ul className="space-y-1 pr-1">
              {sections.map(({ id, label, icon: Icon }) => {
                const active = activeSection === id;
                const colors = SECTION_COLORS[id];
                return (
                  <li key={id} className="relative">
                    {/* Active left bar indicator */}
                    {active && colors && (
                      <div className={`absolute left-0 top-1 bottom-1 w-1 rounded-full bg-gradient-to-b ${colors.bar}`} />
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveSection(id as SettingsSection)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200",
                        active
                          ? "bg-muted/80 text-foreground pl-4"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-md transition-colors",
                          active && colors
                            ? `${colors.bg} ${colors.iconActive}`
                            : `text-muted-foreground`,
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span>{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <ScrollArea className="h-full min-h-0 rounded-lg border">
            <div className="space-y-8 p-6">
              {activeSection === "account" && <AccountSettingsPage />}
              {activeSection === "appearance" && <AppearanceSettingsPage />}
              {activeSection === "memory" && <MemorySettingsPage />}
              {activeSection === "tools" && <ToolSettingsPage />}
              {activeSection === "notification" && <NotificationSettingsPage />}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
