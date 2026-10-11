import "dotenv/config";
import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import test from "node:test";
import type { ActionResult } from "../src/domain/contracts";
import { DEFAULT_PUSH_PREFERENCES, type PushSettingsView } from "../src/domain/push";

const origin = "http://127.0.0.1:3000";
const database = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.APP_ORIGIN !== origin ||
  database.hostname !== "127.0.0.1" ||
  database.port !== "55432" ||
  database.pathname !== "/sliper_dev"
)
  throw new Error("Push HTTP tests require the isolated local development environment.");

async function api<T>(path: string, method = "GET", body?: unknown, from = origin) {
  const response = await fetch(origin + path, {
    method,
    headers: { Origin: from, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  return {
    status: response.status,
    headers: response.headers,
    result: (await response.json()) as ActionResult<T>,
  };
}
function data<T>(value: { status: number; result: ActionResult<T> }): T {
  assert.equal(value.status, 200, "unexpected push API status");
  if (!value.result.ok) throw new Error(value.result.error.message);
  return value.result.data;
}
function fixture() {
  const key = createECDH("prime256v1");
  key.generateKeys();
  return {
    endpoint: `https://untrusted.example.invalid/push/${randomUUID()}`,
    expirationTime: null,
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

test("push settings expose only public configuration and private account preferences", async () => {
  const response = await api<PushSettingsView>("/api/push/settings");
  const settings = data(response);
  assert.equal(settings.enabled, true);
  assert.equal(
    /^[A-Za-z0-9_-]{87}$/.test(settings.publicKey ?? ""),
    true,
    "public VAPID key shape",
  );
  assert.deepEqual(settings.preferences, DEFAULT_PUSH_PREFERENCES);
  assert.equal(typeof settings.subscriptions, "number");
  assert.equal(settings.currentDevice, false);
  assert.deepEqual(Object.keys(settings).sort(), [
    "currentDevice",
    "enabled",
    "preferences",
    "publicKey",
    "subscriptions",
  ]);
  assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  assert.equal(
    data(await api<PushSettingsView>(`/api/push/settings?device=${"0".repeat(64)}`)).currentDevice,
    false,
  );
  assert.equal((await api("/api/push/settings?device=invalid")).status, 400);
});

test("push mutations reject foreign origins, unknown endpoints, and forged ownership", async () => {
  for (const [path, method, body] of [
    ["/api/push/settings", "PATCH", DEFAULT_PUSH_PREFERENCES],
    ["/api/push/subscriptions", "POST", fixture()],
    ["/api/push/subscriptions", "DELETE", { endpoint: fixture().endpoint }],
    ["/api/push/test", "POST", { endpoint: fixture().endpoint }],
  ] as const) {
    const response = await api(path, method, body, "https://untrusted.example.invalid");
    assert.equal(response.status, 403);
    assert.equal(response.result.ok, false);
  }
  assert.equal((await api("/api/push/subscriptions", "POST", fixture())).status, 400);
  assert.equal(
    (await api("/api/push/subscriptions", "POST", { ...fixture(), userId: randomUUID() })).status,
    400,
  );
  assert.equal(
    (
      await api("/api/push/settings", "PATCH", {
        ...DEFAULT_PUSH_PREFERENCES,
        userId: randomUUID(),
      })
    ).status,
    400,
  );
});

test("LAN Host never receives the localhost development identity", async () => {
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(
      new URL("/api/push/settings", origin),
      {
        method: "GET",
        headers: { Host: "192.168.123.102:3000" },
        timeout: 60_000,
      },
      (incoming) => {
        const parts: Buffer[] = [];
        incoming.on("data", (part: Buffer) => parts.push(part));
        incoming.on("error", reject);
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            body: Buffer.concat(parts).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("anonymous push API request timed out")));
    request.end();
  });
  assert.equal(response.status, 401);
  const result = JSON.parse(response.body) as ActionResult<PushSettingsView>;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "UNAUTHENTICATED");
});

test("push worker is served uncached with a local script policy and JavaScript MIME", async () => {
  const response = await fetch(`${origin}/sw.js`, { signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/javascript/);
  assert.match(response.headers.get("cache-control") ?? "", /no-cache/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /default-src 'self'; script-src 'self'/,
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const source = await response.text();
  assert.match(source, /showNotification/);
  assert.doesNotMatch(source, /addEventListener\(["']fetch["']/);
});

test("home screen manifest and official logo icons are available without authentication", async () => {
  const response = await fetch(`${origin}/manifest.webmanifest`, {
    signal: AbortSignal.timeout(60_000),
  });
  assert.equal(response.status, 200);
  const manifest = (await response.json()) as {
    name: string;
    display: string;
    start_url: string;
    scope: string;
    theme_color: string;
    icons: { src: string; sizes: string; type: string }[];
  };
  assert.match(manifest.name, /Sliper/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.theme_color, "#0A84FE");
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}`);
    assert.ok(icon);
    assert.equal(icon.type, "image/png");
    assert.match(icon.src, /^\/images\/sliper-icon-/);
    const image = await fetch(origin + icon.src, { signal: AbortSignal.timeout(60_000) });
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type") ?? "", /image\/png/);
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});

test("mypage renders the push controls without prompting for permission during SSR", async () => {
  const response = await fetch(`${origin}/mypage`, { signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("내 알림 설정"), "Notification settings must remain visible in the page");
  const disclosure = html.match(/<details\b[^>]*class="push-settings-compact"[^>]*>/)?.[0];
  assert.ok(disclosure, "Notification settings must use a disclosure instead of an expanded panel");
  assert.equal(/\bopen(?:=|\s|>)/.test(disclosure), false, "Settings should start collapsed");
  assert.ok(
    html.includes('aria-label="내 알림 설정 펼치기"'),
    "The disclosure needs an accessible label",
  );
  assert.ok(
    html.includes("알림 설정을 불러오고 있어요"),
    "Permission must not be requested during SSR",
  );
});
