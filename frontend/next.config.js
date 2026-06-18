/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

function getInternalServiceURL(envKey, fallbackURL) {
  const configured = process.env[envKey]?.trim();
  return configured && configured.length > 0
    ? configured.replace(/\/+$/, "")
    : fallbackURL;
}
import nextra from "nextra";

const isDesktopBuild = process.env.DESKTOP_BUILD === "true" || process.env.DESKTOP_BUILD === "1";
const desktopDevOrigins = ["127.0.0.1", "localhost"];

// Nextra injects documentation routes and its own _global-error handling that
// are incompatible with `output: "export"` (causes LayoutRouterContext null
// errors during prerendering). Skip the Nextra wrapper entirely for desktop
// static-export builds — the desktop app doesn't include the docs site.
const withNextra = isDesktopBuild
  ? (config) => config
  : nextra({});

/** @type {import("next").NextConfig} */
const config = {
  allowedDevOrigins: desktopDevOrigins,
  // Desktop production builds use static export (no server, no SSR).
  // i18n and rewrites are incompatible with output: "export".
  ...(isDesktopBuild
    ? {
        output: "export",
        images: { unoptimized: true },
        // Electron serves the static export via the app://- custom scheme.
        // Absolute paths resolve against the scheme root, so we MUST NOT use
        // "./" (relative) here because
        // webpack would resolve chunk URLs relative to window.location,
        // breaking all sub-route pages (e.g. /workspace/coding/xxx would
        // request /workspace/coding/_next/... instead of /_next/...,
        // causing chunk 404 → global-error).
      }
    : {
        i18n: {
          locales: ["en", "zh"],
          defaultLocale: "en",
        },
        async rewrites() {
          const rewrites = [];
          const gatewayURL = getInternalServiceURL(
            "KKOCLAW_INTERNAL_GATEWAY_BASE_URL",
            "http://127.0.0.1:9193",
          );

          if (!process.env.NEXT_PUBLIC_LANGGRAPH_BASE_URL) {
            rewrites.push({
              source: "/api/langgraph",
              destination: `${gatewayURL}/api`,
            });
            rewrites.push({
              source: "/api/langgraph/:path*",
              destination: `${gatewayURL}/api/:path*`,
            });
          }

          if (!process.env.NEXT_PUBLIC_BACKEND_BASE_URL) {
            rewrites.push({
              source: "/health",
              destination: `${gatewayURL}/health`,
            });
            rewrites.push({
              source: "/api/agents",
              destination: `${gatewayURL}/api/agents`,
            });
            rewrites.push({
              source: "/api/agents/:path*",
              destination: `${gatewayURL}/api/agents/:path*`,
            });
            rewrites.push({
              source: "/api/skills",
              destination: `${gatewayURL}/api/skills`,
            });
            rewrites.push({
              source: "/api/skills/:path*",
              destination: `${gatewayURL}/api/skills/:path*`,
            });

            // Catch-all for remaining gateway API routes (models, threads, memory,
            // mcp, artifacts, uploads, suggestions, runs, etc.) that don't have
            // their own NEXT_PUBLIC_* env var toggle.
            //
            // NOTE: this must come AFTER the /api/langgraph rewrite above so that
            // LangGraph-compatible routes keep their public prefix while Gateway
            // receives its native /api/* paths.
            rewrites.push({
              source: "/api/:path*",
              destination: `${gatewayURL}/api/:path*`,
            });
          }

          return rewrites;
        },
      }),
  devIndicators: false,
};

export default withNextra(config);
