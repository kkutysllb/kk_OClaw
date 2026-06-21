import { Toaster } from "sonner";

import { QueryClientProvider } from "@/components/query-client-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CommandPalette } from "@/components/workspace/command-palette";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import { WorkspaceTaskTabs } from "@/components/workspace/workspace-task-tabs";
import { WorkspaceRuntimeProvider } from "@/core/workspace-runtime";

// Desktop static export: no cookies() access
export function WorkspaceContent({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <QueryClientProvider>
      <WorkspaceRuntimeProvider>
        <SidebarProvider className="h-screen" defaultOpen={false}>
          <WorkspaceSidebar />
          <SidebarInset className="min-w-0">
            <WorkspaceTaskTabs />
            {children}
          </SidebarInset>
        </SidebarProvider>
      </WorkspaceRuntimeProvider>
      <CommandPalette />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
