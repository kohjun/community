"use client";
import type { PostHog } from "posthog-js";
import {
  sanitizeRoutePath,
  sanitizeTelemetryUrl,
  SENTRY_DATA_COLLECTION,
  scrubSensitiveStrings,
  type ObservabilityClientConfig,
} from "@/domain/observability";

export interface AnalyticsEventMap {
  home_banner_click: { posterId: string; slideIndex: number };
  home_quick_link_click: { destination: string; audience: "participant" | "host" };
  audience_mode_switch: { audience: "participant" | "host" };
  event_apply_submitted: { meetupType: "event" | "lightning"; paid: boolean };
  web_game_selected: { gameType: string };
  web_game_room_created: { gameType: string; fromTown: boolean };
  web_game_room_joined: { gameType: string; isHost: boolean };
  web_game_started: { gameType: string };
  snap_pang_round_completed: { roundKind: string; mode: string };
  post_published: { kind: string; category: string; isEdit: boolean };
  search_submitted: {
    type: string;
    hasCategory: boolean;
    hasDiscussionType: boolean;
    queryLengthBucket: "0" | "1-3" | "4-10" | "11+";
  };
}

export type AnalyticsEventName = keyof AnalyticsEventMap;

let posthogInstance: PostHog | null = null;
let posthogLoading: Promise<PostHog | null> | null = null;
let optedOut = false;
let sentryBootstrapped = false;

export async function ensureClientSentry(config: ObservabilityClientConfig): Promise<void> {
  if (!config.sentryDsn || sentryBootstrapped || typeof window === "undefined") return;
  sentryBootstrapped = true;
  try {
    const Sentry = await import("@sentry/nextjs");
    if (Sentry.getClient()) return;
    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.sentryEnvironment,
      ...(config.sentryRelease ? { release: config.sentryRelease } : {}),
      tracesSampleRate: config.sentryTracesSampleRate,
      dataCollection: SENTRY_DATA_COLLECTION,
      beforeSend(event) {
        if (event.request) {
          if (event.request.url) {
            const cleanUrl = sanitizeTelemetryUrl(event.request.url);
            if (cleanUrl) event.request.url = cleanUrl;
            else delete event.request.url;
          }
          delete event.request.cookies;
          delete event.request.data;
          delete event.request.query_string;
          delete event.request.headers;
        }
        if (event.user) {
          delete event.user.email;
          delete event.user.ip_address;
          delete event.user.username;
        }
        if (typeof event.message === "string") {
          event.message = scrubSensitiveStrings(event.message);
        }
        if (event.exception?.values) {
          for (const item of event.exception.values) {
            if (typeof item.value === "string") item.value = scrubSensitiveStrings(item.value);
          }
        }
        return event;
      },
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.category === "ui.input") return null;
        if (breadcrumb.data && typeof breadcrumb.data === "object") {
          const next: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(breadcrumb.data)) {
            const lower = key.toLowerCase();
            if (
              ["cookie", "authorization", "password", "token", "secret", "email", "phone"].includes(
                lower,
              )
            )
              continue;
            if (
              (lower === "url" || lower === "from" || lower === "to") &&
              typeof value === "string"
            ) {
              next[key] = sanitizeTelemetryUrl(value);
            } else if (typeof value === "string") {
              next[key] = scrubSensitiveStrings(value).slice(0, 200);
            } else if (typeof value === "number" || typeof value === "boolean") {
              next[key] = value;
            }
          }
          breadcrumb.data = next;
        }
        return breadcrumb;
      },
    });
  } catch {
    /* Client Sentry must never break page rendering. */
  }
}

export function captureClientException(error: unknown, tags: Record<string, string> = {}): void {
  if (typeof window === "undefined") return;
  void import("@sentry/nextjs")
    .then((Sentry) => {
      if (!Sentry.getClient()) return;
      Sentry.withScope((scope) => {
        for (const [key, value] of Object.entries(tags)) scope.setTag(key, value);
        Sentry.captureException(error);
      });
    })
    .catch(() => undefined);
}

export async function initPostHog(config: ObservabilityClientConfig): Promise<PostHog | null> {
  if (typeof window === "undefined" || !config.posthogKey || optedOut) return null;
  if (posthogInstance) return posthogInstance;
  if (posthogLoading) return posthogLoading;

  posthogLoading = import("posthog-js")
    .then(({ default: posthog }) => {
      if (optedOut) return null;
      posthog.init(config.posthogKey!, {
        api_host: config.posthogHost,
        ui_host: config.posthogUiHost,
        person_profiles: "identified_only",
        persistence: "localStorage",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: true,
        disable_session_recording: true,
        disable_surveys: true,
        disable_external_dependency_loading: true,
        mask_all_text: true,
        mask_all_element_attributes: true,
        respect_dnt: true,
        sanitize_properties(properties) {
          const next = { ...properties };
          if (typeof next.$current_url === "string") {
            next.$current_url = sanitizeTelemetryUrl(next.$current_url) ?? "/";
          }
          if (typeof next.$pathname === "string") {
            next.$pathname = sanitizeRoutePath(next.$pathname);
          }
          if (typeof next.$referrer === "string") {
            next.$referrer = sanitizeTelemetryUrl(next.$referrer) ?? "";
          }
          return next;
        },
      });
      posthogInstance = posthog;
      return posthog;
    })
    .catch(() => null);

  return posthogLoading;
}

export function setAnalyticsOptOut(excluded: boolean): void {
  optedOut = excluded;
  if (!posthogInstance) return;
  try {
    if (excluded) posthogInstance.opt_out_capturing();
    else posthogInstance.opt_in_capturing();
  } catch {
    /* Analytics state changes must never throw. */
  }
}

export function trackPageview(pathname: string): void {
  if (optedOut || !posthogInstance || typeof window === "undefined") return;
  try {
    const cleanPath = sanitizeRoutePath(pathname);
    posthogInstance.capture("$pageview", {
      $current_url: `${window.location.origin}${cleanPath}`,
      $pathname: cleanPath,
    });
  } catch {
    /* Never block navigation on analytics errors. */
  }
}

export function trackEvent<K extends AnalyticsEventName>(
  event: K,
  properties: AnalyticsEventMap[K],
): void {
  if (optedOut || !posthogInstance) return;
  try {
    posthogInstance.capture(event, properties);
  } catch {
    /* Never block user interactions on analytics errors. */
  }
}
