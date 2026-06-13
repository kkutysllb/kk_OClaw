import "@/styles/globals.css";
import "katex/dist/katex.min.css";

import { type Metadata } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { BackendStatusIndicator } from "@/components/desktop";
import { BackendSplashScreen } from "@/components/desktop";
import { DesktopInit, UpdateChecker } from "@/components/desktop";
import { I18nProvider } from "@/core/i18n/context";
import { detectLocaleServer } from "@/core/i18n/server";

export const metadata: Metadata = {
  title: "OClaw",
  description: "An AI-powered agent orchestration platform for autonomous research, coding, and content creation.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await detectLocaleServer();
  return (
    <html lang={locale} suppressContentEditableWarning suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" enableSystem disableTransitionOnChange>
          <I18nProvider initialLocale={locale}>
            <DesktopInit />
            <UpdateChecker />
            <BackendSplashScreen />
            {children}
            <BackendStatusIndicator />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
