"use client";

import { MessageCircleIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">{t.channels.title}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {t.channels.description}
          </p>
        </div>
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
        ) : channelEntries.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="bg-violet-500/10 flex h-14 w-14 items-center justify-center rounded-full">
              <MessageCircleIcon className="text-violet-500 h-7 w-7" />
            </div>
            <div>
              <p className="font-medium">{t.channels.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.channels.emptyDescription}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
