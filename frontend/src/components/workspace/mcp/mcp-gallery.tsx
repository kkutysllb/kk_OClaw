"use client";

import { PlusIcon, TerminalIcon } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
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
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">{t.mcp.title}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {t.mcp.description}
          </p>
        </div>
        <Button onClick={handleAdd}>
          <PlusIcon className="mr-1.5 h-4 w-4" />
          {t.mcp.addServer}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <p className="text-destructive text-sm">{error}</p>
            <Button variant="outline" onClick={refresh}>
              Retry
            </Button>
          </div>
        ) : serverEntries.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="bg-amber-500/10 flex h-14 w-14 items-center justify-center rounded-full">
              <TerminalIcon className="text-amber-500 h-7 w-7" />
            </div>
            <div>
              <p className="font-medium">{t.mcp.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.mcp.emptyDescription}
              </p>
            </div>
            <Button variant="outline" className="mt-2" onClick={handleAdd}>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.mcp.deleteServer}</DialogTitle>
            <DialogDescription>
              {t.mcp.deleteConfirm.replace(
                "{name}",
                deletingName ?? "",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
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
            >
              {deleting ? t.common.loading : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
