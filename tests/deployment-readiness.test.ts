import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import test from "node:test";
import { deploymentReadiness } from "../src/server/deployment-readiness";
const ec = createECDH("prime256v1");
ec.generateKeys();
const ready = () => ({
  LOCAL_DATABASE: "0",
  SLIPER_AUTH_MODE: "supabase",
  APP_ORIGIN: "https://sliper.example",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  DATABASE_URL:
    "postgresql://sliper_server:runtime-password@db.project.supabase.co/postgres?sslmode=require",
  MIGRATION_DATABASE_URL:
    "postgresql://postgres:migration-password@db.project.supabase.co/postgres?sslmode=require",
  VISITOR_HASH_SECRET: "v".repeat(32),
  PUSH_WORKER_MODE: "external",
  MEDIA_STORAGE_BACKEND: "supabase",
  SUPABASE_STORAGE_URL: "https://project.supabase.co",
  SUPABASE_STORAGE_SECRET_KEY: `sb_secret_${randomBytes(32).toString("hex")}`,
  SUPABASE_STORAGE_BUCKET: "sliper-private",
  VAPID_SUBJECT: "mailto:ops@sliper.example",
  VAPID_PUBLIC_KEY: ec.getPublicKey().toString("base64url"),
  VAPID_PRIVATE_KEY: ec.getPrivateKey().toString("base64url"),
});
const row = (env: Record<string, string | undefined>, id: string) =>
  deploymentReadiness(env).find((check) => check.id === id)!;
test("valid core settings pass while missing bridges remain explicitly disconnected", () => {
  const report = deploymentReadiness(ready());
  assert.equal(
    report.some((check) => check.status === "fail"),
    false,
  );
  assert.equal(report.find((check) => check.id === "payment-bridge")?.status, "warn");
  assert.equal(report.find((check) => check.id === "external-approval")?.status, "warn");
  assert.equal(report.find((check) => check.id === "operational-verification")?.status, "warn");
});
test("local database and fixed development access cannot pass production preflight", () => {
  const env = {
    ...ready(),
    LOCAL_DATABASE: "1",
    SLIPER_AUTH_MODE: "development",
    DATABASE_URL: "postgresql://user:password@127.0.0.1:55432/sliper_dev",
  };
  assert.equal(row(env, "development-access").status, "fail");
  assert.equal(row(env, "database").status, "fail");
});
test("untrusted origins, public secret keys and disabled TLS fail without echoing values", () => {
  const invalidPublicSecret = `sb_secret_${randomBytes(32).toString("hex")}`;
  const env = {
    ...ready(),
    APP_ORIGIN: "https://user:secret@sliper.example/path",
    DATABASE_URL: "postgresql://user:private-password@db.example/postgres?sslmode=disable",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: invalidPublicSecret,
  };
  for (const id of ["site-origin", "database", "authentication", "public-secrets"])
    assert.equal(row(env, id).status, "fail");
  const output = JSON.stringify(deploymentReadiness(env));
  for (const secret of ["secret@sliper", "private-password", invalidPublicSecret])
    assert.equal(output.includes(secret), false);
});
test("runtime migration-owner credentials fail even on different endpoints", () => {
  const env = {
    ...ready(),
    DATABASE_URL: "postgresql://postgres.project:p@pooler.example:6543/postgres?sslmode=require",
  };
  assert.equal(row(env, "database-role").status, "fail");
  assert.equal(
    row({ ...ready(), MIGRATION_DATABASE_URL: ready().DATABASE_URL }, "database-role").status,
    "fail",
  );
});
test("partial optional integrations fail instead of advertising availability", () => {
  const env = { ...ready(), PAYMENT_PROVIDER: "bridge", EXTERNAL_APPROVAL_PROVIDER: "platform" };
  assert.equal(row(env, "payment-bridge").status, "fail");
  assert.equal(row(env, "external-approval").status, "fail");
  assert.equal(row({ ...ready(), VAPID_PRIVATE_KEY: "a".repeat(43) }, "web-push").status, "fail");
});

