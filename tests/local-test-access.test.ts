import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  allowedLocalTestHost,
  configuredLocalTestLanHost,
  localTestAuthAvailable,
  TestLoginThrottle,
} from "../src/server/local-test-access";
import type { LocalTestAccount } from "../src/server/local-test-auth";
import { AppError } from "../src/server/errors";
import { isAllowedRequestOrigin } from "../src/server/request-origin";

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  LOCAL_DATABASE: "1",
  SLIPER_AUTH_MODE: "development",
  DATABASE_URL: "postgres://fixture@127.0.0.1:55432/sliper_dev",
  SLIPER_LAN_HOST: "192.168.123.102",
};
const canonical = "http://127.0.0.1:3000";
const lanHost = "192.168.123.102:3000";
function request(origin: string | undefined, host: string, site = "same-origin") {
  return new Request(`${canonical}/api/auth/test/login`, {
    method: "POST",
    headers: { Host: host, "Sec-Fetch-Site": site, ...(origin ? { Origin: origin } : {}) },
  });
}
const rateLimited = (error: unknown) => error instanceof AppError && error.code === "RATE_LIMITED";

test("local test access allows loopback and only the exact configured private LAN host", () => {
  for (const host of ["127.0.0.1:3000", "localhost:3000", lanHost])
    assert.equal(allowedLocalTestHost(host, env), true);
  for (const host of [
    null,
    "",
    "192.168.123.103:3000",
    "10.0.0.5:3000",
    "172.16.0.1:3000",
    "localhost:3001",
    "127.0.0.1",
    "localhost",
    "127.0.0.2:3000",
    "[::1]:3000",
    "LOCALHOST:3000",
    "localhost.attacker.example:3000",
    "8.8.8.8:3000",
    "http://localhost:3000",
    `${lanHost}/path`,
    `user@${lanHost}`,
    `${lanHost} `,
  ])
    assert.equal(allowedLocalTestHost(host, env), false);
  assert.equal(allowedLocalTestHost(lanHost, { ...env, SLIPER_LAN_HOST: undefined }), false);
});

test("production builds, other databases and disabled development flags cannot enable test access", () => {
  const alteredEnvironments: Array<Partial<NodeJS.ProcessEnv>> = [
    { NODE_ENV: "production" },
    { NODE_ENV: "test" },
    { LOCAL_DATABASE: "0" },
    { LOCAL_DATABASE: undefined },
    { SLIPER_AUTH_MODE: "supabase" },
    { SLIPER_AUTH_MODE: undefined },
    { DATABASE_URL: "postgres://fixture@cloud.example:55432/sliper_dev" },
    { DATABASE_URL: "postgres://fixture@localhost:55432/sliper_dev" },
    { DATABASE_URL: "postgres://fixture@127.0.0.1:5432/sliper_dev" },
    { DATABASE_URL: "postgres://fixture@127.0.0.1:55432/another" },
    { DATABASE_URL: "http://127.0.0.1:55432/sliper_dev" },
    { DATABASE_URL: "not a URL" },
  ];
  // Next.js types require NODE_ENV even though a runtime environment can omit it.
  const missingNodeEnvironment = Object.fromEntries(
    Object.entries(env).filter(([name]) => name !== "NODE_ENV"),
  ) as NodeJS.ProcessEnv;
  for (const host of ["127.0.0.1:3000", "localhost:3000", lanHost])
    assert.equal(allowedLocalTestHost(host, missingNodeEnvironment), false);
  for (const altered of alteredEnvironments)
    for (const host of ["127.0.0.1:3000", "localhost:3000", lanHost])
      assert.equal(allowedLocalTestHost(host, { ...env, ...altered }), false);
});

test("LAN configuration accepts canonical RFC1918 IPv4 addresses and rejects ambiguous or public input", () => {
  for (const address of [
    "10.0.0.1",
    "10.255.255.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.1",
    "192.168.255.254",
  ])
    assert.equal(configuredLocalTestLanHost(address), `${address}:3000`);
  for (const address of [
    undefined,
    null,
    "",
    "127.0.0.1",
    "172.15.255.254",
    "172.32.0.1",
    "192.167.1.1",
    "192.169.1.1",
    "169.254.1.1",
    "100.64.1.1",
    "8.8.8.8",
    "256.168.1.1",
    "192.168.1.999",
    "192.168.01.1",
    "010.0.0.1",
    "192.168.1",
    "3232235777",
    "::1",
    "localhost",
    "host.local",
    "192.168.1.1:3000",
    "http://192.168.1.1",
    "user@192.168.1.1",
    "192.168.1.1/path",
    "192.168.1.1?port=3000",
    " 192.168.1.1",
  ])
    assert.equal(configuredLocalTestLanHost(address), null);
  assert.equal(allowedLocalTestHost(lanHost, { ...env, SLIPER_LAN_HOST: "8.8.8.8" }), false);
});

