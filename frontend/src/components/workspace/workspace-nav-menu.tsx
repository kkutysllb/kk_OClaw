"use client";

import {
  BellIcon,
  BrainIcon,
  ChevronsUpDown,
  CoinsIcon,
  PaletteIcon,
  SettingsIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";

import { SettingsDialog } from "./settings";

type SettingsSection =
  | "account"
  | "appearance"
  | "memory"
  | "tools"
  | "notification"
  | "tokenUsage";

const MENU_ITEMS: {
  id: SettingsSection;
  icon: typeof UserIcon;
  color: string;
  labelKey: "account" | "appearance" | "memory" | "tools" | "notification" | "tokenUsage";
}[] = [
  { id: "account", icon: UserIcon, color: "text-sky-500", labelKey: "account" },
  { id: "appearance", icon: PaletteIcon, color: "text-violet-500", labelKey: "appearance" },
  { id: "memory", icon: BrainIcon, color: "text-amber-500", labelKey: "memory" },
  { id: "tokenUsage", icon: CoinsIcon, color: "text-emerald-500", labelKey: "tokenUsage" },
  { id: "tools", icon: WrenchIcon, color: "text-orange-500", labelKey: "tools" },
  { id: "notification", icon: BellIcon, color: "text-cyan-500", labelKey: "notification" },
];

function NavMenuButtonContent({
  isSidebarOpen,
  t,
}: {
  isSidebarOpen: boolean;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return isSidebarOpen ? (
    <div className="flex w-full items-center gap-2 text-left text-sm">
      <span className="flex size-5 items-center justify-center rounded-md bg-gradient-to-br from-slate-500 via-zinc-500 to-neutral-600 text-white">
        <SettingsIcon className="size-3" />
      </span>
      <span className="text-muted-foreground">{t.workspace.settingsAndMore}</span>
      <ChevronsUpDown className="text-muted-foreground ml-auto size-4" />
    </div>
  ) : (
    <div className="flex size-full items-center justify-center">
      <span className="flex size-5 items-center justify-center rounded-md bg-gradient-to-br from-slate-500 via-zinc-500 to-neutral-600 text-white">
        <SettingsIcon className="size-3" />
      </span>
    </div>
  );
}

export function WorkspaceNavMenu() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDefaultSection, setSettingsDefaultSection] = useState<SettingsSection>("appearance");
  const [mounted, setMounted] = useState(false);
  const { open: isSidebarOpen } = useSidebar();
  const { t } = useI18n();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        defaultSection={settingsDefaultSection}
      />
      <SidebarMenu className="w-full">
        <SidebarMenuItem>
          {mounted ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <NavMenuButtonContent isSidebarOpen={isSidebarOpen} t={t} />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                align="end"
                sideOffset={4}
              >
                {MENU_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem
                      key={item.id}
                      onClick={() => {
                        setSettingsDefaultSection(item.id);
                        setSettingsOpen(true);
                      }}
                    >
                      <Icon className={`size-4 ${item.color}`} />
                      {t.settings.sections[item.labelKey]}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <NavMenuButtonContent isSidebarOpen={isSidebarOpen} t={t} />
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
