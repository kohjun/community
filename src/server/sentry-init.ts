import * as Sentry from "@sentry/nextjs";
import {
  readObservabilityConfig,
  sanitizeTelemetryUrl,
  SENTRY_DATA_COLLECTION,
  scrubSensitiveStrings,
} from "../domain/observability";
import { AppError } from "./errors";

const STATE_KEY = "__sliperSentryInitialized__";

function sentryState(): { initialized: boolean; enabled: boolean } {
  const container = globalThis as unknown as Record<
    string,
    { initialized: boolean; enabled: boolean } | undefined
  >;
  if (!container[STATE_KEY]) container[STATE_KEY] = { initialized: false, enabled: false };
  return container[STATE_KEY]!;
}

export function sanitizeSentryEvent<T extends Sentry.ErrorEvent>(event: T): T | null {
  if (event.request) {
    if (event.request.url) {
      const cleanUrl = sanitizeTelemetryUrl(event.request.url);
      if (cleanUrl) event.request.url = cleanUrl;
      else delete event.request.url;
    }
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.headers) {
      const safeHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(event.request.headers)) {
        const lower = key.toLowerCase();
        if (
          [
            "cookie",
            "authorization",
            "x-forwarded-for",
            "x-real-ip",
            "cf-connecting-ip",
            "referer",
          ].includes(lower)
        )
          continue;
        if (typeof value === "string")
          safeHeaders[key] = scrubSensitiveStrings(value).slice(0, 200);
      }
      event.request.headers = safeHeaders;
    }
  }
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }
  if (typeof event.message === "string") event.message = scrubSensitiveStrings(event.message);
  if (event.exception?.values) {
    for (const item of event.exception.values) {
      if (typeof item.value === "string") item.value = scrubSensitiveStrings(item.value);
    }
  }
  return event;
}

export function sanitizeSentryBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.data && typeof breadcrumb.data === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(breadcrumb.data)) {
      const lower = key.toLowerCase();
      if (
        ["cookie", "authorization", "password", "token", "secret", "email", "phone"].includes(lower)
      )
        continue;
      if (lower === "url" && typeof value === "string") {
        next[key] = sanitizeTelemetryUrl(value);
      } else if (typeof value === "string") {
        next[key] = scrubSensitiveStrings(value).slice(0, 240);
      } else if (typeof value === "number" || typeof value === "boolean") {
        next[key] = value;
      }
    }
    breadcrumb.data = next;
  }
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = scrubSensitiveStrings(breadcrumb.message).slice(0, 240);
  }
  return breadcrumb;
}

export function initServerSentry(serviceName: string): boolean {
  const state = sentryState();
  if (state.initialized) return state.enabled;
  state.initialized = true;

  const config = readObservabilityConfig(process.env);
  if (!config.sentryServerDsn) {
    state.enabled = false;
    return false;
  }

  Sentry.init({
    dsn: config.sentryServerDsn,
    environment: config.sentryEnvironment,
    ...(config.sentryRelease ? { release: config.sentryRelease } : {}),
    tracesSampleRate: config.sentryTracesSampleRate,
    dataCollection: SENTRY_DATA_COLLECTION,
    initialScope: {
      tags: { service: serviceName },
    },
    beforeSend(event, hint) {
      const original = hint?.originalException;
      if (original instanceof AppError && original.code !== "INTERNAL") return null;
      return sanitizeSentryEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return sanitizeSentryBreadcrumb(breadcrumb);
    },
  });
  state.enabled = true;
  return true;
}

export function isServerSentryEnabled(): boolean {
  return sentryState().enabled;
}

export function captureServerException(error: unknown, tags: Record<string, string> = {}): void {
  if (!sentryState().enabled) return;
  if (error instanceof AppError && error.code !== "INTERNAL") return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(tags)) scope.setTag(key, value);
    Sentry.captureException(error);
  });
}

export async function flushServerSentry(timeoutMs = 2000): Promise<void> {
  if (!sentryState().enabled) return;
  await Sentry.flush(timeoutMs).catch(() => undefined);
}
