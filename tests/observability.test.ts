import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import {
  parsePostHogHost,
  parsePostHogKey,
  parseSentryDsn,
  queryLengthBucket,
  readObservabilityConfig,
  sanitizeRoutePath,
  sanitizeTelemetryUrl,
  scrubSensitiveStrings,
  toClientObservabilityConfig,
} from "../src/domain/observability";
import { buildLogger, logSafeError } from "../src/server/logger";

const SAMPLE_DSN = "https://0123456789abcdef0123456789abcdef@o123456.ingest.us.sentry.io/4500001";
const SAMPLE_PH_KEY = "phc_AbCdEfGhIjKlMnOpQrStUvWxYz123456";

test("readObservabilityConfig stays disabled in dev, test and local database modes", () => {
  const dev = readObservabilityConfig({
    NODE_ENV: "development",
    SENTRY_DSN: SAMPLE_DSN,
    SLIPER_POSTHOG_KEY: SAMPLE_PH_KEY,
  });
  assert.equal(dev.sentryDsn, null);
  assert.equal(dev.sentryServerDsn, null);
  assert.equal(dev.posthogKey, null);
  assert.equal(dev.sessionReplayEnabled, false);

  const localDb = readObservabilityConfig({
    NODE_ENV: "production",
    LOCAL_DATABASE: "1",
    SENTRY_DSN: SAMPLE_DSN,
    SLIPER_POSTHOG_KEY: SAMPLE_PH_KEY,
  });
  assert.equal(localDb.sentryDsn, null);
  assert.equal(localDb.posthogKey, null);

  const testEnv = readObservabilityConfig({
    NODE_ENV: "test",
    SLIPER_OBSERVABILITY_ENABLE_DEV: "true",
    SENTRY_DSN: SAMPLE_DSN,
    SLIPER_POSTHOG_KEY: SAMPLE_PH_KEY,
  });
  assert.equal(testEnv.sentryDsn, null);
  assert.equal(testEnv.posthogKey, null);
});

test("readObservabilityConfig enables valid credentials in cloud production and rejects malformed ones", () => {
  const prod = readObservabilityConfig({
    NODE_ENV: "production",
    LOCAL_DATABASE: "0",
    SENTRY_DSN: SAMPLE_DSN,
    SLIPER_POSTHOG_KEY: SAMPLE_PH_KEY,
    SLIPER_POSTHOG_HOST: "https://eu.i.posthog.com",
    SLIPER_RELEASE: "20261121-01",
    SENTRY_TRACES_SAMPLE_RATE: "0.2",
  });
  assert.equal(prod.sentryDsn, SAMPLE_DSN);
  assert.equal(prod.sentryServerDsn, SAMPLE_DSN);
  assert.equal(prod.posthogKey, SAMPLE_PH_KEY);
  assert.equal(prod.posthogHost, "https://eu.i.posthog.com");
  assert.equal(prod.posthogUiHost, "https://eu.posthog.com");
  assert.equal(prod.sentryRelease, "20261121-01");
  assert.equal(prod.sentryTracesSampleRate, 0.2);
  assert.equal(prod.sessionReplayEnabled, false);

  const client = toClientObservabilityConfig(prod);
  assert.equal("sentryServerDsn" in client, false);
  assert.equal(client.posthogHost, "https://eu.i.posthog.com");

  assert.equal(parseSentryDsn("http://insecure@sentry.io/123"), null);
  assert.equal(parseSentryDsn("https://user:pass@sentry.io/123"), null);
  assert.equal(parseSentryDsn("https://nothex@sentry.io/abc"), null);
  assert.equal(parsePostHogKey("invalid-key"), null);
  assert.equal(parsePostHogKey("phc_short"), null);
});

test("PostHog host parsing accepts only supported cloud hosts", () => {
  assert.equal(parsePostHogHost("https://evil.example.com"), "https://us.i.posthog.com");
  assert.equal(parsePostHogHost("http://169.254.169.254"), "https://us.i.posthog.com");
  assert.equal(parsePostHogHost("https://eu.i.posthog.com/"), "https://eu.i.posthog.com");
});

test("sanitizeRoutePath and sanitizeTelemetryUrl strip query strings, hashes, UUIDs, IDs and tokens", () => {
  assert.equal(
    sanitizeRoutePath("/games/550e8400-e29b-41d4-a716-446655440000?host=1#top"),
    "/games/:id",
  );
  assert.equal(
    sanitizeRoutePath("/auth/callback?code=secret-oauth-code&returnTo=%2F"),
    "/auth/callback",
  );
  assert.equal(sanitizeRoutePath("/posts/98765"), "/posts/:id");
  assert.equal(
    sanitizeTelemetryUrl("https://sliper.kr/search?q=%EA%B0%9C%EC%9D%B8%EC%A0%95%EB%B3%B4&page=2"),
    "https://sliper.kr/search",
  );
  assert.equal(
    sanitizeTelemetryUrl("https://sliper.kr/join/abcdefghijklmnopqrstuvwxyz123456"),
    "https://sliper.kr/join/:token",
  );
});

test("scrubSensitiveStrings masks emails, Korean phone numbers, bearer tokens, JWTs and DB URLs", () => {
  const database = new URL("postgres://db.internal:5432/sliper");
  database.username = "test";
  database.password = crypto.randomUUID();
  const raw = `Failed for user@example.com phone 010-1234-5678 Bearer superSecretToken12345 ${database}`;
  const cleaned = scrubSensitiveStrings(raw);
  assert.equal(cleaned.includes("user@example.com"), false);
  assert.equal(cleaned.includes("010-1234-5678"), false);
  assert.equal(cleaned.includes("superSecretToken12345"), false);
  assert.equal(cleaned.includes("db.internal"), false);
  assert.equal(cleaned.includes("[email]"), true);
  assert.equal(cleaned.includes("[phone]"), true);
  assert.equal(cleaned.includes("[database-url]"), true);
  assert.equal(queryLengthBucket(""), "0");
  assert.equal(queryLengthBucket("추리"), "1-3");
  assert.equal(queryLengthBucket("예능 파티"), "4-10");
  assert.equal(queryLengthBucket("서울 주말 보드게임 모임"), "11+");
});

test("Pino structured logger redacts credentials, headers and PII in JSON output", () => {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const logger = buildLogger({ service: "sliper-test", level: "info", destination: sink });
  logger.info(
    {
      email: "member@example.com",
      phone: "010-9999-8888",
      cookie: "sb-auth-token=secret",
      authorization: "Bearer topsecret1234567890",
      safeField: "ok",
    },
    "structured log check",
  );
  logSafeError(
    logger,
    "safe error check",
    new Error("Crash for member@example.com with 010-1111-2222"),
    { path: "/games/550e8400-e29b-41d4-a716-446655440000?secret=1" },
  );

  assert.equal(chunks.length, 2);
  const first = JSON.parse(chunks[0]!) as Record<string, unknown>;
  assert.equal(first.service, "sliper-test");
  assert.equal(first.safeField, "ok");
  assert.equal(first.email, "[Redacted]");
  assert.equal(first.phone, "[Redacted]");
  assert.equal(first.cookie, "[Redacted]");
  assert.equal(first.authorization, "[Redacted]");

  const second = JSON.parse(chunks[1]!) as Record<string, unknown>;
  assert.equal(second.path, "/games/:id");
  assert.equal(typeof second.errMessage, "string");
  assert.equal((second.errMessage as string).includes("member@example.com"), false);
  assert.equal((second.errMessage as string).includes("010-1111-2222"), false);
});
