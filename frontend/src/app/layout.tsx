import "@/styles/globals.css";
import "katex/dist/katex.min.css";

import { type ReactNode } from "react";

import { DesktopProviders } from "@/components/desktop/providers";

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <DesktopProviders>{children}</DesktopProviders>
      </body>
    </html>
  );
}
