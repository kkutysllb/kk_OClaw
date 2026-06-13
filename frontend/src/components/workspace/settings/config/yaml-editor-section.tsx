"use client";

import yaml from "js-yaml";
import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";


import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { loadConfig, saveFullConfig } from "@/core/settings-config/api";

const hintCls = "mt-0.5 text-xs text-muted-foreground";

export function YamlEditorSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [yamlText, setYamlText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const config = await loadConfig();
        const text = yaml.dump(config, {
          sortKeys: false,
          lineWidth: 100,
        });
        if (!cancelled) {
          setYamlText(text);
          setOriginalText(text);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = yamlText !== originalText;

  const handleSave = async () => {
    // Validate YAML first
    let parsed: unknown;
    try {
      parsed = yaml.load(yamlText);
    } catch {
      toast.error("YAML 语法错误，请检查格式");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      toast.error("配置根节点必须是 YAML 字典（key: value）");
      return;
    }

    setSaving(true);
    try {
      const result = await saveFullConfig(parsed as Record<string, unknown>);
      const newText = yaml.dump(result, {
        sortKeys: false,
        lineWidth: 100,
      });
      setYamlText(newText);
      setOriginalText(newText);
      toast.success("配置已保存");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "保存失败",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">高级 YAML 编辑器</h4>
        <p className={hintCls}>
          直接编辑完整 config.yaml。适合高级用户配置没有专用表单的选项。
          注意：api_key 等敏感值在读取时会显示为 ***, 保存时请使用 $ENV_VAR 引用
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      ) : (
        <>
          <Textarea
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            disabled={saving}
            className="min-h-[400px] resize-y font-mono text-xs leading-relaxed"
            spellCheck={false}
          />

          <div className="flex items-center gap-2">
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
                onClick={() => setYamlText(originalText)}
                disabled={saving}
              >
                重置
              </Button>
            )}
            {dirty && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                有未保存的更改
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
