"use client";

import { CpuIcon, PlusIcon } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
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
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">{t.models.title}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {t.models.description}
          </p>
        </div>
        <Button onClick={handleAdd}>
          <PlusIcon className="mr-1.5 h-4 w-4" />
          {t.models.addModel}
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
        ) : models.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="bg-emerald-500/10 flex h-14 w-14 items-center justify-center rounded-full">
              <CpuIcon className="text-emerald-500 h-7 w-7" />
            </div>
            <div>
              <p className="font-medium">{t.models.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.models.emptyDescription}
              </p>
            </div>
            <Button variant="outline" className="mt-2" onClick={handleAdd}>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.models.deleteModel}</DialogTitle>
            <DialogDescription>
              {t.models.deleteConfirm.replace(
                "{name}",
                deletingModel?.name ?? "",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
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
            >
              {deleting ? t.common.loading : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
