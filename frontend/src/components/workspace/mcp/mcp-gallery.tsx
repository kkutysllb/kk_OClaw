"use client";

import { AlertTriangleIcon, PlusIcon, TerminalIcon } from "lucide-react";
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
import { useI18n } from "@/core/i18n/hooks";
import {
  addMCPServer,
  deleteMCPServer,
  loadMCPConfig,
  updateMCPConfig,
} from "@/core/mcp/api";
import type { MCPServerConfig } from "@/core/mcp/types";

import { McpCard } from "./mcp-card";
import { McpDialog } from "./mcp-dialog";
import { toast } from "sonner";

export function McpGallery() {
  const { t } = useI18n();
  const [servers, setServers] = useState<Record<string, MCPServerConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<MCPServerConfig | null>(
    null,
  );

  // Delete state
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadMCPConfig();
      setServers(data.mcp_servers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load MCP config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = () => {
    setEditingName(null);
    setEditingConfig(null);
    setDialogOpen(true);
  };

  const handleEdit = (name: string) => {
    setEditingName(name);
    setEditingConfig(servers[name] ?? null);
    setDialogOpen(true);
  };

  const handleSave = async (
    name: string,
    isNew: boolean,
    config: MCPServerConfig,
  ) => {
    if (isNew) {
      await addMCPServer(name, config);
      toast.success(t.mcp.createSuccess);
    } else {
      // Update via full config PUT
      const current = await loadMCPConfig();
      const updated = {
        mcp_servers: {
          ...current.mcp_servers,
          [name]: config,
        },
      };
      await updateMCPConfig(updated);
      toast.success(t.mcp.updateSuccess);
    }
    await refresh();
  };

  const handleDelete = async () => {
    if (!deletingName) return;
    setDeleting(true);
    try {
      await deleteMCPServer(deletingName);
      toast.success(t.mcp.deleteSuccess);
      setDeletingName(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const serverEntries = Object.entries(servers);

  return (
    <div className="flex size-full flex-col">
      {/* Page header */}
      <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/30 to-transparent">
        {/* Decorative background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-amber-500/5 blur-3xl" />
          <div className="absolute -bottom-16 left-1/3 size-48 rounded-full bg-orange-500/5 blur-3xl" />
        </div>

        <div className="relative flex items-center justify-between px-6 py-5">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-amber-500 via-orange-400 to-rose-400 bg-clip-text text-transparent">
                {t.mcp.title}
              </span>
            </h1>
            <p className="text-muted-foreground text-sm max-w-xl">
              {t.mcp.description}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {serverEntries.length > 0 && !loading && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex size-2 rounded-full bg-amber-400" />
                {serverEntries.length} 个服务器
              </div>
            )}
            <Button
              onClick={handleAdd}
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-md shadow-amber-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-amber-500/30"
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {t.mcp.addServer}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-48 animate-pulse rounded-xl border bg-muted/30"
              >
                <div className="h-1 w-full rounded-t-xl bg-amber-500/20" />
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl bg-muted" />
                    <div className="space-y-2 flex-1">
                      <div className="h-4 w-2/3 rounded bg-muted" />
                      <div className="h-3 w-1/3 rounded bg-muted" />
                    </div>
                  </div>
                  <div className="h-3 w-full rounded bg-muted" />
                  <div className="h-3 w-2/3 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="size-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
              <TerminalIcon className="size-7 text-red-400" />
            </div>
            <p className="text-destructive text-sm font-medium">{error}</p>
            <Button variant="outline" onClick={refresh}>
              Retry
            </Button>
          </div>
        ) : serverEntries.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-amber-500/10 blur-xl" />
              <div className="relative bg-amber-500/10 flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ring-amber-500/20">
                <TerminalIcon className="text-amber-500 h-8 w-8" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-lg">{t.mcp.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm max-w-sm">
                {t.mcp.emptyDescription}
              </p>
            </div>
            <Button
              onClick={handleAdd}
              className="mt-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600"
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {t.mcp.addServer}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {serverEntries.map(([name, config]) => (
              <McpCard
                key={name}
                name={name}
                config={config}
                onEdit={handleEdit}
                onDelete={setDeletingName}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit dialog */}
      <McpDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        name={editingName}
        config={editingConfig}
        onSave={handleSave}
      />

      {/* Delete confirmation */}
      <Dialog
        open={!!deletingName}
        onOpenChange={(open) => {
          if (!open) setDeletingName(null);
        }}
      >
        <DialogContent className="p-0">
          <div className="h-1.5 w-full rounded-t-lg bg-gradient-to-r from-red-400 to-rose-400" />
          <DialogHeader className="px-6 pt-4">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                <AlertTriangleIcon className="h-4 w-4" />
              </span>
              {t.mcp.deleteServer}
            </DialogTitle>
            <DialogDescription className="pl-10">
              {t.mcp.deleteConfirm.replace(
                "{name}",
                deletingName ?? "",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-6 pb-5">
            <Button
              variant="outline"
              onClick={() => setDeletingName(null)}
              disabled={deleting}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="shadow-sm"
            >
              {deleting ? t.common.loading : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
