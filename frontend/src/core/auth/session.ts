"use client";

import { isDesktop } from "@/core/config";

const DESKTOP_SESSION_TOKEN_KEY = "oclawDesktopSessionToken";
const DESKTOP_AUTH_HEADER = "X-OClaw-Desktop";

export function getDesktopSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(DESKTOP_SESSION_TOKEN_KEY);
}

export function setDesktopSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DESKTOP_SESSION_TOKEN_KEY, token);
}

export function clearDesktopSessionToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DESKTOP_SESSION_TOKEN_KEY);
}

export function getDesktopAuthHeaders(): HeadersInit {
  return isDesktop() ? { [DESKTOP_AUTH_HEADER]: "1" } : {};
}
