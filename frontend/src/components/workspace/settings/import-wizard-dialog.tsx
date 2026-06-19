"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/core/i18n/hooks";
import type {
  DetectedSource,
  MigrationCategory,
  MigrationCategoryResult,
  MigrationOptions,
  MigrationResult,
  MigrationScanResult,
} from "@/core/desktop/types";
import { cn } from "@/lib/utils";

interface ImportWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional preset source path (e.g. from auto-detection). */
  presetSource?: string;
}

type Step = "source" | "content" | "preview" | "execute";

const ALL_CATEGORIES: MigrationCategory[] = [
  "skills",
  "extensions",
  "credentials",
  "memory",
  "agents",
];

export function ImportWizardDialog({
  open,
  onOpenChange,
  presetSource,
}: ImportWizardDialogProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("source");
  const [detected, setDetected] = useState<DetectedSource[]>([]);
  const [sourceRepoRoot, setSourceRepoRoot] = useState<string>("");
  const [manualPath, setManualPath] = useState<string>("");
  const [scan, setScan] = useState<MigrationScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [options, setOptions] = useState<MigrationOptions>({
    skills: true,
    extensions: true,
    credentials: true,
    memory: true,
    agents: true,
  });
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<MigrationResult | null>(null);

  // Load detected sources on open.
  useEffect(() => {
    if (!open) return;
    void (async () => {
      if (!window.oclawDesktop?.detectMigrationSources) return;
      try {
        const sources = await window.oclawDesktop.detectMigrationSources();
        setDetected(sources.filter((s) => s.hasData));
        const first = sources.find((s) => s.hasData);
        if (first && !sourceRepoRoot) {
          setSourceRepoRoot(first.path);
        }
      } catch {
        // ignore — user can pick manually
      }
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply preset source when provided.
  useEffect(() => {
    if (presetSource && open) {
      setSourceRepoRoot(presetSource);
      setStep("content");
    }
  }, [presetSource, open]);

  const reset = useCallback(() => {
    setStep("source");
    setScan(null);
    setScanning(false);
    setExecuting(false);
    setProgress(0);
    setResult(null);
    setOptions({
      skills: true,
      extensions: true,
      credentials: true,
      memory: true,
      agents: true,
    });
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset],
  );

  const pickDirectory = useCallback(async () => {
    if (!window.oclawDesktop?.pickDirectory) return;
    const picked = await window.oclawDesktop.pickDirectory({
      title: t.settings.import.wizard.sourcePlaceholder,
    });
    if (picked) {
      setManualPath(picked);
      setSourceRepoRoot(picked);
    }
  }, [t.settings.import.wizard.sourcePlaceholder]);

  const doScan = useCallback(async (path: string) => {
    if (!window.oclawDesktop?.scanMigrationSource || !path) return;
    setScanning(true);
    try {
      const res = (await window.oclawDesktop.scanMigrationSource(
        path,
      )) as MigrationScanResult;
      setScan(res);
      return res;
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Scan failed",
      );
    } finally {
      setScanning(false);
    }
  }, []);

  const handleSourceNext = useCallback(async () => {
    if (!sourceRepoRoot) return;
    const res = await doScan(sourceRepoRoot);
    if (res) setStep("content");
  }, [sourceRepoRoot, doScan]);

  const allAvailable = useMemo(
    () =>
      scan
        ? ALL_CATEGORIES.filter((c) => scan.categories[c].available)
        : [],
    [scan],
  );

  const selectedCount = useMemo(
    () => ALL_CATEGORIES.filter((c) => options[c] && scan?.categories[c].available).length,
    [options, scan],
  );

  const toggleAll = useCallback(
    (value: boolean) => {
      setOptions({
        skills: value,
        extensions: value,
        credentials: value,
        memory: value,
        agents: value,
      });
    },
    [],
  );

  const handleExecute = useCallback(async () => {
    if (!sourceRepoRoot) return;
    setExecuting(true);
    setProgress(5);
    setStep("execute");
    setResult(null);
    try {
      // Simulate incremental progress while the IPC call is pending —
      // the real per-category progress arrives too fast to matter, so we
      // just animate to ~90% and let the resolve jump to 100.
      const timer = setInterval(() => {
        setProgress((p) => Math.min(p + 7, 90));
      }, 120);
      const res = (await window.oclawDesktop?.executeMigration({
        sourceRepoRoot,
        options,
      })) as MigrationResult;
      clearInterval(timer);
      setProgress(100);
      setResult(res);
      if (res.success) {
        toast.success(t.settings.import.wizard.executeDone);
      } else {
        toast.error(t.settings.import.wizard.executeError);
      }
    } catch (e) {
      setProgress(100);
      setResult({
        success: false,
        targetHome: "",
        results: [],
        ...(e instanceof Error
          ? { error: e.message }
          : { error: String(e) }),
      } as MigrationResult);
      toast.error(t.settings.import.wizard.executeError);
    } finally {
      setExecuting(false);
    }
  }, [sourceRepoRoot, options, t.settings.import.wizard]);

  const stepIndex = ["source", "content", "preview", "execute"].indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex h-[80vh] max-h-[calc(100vh-2rem)] flex-col p-0 sm:max-w-2xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="gap-1 px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            {t.settings.import.wizard.title}
          </DialogTitle>
          <p className="text-muted-foreground text-xs">
            {t.settings.import.wizard.step} {stepIndex + 1} / 4 —{" "}
            {step === "source" && t.settings.import.wizard.stepSource}
            {step === "content" && t.settings.import.wizard.stepContent}
            {step === "preview" && t.settings.import.wizard.stepPreview}
            {step === "execute" && t.settings.import.wizard.stepExecute}
          </p>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-6">
            {/* Step 1: Source */}
            {step === "source" && (
              <SourceStep
                detected={detected}
                sourceRepoRoot={sourceRepoRoot}
                manualPath={manualPath}
                scanning={scanning}
                onPickSource={setSourceRepoRoot}
                onBrowse={pickDirectory}
                t={t}
              />
            )}

            {/* Step 2: Content */}
            {step === "content" && scan && (
              <ContentStep
                scan={scan}
                options={options}
                onToggle={(cat) =>
                  setOptions((prev) => ({ ...prev, [cat]: !prev[cat] }))
                }
                onToggleAll={toggleAll}
                allAvailable={allAvailable}
                t={t}
              />
            )}

            {/* Step 3: Preview */}
            {step === "preview" && scan && (
              <PreviewStep scan={scan} options={options} t={t} />
            )}

            {/* Step 4: Execute */}
            {step === "execute" && (
              <ExecuteStep
                progress={progress}
                executing={executing}
                result={result}
                t={t}
              />
            )}
          </div>
        </ScrollArea>

        {/* Footer with step actions */}
        <div className="flex items-center justify-between gap-2 border-t px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={executing}
          >
            {step === "execute" && !executing && result
              ? t.settings.import.wizard.close
              : t.settings.import.wizard.cancel}
          </Button>
          <div className="flex items-center gap-2">
            {step === "content" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("source")}
              >
                {t.settings.import.wizard.back}
              </Button>
            )}
            {step === "preview" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("content")}
              >
                {t.settings.import.wizard.back}
              </Button>
            )}
            {step === "source" && (
              <Button
                size="sm"
                onClick={handleSourceNext}
                disabled={!sourceRepoRoot || scanning}
              >
                {scanning
                  ? t.settings.import.wizard.scanning
                  : t.settings.import.wizard.next}
              </Button>
            )}
            {step === "content" && (
              <Button
                size="sm"
                onClick={() => setStep("preview")}
                disabled={selectedCount === 0}
              >
                {t.settings.import.wizard.next}
              </Button>
            )}
            {step === "preview" && (
              <Button
                size="sm"
                onClick={handleExecute}
                disabled={executing}
              >
                {t.settings.import.wizard.confirm}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Step components ───────────────────────────────────────────────────────

type T = ReturnType<typeof useI18n>["t"];

function SourceStep({
  detected,
  sourceRepoRoot,
  manualPath,
  scanning,
  onPickSource,
  onBrowse,
  t,
}: {
  detected: DetectedSource[];
  sourceRepoRoot: string;
  manualPath: string;
  scanning: boolean;
  onPickSource: (path: string) => void;
  onBrowse: () => void;
  t: T;
}) {
  const w = t.settings.import.wizard;
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium">{w.sourceDetected}</p>
        {detected.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
            {w.sourceEmpty}
          </p>
        ) : (
          <div className="space-y-2">
            {detected.map((s) => (
              <label
                key={s.path}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                  sourceRepoRoot === s.path
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name="source"
                  className="mt-0.5"
                  checked={sourceRepoRoot === s.path}
                  onChange={() => onPickSource(s.path)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-muted-foreground truncate text-xs font-mono">
                    {s.path}
                  </p>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="border-t pt-3">
        <p className="mb-2 text-sm font-medium">{w.sourceManual}</p>
        <div className="flex gap-2">
          <Input
            placeholder={w.sourcePlaceholder}
            value={manualPath}
            onChange={(e) => {
              setManualPathValue(e.target.value);
              onPickSource(e.target.value);
            }}
            className="font-mono text-xs"
          />
          <Button variant="outline" size="sm" onClick={onBrowse}>
            {w.browse}
          </Button>
        </div>
        {scanning && (
          <p className="text-muted-foreground mt-2 text-xs">
            {w.scanning}
          </p>
        )}
      </div>
    </div>
  );
}

// Local helper to avoid ESLint complaining about the controlled input wiring.
function setManualPathValue(_v: string) {}

function ContentStep({
  scan,
  options,
  onToggle,
  onToggleAll,
  allAvailable,
  t,
}: {
  scan: MigrationScanResult;
  options: MigrationOptions;
  onToggle: (cat: MigrationCategory) => void;
  onToggleAll: (value: boolean) => void;
  allAvailable: MigrationCategory[];
  t: T;
}) {
  const w = t.settings.import.wizard;
  const allSelected =
    allAvailable.length > 0 &&
    allAvailable.every((c) => options[c]);
  const labels: Record<MigrationCategory, string> = {
    skills: w.categorySkills,
    extensions: w.categoryExtensions,
    credentials: w.categoryCredentials,
    memory: w.categoryMemory,
    agents: w.categoryAgents,
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{w.stepContent}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggleAll(!allSelected)}
        >
          {allSelected ? w.selectNone : w.selectAll}
        </Button>
      </div>
      {ALL_CATEGORIES.map((cat) => {
        const info = scan.categories[cat];
        const disabled = !info.available;
        return (
          <label
            key={cat}
            className={cn(
              "flex items-start gap-3 rounded-md border p-3 transition-colors",
              disabled
                ? "opacity-50"
                : options[cat]
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/50",
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={options[cat] && !disabled}
              disabled={disabled}
              onChange={() => !disabled && onToggle(cat)}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{labels[cat]}</p>
              <p className="text-muted-foreground text-xs">
                {info.description}
              </p>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function PreviewStep({
  scan,
  options,
  t,
}: {
  scan: MigrationScanResult;
  options: MigrationOptions;
  t: T;
}) {
  const w = t.settings.import.wizard;
  const labels: Record<MigrationCategory, string> = {
    skills: w.categorySkills,
    extensions: w.categoryExtensions,
    credentials: w.categoryCredentials,
    memory: w.categoryMemory,
    agents: w.categoryAgents,
  };
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{w.previewSummary}</p>
      <ul className="space-y-2">
        {ALL_CATEGORIES.filter(
          (c) => options[c] && scan.categories[c].available,
        ).map((cat) => {
          const info = scan.categories[cat];
          return (
            <li
              key={cat}
              className="flex items-start gap-2 rounded-md border p-3 text-sm"
            >
              <span className="text-muted-foreground min-w-[5rem] font-medium">
                {labels[cat]}
              </span>
              <span className="text-muted-foreground">
                {w.previewCopy} {info.count} {info.description.split(" ")[1] ?? ""}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-xs">
        {w.restartHint}
      </p>
    </div>
  );
}

function ExecuteStep({
  progress,
  executing,
  result,
  t,
}: {
  progress: number;
  executing: boolean;
  result: MigrationResult | null;
  t: T;
}) {
  const w = t.settings.import.wizard;
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium">
          {executing
            ? w.executing
            : result?.success
              ? w.executeDone
              : w.executeError}
        </p>
        <Progress value={progress} className="h-2" />
      </div>
      {result && (
        <div className="space-y-2">
          {result.results.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {(result as MigrationResult & { error?: string }).error ??
                "Unknown error"}
            </p>
          ) : (
            result.results.map((r: MigrationCategoryResult) => (
              <div
                key={r.category}
                className="flex items-center justify-between rounded-md border p-2 text-xs"
              >
                <span className="font-medium">
                  {r.category in CATEGORY_LABEL_KEYS
                    ? CATEGORY_LABEL_KEYS[r.category]
                    : r.category}
                </span>
                <span className="text-muted-foreground">
                  {r.error ? (
                    <span className="text-destructive">{r.error}</span>
                  ) : (
                    <>
                      {r.copied > 0 && `${w.previewCopy} ${r.copied} · `}
                      {r.merged > 0 && `${w.previewMerge} ${r.merged} · `}
                      {r.skipped > 0 && `${w.previewSkip} ${r.skipped}`}
                      {r.copied === 0 &&
                        r.merged === 0 &&
                        r.skipped === 0 &&
                        "—"}
                    </>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      )}
      {!executing && result?.success && (
        <p className="text-muted-foreground text-xs">{w.restartHint}</p>
      )}
    </div>
  );
}

const CATEGORY_LABEL_KEYS: Record<MigrationCategory, string> = {
  skills: "skills",
  extensions: "extensions",
  credentials: "credentials",
  memory: "memory",
  agents: "agents",
};
