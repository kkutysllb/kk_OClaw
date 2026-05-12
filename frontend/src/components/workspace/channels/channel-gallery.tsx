"use client";

import { MessageCircleIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  fetchChannelConfigs,
  restartChannel,
  updateChannelConfig,
  type ChannelConfigItem,
} from "@/core/channels/api";

import { ChannelCard } from "./channel-card";
import { ChannelDialog } from "./channel-dialog";
import { toast } from "sonner";

export function ChannelGallery() {
  const { t } = useI18n();
  const [channels, setChannels] = useState<Record<string, ChannelConfigItem>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<ChannelConfigItem | null>(
    null,
  );

  // Restart state
  const [restarting, setRestarting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchChannelConfigs();
      setChannels(data.channels);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleEdit = (name: string) => {
    setEditingChannel(name);
    setEditingConfig(channels[name] ?? null);
    setDialogOpen(true);
  };

  const handleSave = async (
    name: string,
    enabled: boolean,
    creds: Record<string, string>,
  ) => {
    await updateChannelConfig(name, enabled, creds);
    toast.success(t.channels.saveSuccess);
    await refresh();
  };

  const handleRestart = async (name: string) => {
    setRestarting(name);
    try {
      const res = await restartChannel(name);
      if (res.success) {
        toast.success(t.channels.restartSuccess);
      } else {
        toast.error(res.message);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restart");
    } finally {
      setRestarting(null);
    }
  };

  const channelEntries = Object.entries(channels);

  return (
    <div className="flex size-full flex-col">
      {/* Page header */}
      <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/30 to-transparent">
        {/* Decorative background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-blue-500/5 blur-3xl" />
          <div className="absolute -bottom-16 left-1/3 size-48 rounded-full bg-cyan-500/5 blur-3xl" />
        </div>

        <div className="relative flex items-center justify-between px-6 py-5">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-blue-500 via-cyan-400 to-sky-400 bg-clip-text text-transparent">
                {t.channels.title}
              </span>
            </h1>
            <p className="text-muted-foreground text-sm max-w-xl">
              {t.channels.description}
            </p>
          </div>
          {channelEntries.length > 0 && !loading && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex size-2 rounded-full bg-blue-400" />
              {channelEntries.length} 个渠道
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg border bg-muted/30"
              />
            ))}
          </div>
        ) : error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="size-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
              <MessageCircleIcon className="size-7 text-red-400" />
            </div>
            <p className="text-destructive text-sm font-medium">{error}</p>
            <Button variant="outline" onClick={refresh}>
              Retry
            </Button>
          </div>
        ) : channelEntries.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-blue-500/10 blur-xl" />
              <div className="relative bg-blue-500/10 flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ring-blue-500/20">
                <MessageCircleIcon className="text-blue-500 h-8 w-8" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-lg">{t.channels.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm max-w-sm">
                {t.channels.emptyDescription}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {channelEntries.map(([name, config]) => (
              <ChannelCard
                key={name}
                name={name}
                config={config}
                onEdit={handleEdit}
                onRestart={handleRestart}
                restarting={restarting === name}
              />
            ))}
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <ChannelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        name={editingChannel}
        config={editingConfig}
        onSave={handleSave}
      />
    </div>
  );
}
