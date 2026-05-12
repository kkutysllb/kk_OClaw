"use client";

import { AlertTriangleIcon, ClockIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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
import type { CronJobConfig } from "@/core/crons/types";
import {
  deleteCronJob,
  fetchCronJobs,
  toggleCronJob,
} from "@/core/crons/api";

import { CronCard } from "./cron-card";

export function CronGallery() {
  const { t } = useI18n();
  const router = useRouter();
  const [cronJobs, setCronJobs] = useState<Record<string, CronJobConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCronJobs();
      setCronJobs(data.cron_jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cron jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = () => {
    router.push("/workspace/chats/new?mode=cron");
  };

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await toggleCronJob(name, enabled);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Toggle failed");
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCronJob(deleteTarget);
      toast.success(t.crons.deleteSuccess);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const entries = Object.entries(cronJobs);

  return (
    <div className="flex size-full flex-col">
      {/* Page header */}
      <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/30 to-transparent">
        {/* Decorative background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-orange-500/5 blur-3xl" />
          <div className="absolute -bottom-16 left-1/3 size-48 rounded-full bg-amber-500/5 blur-3xl" />
        </div>

        <div className="relative flex items-center justify-between px-6 py-5">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-400 bg-clip-text text-transparent">
                {t.crons.title}
              </span>
            </h1>
            <p className="text-muted-foreground text-sm max-w-xl">
              {t.crons.description}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {entries.length > 0 && !loading && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex size-2 rounded-full bg-orange-400" />
                {entries.length} {t.crons.jobCount}
              </div>
            )}
            <Button
              onClick={handleAdd}
              className="bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-md shadow-orange-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-orange-500/30"
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {t.crons.addJob}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Loading state */}
        {loading && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg border bg-muted/30"
              />
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="size-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
              <ClockIcon className="size-7 text-red-400" />
            </div>
            <p className="text-destructive text-sm font-medium mb-3">{error}</p>
            <Button variant="outline" onClick={load}>
              <RefreshCwIcon className="mr-1.5 h-4 w-4" />
              {t.crons.retry}
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="relative mb-4">
              <div className="absolute inset-0 rounded-full bg-orange-500/10 blur-xl" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500/10 ring-1 ring-orange-500/20">
                <ClockIcon className="h-8 w-8 text-orange-500" />
              </div>
            </div>
            <h3 className="text-lg font-semibold">{t.crons.emptyTitle}</h3>
            <p className="text-muted-foreground mt-1 text-sm max-w-sm">
              {t.crons.emptyDescription}
            </p>
          </div>
        )}

        {/* Cards */}
        {!loading && !error && entries.length > 0 && (
          <div className="flex flex-col gap-2">
            {entries.map(([name, config]) => (
              <CronCard
                key={name}
                name={name}
                config={config}
                onToggle={handleToggle}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="p-0 sm:max-w-md">
          <div className="h-1.5 w-full rounded-t-lg bg-gradient-to-r from-red-400 to-rose-400" />
          <DialogHeader className="px-6 pt-4">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                <AlertTriangleIcon className="h-4 w-4" />
              </span>
              {t.crons.deleteJob}
            </DialogTitle>
            <DialogDescription className="pl-10">
              {t.crons.deleteConfirm.replace("{name}", deleteTarget || "")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-6 pb-5">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              className="shadow-sm"
            >
              {t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
