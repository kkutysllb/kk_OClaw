"use client";

import { FolderPlusIcon, FolderOpenIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isDesktop } from "@/core/config";
import { pickDirectory } from "@/core/desktop";
import { useCreateProject } from "@/core/projects";

interface CreateProjectDialogProps {
  children?: React.ReactNode;
  onCreated?: (projectId: string) => void;
}

export function CreateProjectDialog({
  children,
  onCreated,
}: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [description, setDescription] = useState("");
  const createProject = useCreateProject();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;

    try {
      const project = await createProject.mutateAsync({
        name: name.trim(),
        path: path.trim(),
        description: description.trim(),
      });
      toast.success(`项目「${project.name}」创建成功`);
      setOpen(false);
      setName("");
      setPath("");
      setDescription("");
      onCreated?.(project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建项目失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600">
            <FolderPlusIcon className="mr-1.5 h-4 w-4" />
            添加项目
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>注册 Coding 项目</DialogTitle>
          <DialogDescription>
            指向本地代码仓库目录，开始使用 Coding Agent。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="project-name" className="text-sm font-medium">项目名称</label>
            <Input
              id="project-name"
              placeholder="my-awesome-project"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="project-path" className="text-sm font-medium">项目路径</label>
            <div className="flex gap-2">
              <Input
                id="project-path"
                placeholder="/Users/you/projects/my-repo"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                required
                className="flex-1"
              />
              {isDesktop() && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    const dir = await pickDirectory({ title: "选择项目目录" });
                    if (dir) setPath(dir);
                  }}
                  title="浏览目录"
                >
                  <FolderOpenIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              本地代码仓库的根目录路径
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="project-desc" className="text-sm font-medium">描述（可选）</label>
            <Textarea
              id="project-desc"
              placeholder="简要描述这个项目..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={createProject.isPending || !name.trim() || !path.trim()}
            >
              {createProject.isPending ? "创建中..." : "创建项目"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
