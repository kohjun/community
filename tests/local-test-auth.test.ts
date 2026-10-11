import assert from "node:assert/strict";
import { createHmac, randomBytes, scrypt } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createLocalTestGuestSession,
  createLocalTestSession,
  isLocalTestEnvironment,
  loadLocalTestAccount,
  localTestAccountEnabled,
  LOCAL_TEST_SESSION_COOKIE,
  LOCAL_TEST_SESSION_MAX_AGE,
  readLocalTestSession,
  verifyTestAccountLogin,
  type LocalTestAccount,
} from "../src/server/local-test-auth";

const password = "Fixture-only!correct-password";
const salt = randomBytes(32);
const hash = (await promisify(scrypt)(password, salt, 64)) as Buffer;
const account: LocalTestAccount = {
  version: 1,
  username: "test@sliper.local",
  userId: "bff60962-d4d6-4a0a-8517-0e08ca41230a",
  passwordSalt: salt.toString("base64url"),
  passwordHash: hash.toString("base64url"),
  sessionSecret: randomBytes(32).toString("base64url"),
  accountNonce: randomBytes(16).toString("base64url"),
};
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  LOCAL_DATABASE: "1",
  SLIPER_AUTH_MODE: "development",
  DATABASE_URL: "postgres://fixture@127.0.0.1:55432/sliper_dev",
};
const host = "localhost:3000";
const now = Date.UTC(2026, 9, 1, 12);
function signed(payload: Record<string, unknown>, secret = account.sessionSecret): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", Buffer.from(secret, "base64url"))
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}
function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
}

async function withAccountFile(run: (cwd: string, filename: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "sliper-local-test-auth-"));
  const directory = path.join(cwd, ".local");
  const filename = path.join(directory, "test-account.json");
  try {
    await mkdir(directory);
    await writeFile(filename, JSON.stringify(account));
    await run(cwd, filename);
  } finally {
    assert.ok(path.resolve(cwd).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(cwd).startsWith("sliper-local-test-auth-"));
    await rm(cwd, { recursive: true, force: true });
  }
}

test("test authentication is restricted to exact local development database flags", () => {
  assert.equal(isLocalTestEnvironment(env), true);
  const alteredEnvironments: Array<Partial<NodeJS.ProcessEnv>> = [
    { NODE_ENV: "production" },
    { NODE_ENV: "test" },
    { LOCAL_DATABASE: "0" },
    { SLIPER_AUTH_MODE: "supabase" },
    { DATABASE_URL: "postgres://fixture@localhost:55432/sliper_dev" },
    { DATABASE_URL: "postgres://fixture@127.0.0.1:5432/sliper_dev" },
    { DATABASE_URL: "postgres://fixture@127.0.0.1:55432/other" },
    { DATABASE_URL: "https://127.0.0.1:55432/sliper_dev" },
    { DATABASE_URL: "not a URL" },
  ];
  const missingEnvironment = { ...env };
  Reflect.deleteProperty(missingEnvironment, "NODE_ENV");
  assert.equal(isLocalTestEnvironment(missingEnvironment), false);
  for (const altered of alteredEnvironments)
    assert.equal(isLocalTestEnvironment({ ...env, ...altered }), false);
});

test("only a complete validated ignored account file enables login", async () => {
  await withAccountFile(async (cwd, filename) => {
    assert.deepEqual(loadLocalTestAccount(env, cwd), account);
    assert.equal(localTestAccountEnabled(env, cwd), true);
    assert.equal(loadLocalTestAccount({ ...env, NODE_ENV: "production" }, cwd), null);
    for (const invalid of [
      "invalid JSON",
      JSON.stringify({ ...account, password: password }),
      JSON.stringify({ ...account, passwordSalt: account.passwordSalt + "=" }),
      JSON.stringify({ ...account, passwordHash: "short" }),
      JSON.stringify({ ...account, username: "other@sliper.local" }),
      JSON.stringify({ ...account, userId: "invalid" }),
      " ".repeat(4097),
    ]) {
      await writeFile(filename, invalid);
      assert.equal(loadLocalTestAccount(env, cwd), null);
      assert.equal(localTestAccountEnabled(env, cwd), false);
    }
  });
});

