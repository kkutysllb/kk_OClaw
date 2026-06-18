"use client";

import {
  AlertTriangleIcon,
  CpuIcon,
  Edit2Icon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
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
import { ModelDialog } from "@/components/workspace/models/model-dialog";
import {
  loadModels,
  createModel,
  updateModel,
  deleteModel,
} from "@/core/models/api";
import type { Model, ModelRequest } from "@/core/models/types";

export function ModelConfigSection() {
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
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
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
    } else {
      await createModel(req);
    }
    await refresh();
  };

  const handleDelete = async () => {
    if (!deletingModel) return;
    const target = deletingModel;
    setDeleting(true);
    // Optimistic removal: hide the row immediately so the UI feels instant.
    // If the server rejects the delete we re-fetch to restore.
    setModels((prev) => prev.filter((m) => m.name !== target.name));
    setDeletingModel(null);
    try {
      await deleteModel(target.name);
      // Confirm with a fresh server read to catch any drift.
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      // Restore on failure.
      setModels((prev) =>
        prev.some((m) => m.name === target.name) ? prev : [...prev, target],
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">模型管理</h4>
          <p className="text-muted-foreground text-xs">
            配置可用的 AI 模型，更改保存后自动生效
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleAdd}
          className="w-fit bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600 sm:self-auto"
        >
          <PlusIcon className="mr-1 h-3.5 w-3.5" />
          添加模型
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-muted/30 h-16 animate-pulse rounded-lg border"
            />
          ))}
        </div>
      ) : error ? (
        <div className="border-destructive/20 bg-destructive/5 flex flex-col items-center gap-2 rounded-lg border py-8 text-center">
          <p className="text-destructive text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={refresh}>
            重试
          </Button>
        </div>
      ) : models.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-cyan-500/10">
            <CpuIcon className="size-6 text-cyan-500" />
          </div>
          <div>
            <p className="text-sm font-medium">暂无模型</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              添加你的第一个 AI 模型以开始使用
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAdd}
            className="mt-1"
          >
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            添加模型
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {models.map((model) => (
            <div
              key={model.name}
              className="group bg-muted/20 hover:bg-muted/40 flex min-w-0 items-center gap-3 rounded-lg border p-3 transition-colors"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500">
                <CpuIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {model.display_name || model.name}
                  </span>
                  {model.supports_thinking && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      思考
                    </span>
                  )}
                  {model.supports_vision && (
                    <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                      视觉
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground truncate font-mono text-xs">
                  {model.model}
                  <span className="mx-1">·</span>
                  {model.use}
                </p>
              </div>
              <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 hover:bg-cyan-500/10 hover:text-cyan-500"
                  onClick={() => handleEdit(model)}
                >
                  <Edit2Icon className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-destructive/10 hover:text-destructive size-8"
                  onClick={() => setDeletingModel(model)}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit dialog (reuse existing ModelDialog) */}
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
              <span className="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                <AlertTriangleIcon className="size-4" />
              </span>
              删除模型
            </DialogTitle>
            <DialogDescription className="pl-10">
              确定要删除模型 &ldquo;{deletingModel?.name}&rdquo;
              吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-6 pb-5">
            <Button
              variant="outline"
              onClick={() => setDeletingModel(null)}
              disabled={deleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "删除中…" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
