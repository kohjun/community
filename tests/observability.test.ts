import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";
import { sanitizeRoutePath, scrubSensitiveStrings } from "../src/domain/observability";
import { buildLogger, logSafeError } from "../src/server/logger";

test("sanitizeRoutePath strip query strings, hashes, UUIDs, IDs and tokens", () => {
  assert.equal(
    sanitizeRoutePath("/games/550e8400-e29b-41d4-a716-446655440000?host=1#top"),
    "/games/:id",
  );
  assert.equal(
    sanitizeRoutePath("/auth/callback?code=secret-oauth-code&returnTo=%2F"),
    "/auth/callback",
  );
  assert.equal(sanitizeRoutePath("/posts/98765"), "/posts/:id");
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
  assert.equal(second.errName, "Error");
  assert.equal(second.errMessage, undefined);
  assert.equal(chunks[1]!.includes("member@example.com"), false);
  assert.equal(chunks[1]!.includes("010-1111-2222"), false);
});
