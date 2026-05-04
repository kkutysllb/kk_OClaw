"use client";

import { AlertTriangleIcon, CpuIcon, PlusIcon } from "lucide-react";
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
import { useI18n } from "@/core/i18n/hooks";
import {
  createModel,
  deleteModel,
  loadModels,
  updateModel,
} from "@/core/models/api";
import type { Model, ModelRequest } from "@/core/models/types";

import { ModelCard } from "./model-card";
import { ModelDialog } from "./model-dialog";
import { toast } from "sonner";

export function ModelGallery() {
  const { t } = useI18n();
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [deletingModel, setDeletingModel] = useState<Model | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadModels();
      setModels(data.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  };

  // Load on mount
  useEffect(() => {
    refresh();
  }, []);

  const handleAdd = () => {
    setEditingModel(null);
    setDialogOpen(true);
  };

  const handleEdit = (model: Model) => {
    setEditingModel(model);
    setDialogOpen(true);
  };

  const handleSave = async (req: ModelRequest) => {
    if (editingModel) {
      await updateModel(editingModel.name, req);
      toast.success(t.models.updateSuccess);
    } else {
      await createModel(req);
      toast.success(t.models.createSuccess);
    }
    await refresh();
  };

  const handleDelete = async () => {
    if (!deletingModel) return;
    setDeleting(true);
    try {
      await deleteModel(deletingModel.name);
      toast.success(t.models.deleteSuccess);
      setDeletingModel(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex size-full flex-col">
      {/* Page header */}
      <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/30 to-transparent">
        {/* Decorative background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-emerald-500/5 blur-3xl" />
          <div className="absolute -bottom-16 left-1/3 size-48 rounded-full bg-teal-500/5 blur-3xl" />
        </div>

        <div className="relative flex items-center justify-between px-6 py-5">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 bg-clip-text text-transparent">
                {t.models.title}
              </span>
            </h1>
            <p className="text-muted-foreground text-sm max-w-xl">
              {t.models.description}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {models.length > 0 && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex size-2 rounded-full bg-emerald-400" />
                {models.length} 个模型
              </div>
            )}
            <Button
              onClick={handleAdd}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600 shadow-md shadow-emerald-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-emerald-500/30"
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {t.models.addModel}
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
                <div className="h-1 w-full rounded-t-xl bg-emerald-500/20" />
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
              <CpuIcon className="size-7 text-red-400" />
            </div>
            <p className="text-destructive text-sm font-medium">{error}</p>
            <Button variant="outline" onClick={refresh}>
              Retry
            </Button>
          </div>
        ) : models.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-emerald-500/10 blur-xl" />
              <div className="relative bg-emerald-500/10 flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ring-emerald-500/20">
                <CpuIcon className="text-emerald-500 h-8 w-8" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-lg">{t.models.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm max-w-sm">
                {t.models.emptyDescription}
              </p>
            </div>
            <Button
              onClick={handleAdd}
              className="mt-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {t.models.addModel}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {models.map((model) => (
              <ModelCard
                key={model.name}
                model={model}
                onEdit={handleEdit}
                onDelete={setDeletingModel}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit dialog */}
      <ModelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        model={editingModel}
        onSave={handleSave}
      />

      {/* Delete confirmation */}
      <Dialog
        open={!!deletingModel}
        onOpenChange={(open) => {
          if (!open) setDeletingModel(null);
        }}
      >
        <DialogContent className="p-0">
          <div className="h-1.5 w-full rounded-t-lg bg-gradient-to-r from-red-400 to-rose-400" />
          <DialogHeader className="px-6 pt-4">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                <AlertTriangleIcon className="h-4 w-4" />
              </span>
              {t.models.deleteModel}
            </DialogTitle>
            <DialogDescription className="pl-10">
              {t.models.deleteConfirm.replace(
                "{name}",
                deletingModel?.name ?? "",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-6 pb-5">
            <Button
              variant="outline"
              onClick={() => setDeletingModel(null)}
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
