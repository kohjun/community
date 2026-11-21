export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
};

export type PostHogCloudHost = "https://us.i.posthog.com" | "https://eu.i.posthog.com";

export interface ObservabilityClientConfig {
  sentryDsn: string | null;
  sentryEnvironment: string;
  sentryRelease: string | null;
  sentryTracesSampleRate: number;
  posthogKey: string | null;
  posthogHost: PostHogCloudHost;
  posthogUiHost: "https://us.posthog.com" | "https://eu.posthog.com";
  sessionReplayEnabled: false;
}

export interface ObservabilityServerConfig extends ObservabilityClientConfig {
  sentryServerDsn: string | null;
}

const POSTHOG_CLOUD_HOSTS: Record<
  PostHogCloudHost,
  { ui: "https://us.posthog.com" | "https://eu.posthog.com" }
> = {
  "https://us.i.posthog.com": {
    ui: "https://us.posthog.com",
  },
  "https://eu.i.posthog.com": {
    ui: "https://eu.posthog.com",
  },
};

const CONTROL_OR_SPACE = /[\s\\\u0000-\u001f\u007f]/;
const POSTHOG_KEY_RE = /^phc_[A-Za-z0-9_-]{12,128}$/;
const RELEASE_RE = /^[A-Za-z0-9._:@/-]{1,80}$/;
const ENV_RE = /^[a-z0-9._-]{1,40}$/i;

export function parseSentryDsn(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 300 || CONTROL_OR_SPACE.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    if (!url.username || url.password) return null;
    if (!/^[a-f0-9]{16,64}$/i.test(url.username)) return null;
    if (!/^\/[0-9]{1,20}$/.test(url.pathname)) return null;
    if (url.search || url.hash) return null;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parsePostHogKey(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || CONTROL_OR_SPACE.test(trimmed)) return null;
  return POSTHOG_KEY_RE.test(trimmed) ? trimmed : null;
}

export function parsePostHogHost(value: string | undefined): PostHogCloudHost {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (trimmed === "https://eu.i.posthog.com" || trimmed === "https://eu.posthog.com") {
    return "https://eu.i.posthog.com";
  }
  return "https://us.i.posthog.com";
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

function parseRelease(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !RELEASE_RE.test(trimmed)) return null;
  return trimmed;
}

function parseEnvironment(env: Record<string, string | undefined>): string {
  const raw = (env.SENTRY_ENVIRONMENT ?? env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "")
    .trim()
    .toLowerCase();
  if (raw && ENV_RE.test(raw)) return raw;
  return "development";
}

function telemetryAllowedInRuntime(env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV === "test") return false;
  if (env.SLIPER_OBSERVABILITY_ENABLE_DEV === "true") return true;
  if (env.NODE_ENV !== "production") return false;
  if (env.LOCAL_DATABASE === "1") return false;
  return true;
}

/**
 * Reads runtime observability settings. Missing or malformed credentials safely disable each
 * provider (no-op) so local development, CI and tests never emit external network traffic.
 */
export function readObservabilityConfig(
  env: Record<string, string | undefined>,
): ObservabilityServerConfig {
  const posthogHost = parsePostHogHost(env.SLIPER_POSTHOG_HOST ?? env.NEXT_PUBLIC_POSTHOG_HOST);
  const posthogUiHost = POSTHOG_CLOUD_HOSTS[posthogHost].ui;
  const sentryEnvironment = parseEnvironment(env);
  const sentryRelease = parseRelease(env.SENTRY_RELEASE ?? env.SLIPER_RELEASE);
  const allowed = telemetryAllowedInRuntime(env);

  if (!allowed) {
    return {
      sentryDsn: null,
      sentryServerDsn: null,
      sentryEnvironment,
      sentryRelease,
      sentryTracesSampleRate: 0,
      posthogKey: null,
      posthogHost,
      posthogUiHost,
      sessionReplayEnabled: false,
    };
  }

  const publicSentryDsn = parseSentryDsn(
    env.NEXT_PUBLIC_SENTRY_DSN ?? env.SLIPER_SENTRY_CLIENT_DSN ?? env.SENTRY_DSN,
  );
  const serverSentryDsn = parseSentryDsn(env.SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN);
  const posthogKey = parsePostHogKey(env.SLIPER_POSTHOG_KEY ?? env.NEXT_PUBLIC_POSTHOG_KEY);
  const sentryTracesSampleRate = parseSampleRate(
    env.SENTRY_TRACES_SAMPLE_RATE ?? env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    0.1,
  );

  return {
    sentryDsn: publicSentryDsn,
    sentryServerDsn: serverSentryDsn,
    sentryEnvironment,
    sentryRelease,
    sentryTracesSampleRate: publicSentryDsn || serverSentryDsn ? sentryTracesSampleRate : 0,
    posthogKey,
    posthogHost,
    posthogUiHost,
    sessionReplayEnabled: false,
  };
}

export function toClientObservabilityConfig(
  config: ObservabilityServerConfig,
): ObservabilityClientConfig {
  return {
    sentryDsn: config.sentryDsn,
    sentryEnvironment: config.sentryEnvironment,
    sentryRelease: config.sentryRelease,
    sentryTracesSampleRate: config.sentryDsn ? config.sentryTracesSampleRate : 0,
    posthogKey: config.posthogKey,
    posthogHost: config.posthogHost,
    posthogUiHost: config.posthogUiHost,
    sessionReplayEnabled: false,
  };
}

const UUID_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT_RE = /^[0-9]{1,20}$/;
const OPAQUE_TOKEN_RE = /^[A-Za-z0-9_-]{24,}$/;

/**
 * Strips query parameters/hashes (which may hold OAuth codes, search queries, or return URLs)
 * and replaces resource IDs/UUIDs/tokens with stable route placeholders.
 */
export function sanitizeRoutePath(input: string): string {
  const withoutHash = input.split("#")[0] ?? "";
  const withoutQuery = withoutHash.split("?")[0] ?? "";
  if (!withoutQuery || withoutQuery === "/") return "/";
  const normalized = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const segments = normalized.split("/").map((segment, index) => {
    if (index === 0 || !segment) return segment;
    if (UUID_SEGMENT_RE.test(segment)) return ":id";
    if (NUMERIC_SEGMENT_RE.test(segment)) return ":id";
    if (OPAQUE_TOKEN_RE.test(segment)) return ":token";
    return segment;
  });
  return segments.join("/") || "/";
}

/** Removes credentials, query strings, hashes, and resource IDs from full URLs before telemetry export. */
export function sanitizeTelemetryUrl(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    const parsed = new URL(input);
    const cleanPath = sanitizeRoutePath(parsed.pathname);
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return sanitizeRoutePath(input);
  }
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const KR_PHONE_RE = /\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const POSTGRES_URL_RE = /postgres(?:ql)?:\/\/[^\s'"]+/gi;

/** Redacts common PII and credential shapes from arbitrary strings before logging or error reporting. */
export function scrubSensitiveStrings(value: string): string {
  return value
    .replace(POSTGRES_URL_RE, "[database-url]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(JWT_RE, "[jwt]")
    .replace(EMAIL_RE, "[email]")
    .replace(KR_PHONE_RE, "[phone]");
}

export function queryLengthBucket(query: string): "0" | "1-3" | "4-10" | "11+" {
  const length = query.trim().length;
  if (length === 0) return "0";
  if (length <= 3) return "1-3";
  if (length <= 10) return "4-10";
  return "11+";
}