test("password login verifies scrypt hash and rejects arbitrary identity input", async () => {
  assert.equal(
    await verifyTestAccountLogin({ username: account.username, password }, account),
    true,
  );
  assert.equal(
    await verifyTestAccountLogin({ username: " TEST@SLIPER.LOCAL ", password }, account),
    true,
  );
  for (const invalid of [
    { username: account.username, password: "incorrect" },
    { username: "unknown@sliper.local", password },
    { username: account.username, password, userId: account.userId },
    { username: account.username, password: "" },
    { username: account.username, password: "x".repeat(257) },
    null,
  ])
    assert.equal(await verifyTestAccountLogin(invalid, account), false);
});

test("signed seven-day sessions expose only the authenticated test user", () => {
  assert.equal(LOCAL_TEST_SESSION_COOKIE, "sliper_test_session");
  const token = createLocalTestSession(account, host, now);
  assert.deepEqual(readLocalTestSession(token, account, host, now), { userId: account.userId });
  assert.deepEqual(readLocalTestSession(token, account, host, now + 1000), {
    userId: account.userId,
  });
  assert.equal(
    readLocalTestSession(token, account, host, now + LOCAL_TEST_SESSION_MAX_AGE * 1000),
    null,
  );
  assert.equal(readLocalTestSession(token, account, host, now - 1000), null);
});

test("session verification rejects altered signatures, subjects and malformed encoding", () => {
  const token = createLocalTestSession(account, host, now);
  const payload = payloadOf(token);
  const unknownSubject = "08a13bb8-a643-4bfd-b3b7-89532b1db128";
  for (const invalid of [
    "",
    "x".repeat(2049),
    `${token}=`,
    `${token}.extra`,
    token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"),
    `${Buffer.from(JSON.stringify({ ...payload, sub: unknownSubject })).toString("base64url")}.${token.split(".")[1]}`,
    signed({ ...payload, sub: unknownSubject }),
    signed({ ...payload, exp: Number(payload.exp) + 1 }),
    signed({ ...payload, extra: "field" }),
    signed({ ...payload, iat: Number(payload.iat) + 60, exp: Number(payload.exp) + 60 }),
    signed({ ...payload, sub: "malformed" }),
  ])
    assert.equal(readLocalTestSession(invalid, account, host, now), null);
});

test("sessions are bound to the exact browser host including LAN addresses", () => {
  const token = createLocalTestSession(account, host, now);
  assert.equal(readLocalTestSession(token, account, "127.0.0.1:3000", now), null);
  assert.equal(readLocalTestSession(token, account, "192.168.123.102:3000", now), null);
  for (const lanHost of ["192.168.123.102:3000", "10.0.0.5:3000", "172.16.0.1:3000"]) {
    const lanToken = createLocalTestSession(account, lanHost, now);
    assert.deepEqual(readLocalTestSession(lanToken, account, lanHost, now), {
      userId: account.userId,
    });
  }
  for (const invalidHost of [
    "evil.example:3000",
    "127.0.0.1:3001",
    "localhost",
    "8.8.8.8:3000",
    "192.168.999.1:3000",
    "192.168.1.1:3000/path",
    "http://localhost:3000",
    "LOCALHOST:3000",
  ]) {
    assert.equal(readLocalTestSession(token, account, invalidHost, now), null);
    assert.throws(() => createLocalTestSession(account, invalidHost, now));
  }
});

test("account nonce and secret rotation invalidate previously signed sessions", () => {
  const token = createLocalTestSession(account, host, now);
  assert.equal(
    readLocalTestSession(
      token,
      { ...account, accountNonce: randomBytes(16).toString("base64url") },
      host,
      now,
    ),
    null,
  );
  assert.equal(
    readLocalTestSession(
      token,
      { ...account, sessionSecret: randomBytes(32).toString("base64url") },
      host,
      now,
    ),
    null,
  );
});

test("signed guest sessions distinguish explicit logout from invalid sessions", () => {
  const guest = createLocalTestGuestSession(account, host, now);
  assert.deepEqual(readLocalTestSession(guest, account, host, now), { userId: null });
  assert.equal(readLocalTestSession(undefined, account, host, now), null);
  assert.equal(readLocalTestSession("forged-cookie", account, host, now), null);
  assert.equal(
    readLocalTestSession(guest, account, host, now + LOCAL_TEST_SESSION_MAX_AGE * 1000),
    null,
  );
});
