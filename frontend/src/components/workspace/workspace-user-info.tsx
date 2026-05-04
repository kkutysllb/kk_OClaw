"use client";

import { UserIcon } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar";

function getRoleLabel(
  role: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  return role === "admin"
    ? t.workspace.userInfo.admin
    : t.workspace.userInfo.user;
}

export function WorkspaceUserInfo() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  if (!user) return null;

  const avatar = (
    <Avatar className="size-8 shrink-0 ring-2 ring-offset-1 ring-offset-background ring-violet-500/30">
      <AvatarFallback className="bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 text-white text-sm font-bold shadow-sm">
        <UserIcon className="size-4" />
      </AvatarFallback>
    </Avatar>
  );

  // Collapsed: show only avatar with tooltip
  if (isCollapsed) {
    return (
      <div className="px-2 pt-2">
        <Separator className="mb-2" />
        <div className="flex justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="cursor-default">
                {avatar}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" align="center">
              <p className="text-xs font-medium">{user.email}</p>
              <p className="text-muted-foreground text-xs">
                {getRoleLabel(user.system_role, t)}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  // Expanded: show avatar + email + role
  return (
    <div className="px-2 pt-2">
      <Separator className="mb-3" />
      <div className="flex items-center gap-3 rounded-md px-2 py-1.5">
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">
            {user.email}
          </p>
          <p className="text-muted-foreground truncate text-xs leading-tight">
            {getRoleLabel(user.system_role, t)}
          </p>
        </div>
      </div>
    </div>
  );
}
