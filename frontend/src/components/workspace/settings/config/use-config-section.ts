"use client";

import { useCallback, useEffect, useState } from "react";

import {
  loadConfigSection,
  saveConfigSection,
} from "@/core/settings-config/api";

/**
 * Hook for loading and saving a single config section.
 *
 * Usage:
 * ```tsx
 * const { data, loading, saving, error, save, refresh } = useConfigSection("sandbox");
 * ```
 */
export function useConfigSection<T>(
  section: string,
  defaultValue: T,
): {
  data: T;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: (value: T) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadConfigSection(section);
      setData((result as T) ?? defaultValue);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const save = useCallback(
    async (value: T) => {
      setSaving(true);
      setError(null);
      try {
        await saveConfigSection(section, value);
        setData(value);
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [section],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, saving, error, save, refresh };
}
