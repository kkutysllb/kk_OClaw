"use client";

import {
  BellIcon,
  BrainIcon,
  LogOutIcon,
  PaletteIcon,
  ShieldCheckIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react";
import { useState } from "react";

import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";

import { SettingsDialog } from "./settings";

type SettingsSection =
  | "account"
  | "appearance"
  | "memory"
  | "tools"
  | "notification";

const SETTINGS_ITEMS: {
  id: SettingsSection;
  icon: typeof UserIcon;
  color: string;
  labelKey: "account" | "appearance" | "memory" | "tools" | "notification";
}[] = [
  { id: "account", icon: UserIcon, color: "text-sky-500", labelKey: "account" },
  { id: "appearance", icon: PaletteIcon, color: "text-violet-500", labelKey: "appearance" },
  { id: "memory", icon: BrainIcon, color: "text-amber-500", labelKey: "memory" },
  { id: "tools", icon: WrenchIcon, color: "text-orange-500", labelKey: "tools" },
  { id: "notification", icon: BellIcon, color: "text-cyan-500", labelKey: "notification" },
];

function getRoleLabel(
  role: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  return role === "admin"
    ? t.workspace.userInfo.admin
    : t.workspace.userInfo.user;
}

export function WorkspaceUserInfo() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDefaultSection, setSettingsDefaultSection] = useState<SettingsSection>("appearance");

  if (!user) return null;

  const avatar = (
    <Avatar className="size-8 shrink-0 ring-2 ring-offset-1 ring-offset-background ring-violet-500/30">
      <AvatarFallback className="bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 text-white text-sm font-bold shadow-sm">
        <UserIcon className="size-4" />
      </AvatarFallback>
    </Avatar>
  );

  const settingsDialog = (
    <SettingsDialog
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      defaultSection={settingsDefaultSection}
    />
  );

  const settingsMenuItems = SETTINGS_ITEMS.map((item) => {
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
  });

  const userInfoLabel = (
    <DropdownMenuLabel className="font-normal">
      <div className="flex flex-col gap-1">
        <p className="truncate text-sm font-medium">{user.email}</p>
        <div className="flex items-center gap-1.5">
          <ShieldCheckIcon className={user.system_role === "admin" ? "size-3.5 text-amber-500" : "size-3.5 text-slate-400"} />
          <span className="text-muted-foreground text-xs">
            {getRoleLabel(user.system_role, t)}
          </span>
        </div>
      </div>
    </DropdownMenuLabel>
  );

  if (isCollapsed) {
    return (
      <div className="px-2 pt-2">
        <Separator className="mb-2" />
        <div className="flex justify-center">
          {settingsDialog}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="outline-none">
                {avatar}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="min-w-52">
              {userInfoLabel}
              <DropdownMenuSeparator />
              {settingsMenuItems}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOutIcon className="size-4 text-rose-500" />
                {t.workspace.logout}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  return (
    <div className="px-2 pt-2">
      <Separator className="mb-3" />
      {settingsDialog}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
            {avatar}
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium leading-tight">
                {user.email}
              </p>
              <p className="text-muted-foreground truncate text-xs leading-tight">
                {getRoleLabel(user.system_role, t)}
              </p>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="min-w-52">
          {userInfoLabel}
          <DropdownMenuSeparator />
          {settingsMenuItems}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOutIcon className="size-4 text-rose-500" />
            {t.workspace.logout}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
