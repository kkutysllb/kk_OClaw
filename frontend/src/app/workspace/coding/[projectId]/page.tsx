"use client";

import { usePathname } from "next/navigation";

import { CodingWorkbench } from "@/components/workspace/coding/coding-workbench";

/**
 * Parse the projectId segment from the URL path.
 *
 * In the desktop static export build (``output: "export"``), only
 * ``/workspace/coding/__init__`` is pre-rendered. All other project IDs are
 * served the same ``__init__.html`` file. Next.js hydrates that file with
 * the RSC payload baked into it — which hard-codes
 * ``params.projectId = "__init__"``. As a result ``useParams()`` returns
 * the stale value "__init__" even when the browser URL is
 * ``/workspace/coding/{real-id}``.
 *
 * Parsing from ``usePathname()`` (which reflects the real browser URL)
 * sidesteps the stale RSC payload.
 */
function parseProjectIdFromPath(pathname: string | null): string {
  if (!pathname) return "";
  const match = pathname.match(/\/workspace\/coding\/([^/?#]+)/);
  const raw = match?.[1];
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function CodingProjectPage() {
  const pathname = usePathname();
  const projectId = parseProjectIdFromPath(pathname);
  return <CodingWorkbench projectId={projectId} />;
}