test("library payment needs a dedicated complete signing configuration and redacts secrets", () => {
  assert.equal(row(ready(), "library-payment").status, "warn");
  const env = { ...ready(), LIBRARY_PAYMENT_PROVIDER: "library-bridge" };
  assert.equal(row(env, "library-payment").status, "fail");
  const configured = { ...env, LIBRARY_PAYMENT_WEBHOOK_SECRET: "library-private-secret".repeat(3) };
  assert.equal(row(configured, "library-payment").status, "pass");
  assert.equal(
    JSON.stringify(deploymentReadiness(configured)).includes(
      configured.LIBRARY_PAYMENT_WEBHOOK_SECRET,
    ),
    false,
  );
  assert.equal(
    row({ ...configured, LIBRARY_PAYMENT_PROVIDER: "manual" }, "library-payment").status,
    "fail",
  );
});
test("full bridges only confirm static format, never real money or webhook connectivity", () => {
  const env = {
    ...ready(),
    PAYMENT_PROVIDER: "bridge",
    PAYMENT_CHECKOUT_API_URL: "https://bridge.example/checkout",
    PAYMENT_API_KEY: "private-api-key",
    PAYMENT_WEBHOOK_SECRET: "k".repeat(32),
    PAYMENT_CHECKOUT_ORIGINS: "https://pay.example, https://checkout.example",
    EXTERNAL_APPROVAL_PROVIDER: "platform",
    EXTERNAL_APPROVAL_WEBHOOK_SECRET: "w".repeat(32),
  };
  assert.equal(row(env, "payment-bridge").status, "pass");
  assert.equal(row(env, "external-approval").status, "pass");
  assert.match(row(env, "payment-bridge").message, /검증/);
});
test("browser credential variables and LAN hosts are detected, valid public map ID is allowed", () => {
  assert.equal(
    row({ ...ready(), NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "private" }, "public-secrets").status,
    "fail",
  );
  assert.equal(
    row({ ...ready(), NEXT_PUBLIC_NAVER_MAP_KEY_ID: "public-map" }, "public-secrets").status,
    "pass",
  );
  assert.equal(
    row({ ...ready(), SLIPER_LAN_HOST: "192.168.0.2:3000" }, "development-access").status,
    "fail",
  );
});
test("storage never silently falls back on malformed backend; local storage requires deployment planning", () => {
  assert.equal(
    row({ ...ready(), MEDIA_STORAGE_BACKEND: "broken" }, "image-storage").status,
    "fail",
  );
  assert.equal(
    row({ ...ready(), SUPABASE_STORAGE_BUCKET: "bad/../../name" }, "image-storage").status,
    "fail",
  );
  assert.equal(row({ ...ready(), MEDIA_STORAGE_BACKEND: "local" }, "image-storage").status, "warn");
  assert.equal(
    row({ ...ready(), SUPABASE_STORAGE_URL: "https://localhost" }, "image-storage").status,
    "fail",
  );
});
test("malformed encoded credentials return a redacted configuration failure", () => {
  const env = {
    ...ready(),
    DATABASE_URL: "postgresql://%ZZ:p@db.example/postgres?sslmode=require",
  };
  assert.doesNotThrow(() => deploymentReadiness(env));
  assert.equal(row(env, "database").status, "fail");
});

test("room Redis is optional and explicitly reports DB polling when absent", () => {
  for (const value of [undefined, "", "   "]) {
    const check = row({ ...ready(), REDIS_URL: value }, "room-realtime");
    assert.equal(check.status, "warn");
    assert.match(check.message, /DB/);
    assert.match(check.message, /5초/);
  }
});

test("room Redis accepts TLS URL formats without exposing connection credentials", () => {
  const env = {
    ...ready(),
    REDIS_URL: "rediss://redis-user:unique-redis-password@cache.example:6380/0",
  };
  assert.equal(row(env, "room-realtime").status, "pass");
  assert.match(row(env, "room-realtime").message, /실제 연결/);
  const output = JSON.stringify(deploymentReadiness(env));
  for (const value of ["redis-user", "unique-redis-password", "cache.example"])
    assert.equal(output.includes(value), false);
});

test("room Redis rejects malformed protocols, hosts, ports, database indices, and credential encodings", () => {
  for (const value of [
    "https://cache.example",
    "redis:/",
    "redis://:6379",
    "redis://-bad.example",
    "redis://bad..example",
    "redis://bad_host.example",
    "redis://999.999.999.999",
    "redis://cache.example:0",
    "redis://cache.example:65536",
    "redis://cache.example/not-a-db",
    "redis://%ZZ:private@cache.example",
    "redis://default:%ZZ@cache.example",
  ]) {
    assert.doesNotThrow(() => deploymentReadiness({ ...ready(), REDIS_URL: value }));
    assert.equal(row({ ...ready(), REDIS_URL: value }, "room-realtime").status, "fail");
  }
});

test("room Redis allows local and private plaintext addresses with an operations warning", () => {
  for (const host of [
    "localhost",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.10.20",
    "192.168.1.10",
    "[::1]",
    "[::ffff:127.0.0.1]",
    "[fd00::1]",
    "redis",
    "redis.internal",
    "redis.default.svc.cluster.local",
  ]) {
    const check = row({ ...ready(), REDIS_URL: `redis://${host}:6379` }, "room-realtime");
    assert.equal(check.status, "warn");
    assert.match(check.message, /사설망/);
    assert.match(check.message, /TLS/);
  }
});

test("public plaintext room Redis fails production preflight and remains usable in development", () => {
  const env = { ...ready(), REDIS_URL: "redis://cache.example:6379", NODE_ENV: "production" };
  const production = row(env, "room-realtime");
  assert.equal(production.status, "fail");
  assert.match(production.message, /사설망/);
  assert.match(production.message, /TLS/);
  assert.equal(row({ ...env, NODE_ENV: "development" }, "room-realtime").status, "warn");
  assert.equal(row({ ...ready(), REDIS_URL: env.REDIS_URL }, "room-realtime").status, "fail");
});

test("Redis URLs and secrets in browser environment variables fail without echoing their values", () => {
  for (const variable of [
    "NEXT_PUBLIC_REDIS_URL",
    "NEXT_PUBLIC_REDIS_PASSWORD",
    "NEXT_PUBLIC_CACHE_URL",
  ]) {
    const fixturePassword = randomBytes(24).toString("hex");
    const secret = `redis://exposed-user:${fixturePassword}@redis.internal:6379`;
    const env = { ...ready(), [variable]: secret };
    assert.equal(row(env, "public-secrets").status, "fail");
    const output = JSON.stringify(deploymentReadiness(env));
    for (const value of ["exposed-user", fixturePassword, "redis.internal"])
      assert.equal(output.includes(value), false);
  }
});