test("test authentication requires a complete ignored account file in addition to the environment and Host gate", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "sliper-local-test-access-"));
  const filename = path.join(cwd, ".local", "test-account.json");
  const account: LocalTestAccount = {
    version: 1,
    username: "test@sliper.local",
    userId: "96d2e4ee-8180-4373-a674-cb8c5454d71d",
    passwordSalt: randomBytes(32).toString("base64url"),
    passwordHash: randomBytes(64).toString("base64url"),
    sessionSecret: randomBytes(32).toString("base64url"),
    accountNonce: randomBytes(16).toString("base64url"),
  };
  try {
    assert.equal(localTestAuthAvailable(lanHost, env, cwd), false);
    await mkdir(path.dirname(filename));
    await writeFile(filename, JSON.stringify(account));
    assert.equal(localTestAuthAvailable(lanHost, env, cwd), true);
    assert.equal(localTestAuthAvailable("localhost:3000", env, cwd), true);
    assert.equal(localTestAuthAvailable("192.168.123.103:3000", env, cwd), false);
    assert.equal(localTestAuthAvailable(lanHost, { ...env, NODE_ENV: "production" }, cwd), false);
    assert.equal(localTestAuthAvailable(lanHost, { ...env, LOCAL_DATABASE: "0" }, cwd), false);
    await writeFile(filename, "invalid JSON");
    assert.equal(localTestAuthAvailable(lanHost, env, cwd), false);
    await writeFile(filename, JSON.stringify({ ...account, sessionSecret: "invalid" }));
    assert.equal(localTestAuthAvailable(lanHost, env, cwd), false);
  } finally {
    assert.ok(path.resolve(cwd).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(cwd).startsWith("sliper-local-test-access-"));
    await rm(cwd, { recursive: true, force: true });
  }
});

test("LAN browser mutations require a configured private host and exactly matching HTTP Origin", () => {
  const origin = `http://${lanHost}`;
  assert.equal(
    isAllowedRequestOrigin(request(origin, lanHost), canonical, true, env.SLIPER_LAN_HOST),
    true,
  );
  assert.equal(isAllowedRequestOrigin(request(origin, lanHost), canonical, true), false);
  assert.equal(
    isAllowedRequestOrigin(request(origin, lanHost), canonical, false, env.SLIPER_LAN_HOST),
    false,
  );
  assert.equal(
    isAllowedRequestOrigin(
      request(origin, lanHost),
      "https://sliper.example",
      true,
      env.SLIPER_LAN_HOST,
    ),
    false,
  );
  assert.equal(
    isAllowedRequestOrigin(
      request(origin, "192.168.123.103:3000"),
      canonical,
      true,
      env.SLIPER_LAN_HOST,
    ),
    false,
  );
  assert.equal(
    isAllowedRequestOrigin(request(canonical, lanHost), canonical, true, env.SLIPER_LAN_HOST),
    false,
  );
  assert.equal(
    isAllowedRequestOrigin(
      request(origin, lanHost, "cross-site"),
      canonical,
      true,
      env.SLIPER_LAN_HOST,
    ),
    false,
  );
  for (const supplied of [
    undefined,
    "null",
    "https://untrusted.example",
    "http://192.168.123.102:3001",
    "https://192.168.123.102:3000",
    "http://user@192.168.123.102:3000",
    "http://192.168.123.102.attacker.example:3000",
  ])
    assert.equal(
      isAllowedRequestOrigin(request(supplied, lanHost), canonical, true, env.SLIPER_LAN_HOST),
      false,
    );
  assert.equal(
    isAllowedRequestOrigin(
      request("http://8.8.8.8:3000", "8.8.8.8:3000"),
      canonical,
      true,
      "8.8.8.8",
    ),
    false,
  );
});

test("test login permits five failures per minute and reopens exactly after the cooldown", () => {
  const throttle = new TestLoginThrottle();
  const start = 1000;
  for (let attempt = 0; attempt < 5; attempt++) {
    throttle.begin(start + attempt);
    throttle.finish(false, start + attempt);
  }
  assert.throws(() => throttle.begin(start + 5), rateLimited);
  assert.throws(() => throttle.begin(start + 59_999), rateLimited);
  assert.doesNotThrow(() => throttle.begin(start + 60_000));
  throttle.finish(false, start + 60_000);
});

test("concurrent password verification remains blocked until the first request finishes", () => {
  const throttle = new TestLoginThrottle();
  throttle.begin(1000);
  assert.throws(() => throttle.begin(1001), rateLimited);
  assert.throws(() => throttle.begin(70_000), rateLimited);
  throttle.finish(false, 70_000);
  assert.doesNotThrow(() => throttle.begin(70_001));
  throttle.finish(true, 70_001);
});

test("successful login clears failures without disabling later throttling", () => {
  const throttle = new TestLoginThrottle();
  for (let attempt = 0; attempt < 4; attempt++) {
    throttle.begin(1000 + attempt);
    throttle.finish(false, 1000 + attempt);
  }
  throttle.begin(1010);
  throttle.finish(true, 1010);
  for (let attempt = 0; attempt < 5; attempt++) {
    throttle.begin(1020 + attempt);
    throttle.finish(false, 1020 + attempt);
  }
  assert.throws(() => throttle.begin(1030), rateLimited);
});
