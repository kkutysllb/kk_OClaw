import { type ReactNode } from "react";

import { AuthProvider } from "@/core/auth/AuthProvider";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthProvider initialUser={null}>{children}</AuthProvider>;
}
