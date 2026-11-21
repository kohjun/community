import * as Sentry from "@sentry/nextjs";
import {
  readObservabilityConfig,
  sanitizeTelemetryUrl,
  SENTRY_DATA_COLLECTION,
  scrubSensitiveStrings,
} from "./domain/observability";

function scrubClientEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
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
}

function scrubClientBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.category === "ui.input") return null;
  if (breadcrumb.data && typeof breadcrumb.data === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(breadcrumb.data)) {
      const lower = key.toLowerCase();
      if (
        ["cookie", "authorization", "password", "token", "secret", "email", "phone"].includes(lower)
      )
        continue;
      if ((lower === "url" || lower === "from" || lower === "to") && typeof value === "string") {
        next[key] = sanitizeTelemetryUrl(value);
      } else if (typeof value === "string") {
        next[key] = scrubSensitiveStrings(value).slice(0, 200);
      } else if (typeof value === "number" || typeof value === "boolean") {
        next[key] = value;
      }
    }
    breadcrumb.data = next;
  }
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = scrubSensitiveStrings(breadcrumb.message).slice(0, 200);
  }
  return breadcrumb;
}

try {
  const config = readObservabilityConfig({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    SLIPER_OBSERVABILITY_ENABLE_DEV: process.env.NEXT_PUBLIC_OBSERVABILITY_ENABLE_DEV,
  });

  if (config.sentryDsn && !Sentry.getClient()) {
    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.sentryEnvironment,
      ...(config.sentryRelease ? { release: config.sentryRelease } : {}),
      tracesSampleRate: config.sentryTracesSampleRate,
      dataCollection: SENTRY_DATA_COLLECTION,
      beforeSend(event) {
        return scrubClientEvent(event);
      },
      beforeBreadcrumb(breadcrumb) {
        return scrubClientBreadcrumb(breadcrumb);
      },
    });
  }
} catch {
  /* Observability must never interrupt application startup. */
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
