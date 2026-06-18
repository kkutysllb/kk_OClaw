"use client";

import { useEffect, useMemo, useState } from "react";

import { fetch } from "@/core/api/fetcher";
import { isDesktopBackendManagedMode } from "@/core/config";

function isDesktopProduction(): boolean {
  return isDesktopBackendManagedMode();
}

function parseUrl(url: string): URL | null {
  try {
    const base =
      typeof window !== "undefined" ? window.location.origin : "app://-";
    return new URL(url, base);
  } catch {
    return null;
  }
}

function isArtifactApiUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  return /^\/api\/threads\/[^/]+\/artifacts\//.test(parsed.pathname);
}

function revokeIfObjectUrl(url: string): void {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function filenameFromUrl(url: string): string {
  const parsed = parseUrl(url);
  const pathname = parsed?.pathname ?? url;
  const name = pathname.split("/").filter(Boolean).pop();
  return name ? decodeURIComponent(name) : "artifact";
}

function isAttachmentResponse(response: Response): boolean {
  return (
    response.headers
      .get("Content-Disposition")
      ?.toLowerCase()
      .startsWith("attachment") ?? false
  );
}

export function requiresAuthenticatedArtifactFetch(url: string): boolean {
  return isDesktopProduction() && isArtifactApiUrl(url);
}

async function fetchAuthenticatedArtifactBlob(url: string): Promise<{
  objectUrl: string;
  attachment: boolean;
}> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load artifact (${response.status})`);
  }

  return {
    objectUrl: URL.createObjectURL(await response.blob()),
    attachment: isAttachmentResponse(response),
  };
}

export async function createAuthenticatedArtifactObjectUrl(
  url: string,
): Promise<string> {
  if (!requiresAuthenticatedArtifactFetch(url)) {
    return url;
  }

  const { objectUrl } = await fetchAuthenticatedArtifactBlob(url);
  return objectUrl;
}

export function useAuthenticatedArtifactObjectUrl(
  url: string | null | undefined,
): string | undefined {
  const initialUrl = useMemo(
    () => (url && !requiresAuthenticatedArtifactFetch(url) ? url : undefined),
    [url],
  );
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(
    initialUrl,
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;

    if (!url) {
      setResolvedUrl(undefined);
      return undefined;
    }

    if (!requiresAuthenticatedArtifactFetch(url)) {
      setResolvedUrl(url);
      return undefined;
    }

    setResolvedUrl(undefined);
    void createAuthenticatedArtifactObjectUrl(url)
      .then((nextUrl) => {
        if (cancelled) {
          revokeIfObjectUrl(nextUrl);
          return;
        }
        objectUrl = nextUrl;
        setResolvedUrl(nextUrl);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.warn("[artifacts] failed to create authenticated URL:", error);
          setResolvedUrl(undefined);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) revokeIfObjectUrl(objectUrl);
    };
  }, [url]);

  return resolvedUrl;
}

export async function openArtifactUrl(
  url: string,
  _filename?: string,
): Promise<void> {
  if (requiresAuthenticatedArtifactFetch(url)) {
    const { objectUrl, attachment } = await fetchAuthenticatedArtifactBlob(url);
    if (attachment) {
      triggerDownload(objectUrl, _filename ?? filenameFromUrl(url));
      setTimeout(() => revokeIfObjectUrl(objectUrl), 0);
      return;
    }
    const opened = window.open(objectUrl, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
    setTimeout(() => revokeIfObjectUrl(objectUrl), 60_000);
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
}

export async function downloadArtifactUrl(
  url: string,
  filename?: string,
): Promise<void> {
  if (!requiresAuthenticatedArtifactFetch(url)) {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
    return;
  }

  const objectUrl = await createAuthenticatedArtifactObjectUrl(url);
  triggerDownload(objectUrl, filename ?? filenameFromUrl(url));
  setTimeout(() => revokeIfObjectUrl(objectUrl), 0);
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
