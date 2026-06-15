"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { uuid } from "@/core/utils/uuid";

/**
 * Extract the thread_id segment from a workspace chat URL.
 *
 * Supports both ``/workspace/chats/{thread_id}`` and
 * ``/workspace/agents/{agent_name}/chats/{thread_id}`` routes.
 *
 * In the Electron desktop build (``output: "export"``), only
 * ``/workspace/chats/new`` is pre-rendered. All other thread IDs are served
 * the same ``new.html`` file by the Electron protocol handler. Next.js
 * hydrates that file with the RSC payload baked into ``new.html`` — which
 * hard-codes ``params.thread_id = "new"``. As a result ``useParams()``
 * returns the stale value "new" even when the browser URL is
 * ``/workspace/chats/{real-uuid}``, causing every history thread to render
 * as a blank new conversation.
 *
 * Parsing the thread ID from ``usePathname()`` (which reflects the real
 * browser URL) instead of ``useParams()`` sidesteps the stale RSC payload
 * and correctly identifies the requested thread.
 */
function parseThreadIdFromPath(pathname: string | null): string {
  if (!pathname) return "new";
  // Match the last segment after /chats/ in either route shape.
  // Handles encoded agent names (e.g. /workspace/agents/my%20agent/chats/{id}).
  const match = pathname.match(/\/chats\/([^/?#]+)/);
  const raw = match?.[1];
  if (!raw) return "new";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function useThreadChat() {
  const pathname = usePathname();

  const searchParams = useSearchParams();
  const threadIdFromPath = parseThreadIdFromPath(pathname);

  const [threadId, setThreadId] = useState(() => {
    return threadIdFromPath === "new" ? uuid() : threadIdFromPath;
  });

  const [isNewThread, setIsNewThread] = useState(
    () => threadIdFromPath === "new",
  );

  useEffect(() => {
    if (pathname?.endsWith("/new")) {
      setIsNewThread(true);
      setThreadId(uuid());
      return;
    }
    if (threadIdFromPath === "new") {
      return;
    }
    setIsNewThread(false);
    setThreadId(threadIdFromPath);
  }, [pathname, threadIdFromPath]);
  const isMock = searchParams.get("mock") === "true";
  return { threadId, setThreadId, isNewThread, setIsNewThread, isMock };
}
