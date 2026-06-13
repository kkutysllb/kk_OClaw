"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/workspace/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

/**
 * Refresh button — reloads the current page data via Next.js router.
 *
 * Uses `router.refresh()` which re-runs server components without a
 * full page reload, making it fast and smooth.
 */
export function RefreshButton({
  className,
}: {
  className?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    router.refresh();
    // Reset spinning state after a short delay
    setTimeout(() => setRefreshing(false), 800);
  };

  return (
    <Tooltip content={refreshing ? t.toolbar.refreshing : t.toolbar.refresh}>
      <Button
        size="icon"
        variant="ghost"
        className={cn("h-8 w-8", className)}
        onClick={handleRefresh}
        disabled={refreshing}
      >
        <RefreshCwIcon
          className={cn("h-4 w-4", refreshing && "animate-spin")}
        />
      </Button>
    </Tooltip>
  );
}
