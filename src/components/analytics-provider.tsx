"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { ObservabilityClientConfig } from "@/domain/observability";
import {
  ensureClientSentry,
  initPostHog,
  setAnalyticsOptOut,
  trackPageview,
} from "@/lib/analytics-client";
import { useSession } from "./session-provider";

/**
 * Runtime observability bootstrapper.
 * - Initializes client Sentry if supplied via runtime server config.
 * - Initializes PostHog in minimum-burden mode (session replay OFF, autocapture OFF, no cookies).
 * - Automatically opts out staff accounts and profiles with analyticsExcluded=true.
 */
export function AnalyticsProvider({ config }: { config: ObservabilityClientConfig }) {
  const pathname = usePathname();
  const { session, ready } = useSession();
  const lastTrackedPath = useRef<string>("");
  const posthogReady = useRef(false);

  const excluded = Boolean(session?.role || session?.analyticsExcluded);

  useEffect(() => {
    if (config.sentryDsn) void ensureClientSentry(config);
  }, [config]);

  useEffect(() => {
    setAnalyticsOptOut(excluded);
    if (!ready || excluded || !config.posthogKey) return;
    let active = true;
    void initPostHog(config).then((client) => {
      if (!active || !client) return;
      posthogReady.current = true;
      if (pathname && lastTrackedPath.current !== pathname) {
        lastTrackedPath.current = pathname;
        trackPageview(pathname);
      }
    });
    return () => {
      active = false;
    };
  }, [config, excluded, ready, pathname]);

  useEffect(() => {
    if (!posthogReady.current || excluded || !pathname || lastTrackedPath.current === pathname)
      return;
    lastTrackedPath.current = pathname;
    trackPageview(pathname);
  }, [pathname, excluded]);

  return null;
}
