import type { NextConfig } from "next";
import { WORKSPACE_REDIRECTS } from "./src/domain/workspace-navigation";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    agentUpgrade: "security",
  },
  // FFmpeg is loaded only by the dedicated video worker, never by web routes.
  // Credentials and mutable development data must never travel in server bundles.
  outputFileTracingExcludes: {
    "/*": ["./.env*", "./.local/**/*", "./.git/**/*", "./.npm-cache/**/*"],
  },
  // Resolve the retired directory before its loading boundary can start streaming.
  async redirects() {
    return [
      { source: "/crews", destination: "/players?tab=crews", permanent: true },
      ...WORKSPACE_REDIRECTS,
    ];
  },
  async headers() {
    return [
      {
        source: "/models/vision/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" },
        ],
      },
      {
        source: "/games/clue/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
      {
        source: "/images/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  poweredByHeader: false,
  devIndicators: false,
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.SLIPER_LAN_HOST ? [process.env.SLIPER_LAN_HOST] : []),
  ],
};

export default nextConfig;
