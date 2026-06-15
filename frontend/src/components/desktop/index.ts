/**
 * Barrel exports for desktop (Electron) integration components.
 *
 * Every component is a no-op in the web build (`isDesktop()` guard).
 */
export { BackendStatusIndicator } from "./backend-status";
export { BackendSplashScreen } from "./backend-splash";
export { DesktopInit } from "./desktop-init";
export { DesktopProviders } from "./providers";
export { UpdateChecker } from "./update-checker";
