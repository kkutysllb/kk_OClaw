"use client";

import { type ReactNode, useEffect, useState } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/core/i18n/context";
import { DEFAULT_LOCALE } from "@/core/i18n/locale";
import { UpdateChecker } from "@/components/desktop/update-checker";

/**
 * Desktop-only provider wrapper for the static-export root layout.
 *
 * During `output: "export"` prerendering, `next-themes` ThemeProvider and
 * I18nProvider crash with `useContext` of null because Next.js 16 Turbopack
 * renders them server-side without a proper React context tree. To avoid
 * this, we skip mounting the providers during SSR and only mount them after
 * hydration (when `mounted` becomes true on the client).
 *
 * In the browser this is invisible — the providers mount on the first paint.
 * During prerender it renders children bare, which is safe (no context
 * consumers run server-side in the static export).
 */
export function DesktopProviders({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeProvider attribute="class" enableSystem disableTransitionOnChange>
      <I18nProvider initialLocale={DEFAULT_LOCALE}>
        {children}
        <UpdateChecker />
      </I18nProvider>
    </ThemeProvider>
  );
}
