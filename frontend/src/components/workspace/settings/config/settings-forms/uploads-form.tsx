"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { useConfigSection } from "../use-config-section";

const labelCls = "text-sm font-medium leading-none";
const hintCls = "mt-0.5 text-xs text-muted-foreground";

interface UploadsConfig {
  max_files: number;
  max_file_size: number;
  max_total_size: number;
  auto_convert_documents: boolean;
  pdf_converter: string;
}

const defaultConfig: UploadsConfig = {
  max_files: 10,
  max_file_size: 52428800, // 50 MiB
  max_total_size: 104857600, // 100 MiB
  auto_convert_documents: false,
  pdf_converter: "auto",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
}

export function UploadsForm() {
  const { data, loading, saving, save } = useConfigSection<UploadsConfig>(
    "uploads",
    defaultConfig,
  );
  const [local, setLocal] = useState<UploadsConfig>(data);

  useEffect(() => {
    setLocal(data);
  }, [data]);

  const dirty = JSON.stringify(local) !== JSON.stringify(data);

  const update = <K extends keyof UploadsConfig>(
    key: K,
    value: UploadsConfig[K],
  ) => setLocal((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    try {
      await save(local);
      toast.success("上传限制配置已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">上传限制 (Uploads)</h4>
        <p className={hintCls}>控制用户上传文件的数量和大小限制</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <label className={labelCls}>最大文件数</label>
              <Input
                type="number"
                min={1}
                max={100}
                value={local.max_files}
                onChange={(e) => update("max_files", Number(e.target.value))}
                disabled={saving}
              />
            </div>
            <div className="grid gap-1.5">
              <label className={labelCls}>单文件上限 (bytes)</label>
              <Input
                type="number"
                min={1}
                value={local.max_file_size}
                onChange={(e) =>
                  update("max_file_size", Number(e.target.value))
                }
                disabled={saving}
              />
              <p className={hintCls}>{formatBytes(local.max_file_size)}</p>
            </div>
            <div className="grid gap-1.5">
              <label className={labelCls}>总大小上限 (bytes)</label>
              <Input
                type="number"
                min={1}
                value={local.max_total_size}
                onChange={(e) =>
                  update("max_total_size", Number(e.target.value))
                }
                disabled={saving}
              />
              <p className={hintCls}>{formatBytes(local.max_total_size)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div>
              <p className={labelCls}>自动转换文档</p>
              <p className={hintCls}>
                将 PDF / Word / Excel 等文档自动转换为纯文本
              </p>
            </div>
            <Switch
              checked={local.auto_convert_documents}
              onCheckedChange={(v) => update("auto_convert_documents", v)}
              disabled={saving}
            />
          </div>

          <div className="grid gap-2">
            <label className={labelCls}>PDF 转换器</label>
            <Select
              value={local.pdf_converter}
              onValueChange={(v) => update("pdf_converter", v)}
            >
              <SelectTrigger className="w-48" disabled={saving}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动检测 (auto)</SelectItem>
                <SelectItem value="pymupdf">PyMuPDF</SelectItem>
                <SelectItem value="pdfplumber">pdfplumber</SelectItem>
              </SelectContent>
            </Select>
            <p className={hintCls}>指定 PDF 文件转文本时使用的库</p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              disabled={!dirty || saving}
              onClick={handleSave}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
            {dirty && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocal(data)}
                disabled={saving}
              >
                重置
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
