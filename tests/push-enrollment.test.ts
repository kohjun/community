import assert from "node:assert/strict";
import { createECDH, webcrypto } from "node:crypto";
import { test } from "node:test";
import {
  applicationServerKey,
  getPushSettings,
  pushPermissionRecoveryMessage,
  startPushEnrollment,
} from "../src/lib/push-client";
import type { PushSettingsView } from "../src/domain/push";
import { RequestError } from "../src/lib/api-client";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const PUBLIC_KEY = ecdh.getPublicKey().toString("base64url");
const settings: PushSettingsView = {
  enabled: true,
  publicKey: PUBLIC_KEY,
  preferences: {
    announcements: true,
    comments: true,
    participation: true,
    subscriptions: true,
    reminders: true,
  },
  subscriptions: 0,
  currentDevice: false,
};

function subscription(endpoint: string, events: string[], label: string): PushSubscription {
  return {
    endpoint,
    expirationTime: null,
    unsubscribe: async () => {
      events.push(`unsubscribe:${label}`);
      return true;
    },
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: PUBLIC_KEY, auth: "a".repeat(22) },
    }),
  } as unknown as PushSubscription;
}

function browser() {
  const events: string[] = [];
  const existing = subscription("https://fcm.googleapis.com/existing", events, "existing");
  const fresh = subscription("https://fcm.googleapis.com/fresh", events, "fresh");
  let current: PushSubscription | null = null;
  let permission: NotificationPermission = "default";
  let ask = () => Promise.resolve<NotificationPermission>("granted");
  let fetchResponse = (url: string, init?: RequestInit) => {
    events.push(`fetch:${init?.method ?? "GET"}:${url}`);
    return Response.json({
      ok: true,
      data: { ...settings, subscriptions: 1, currentDevice: true },
    });
  };
  const registration = {
    active: {},
    pushManager: {
      getSubscription: async () => {
        events.push("get-subscription");
        return current;
      },
      subscribe: async (options: PushSubscriptionOptionsInit) => {
        events.push("subscribe");
        assert.equal(options.userVisibleOnly, true);
        assert.deepEqual(options.applicationServerKey, applicationServerKey(PUBLIC_KEY));
        return fresh;
      },
    },
  };
  const navigatorMock = {
    userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/140.0.0.0",
    platform: "Linux arm64",
    maxTouchPoints: 5,
    serviceWorker: {
      register: async (url: string, options: RegistrationOptions) => {
        events.push("register");
        assert.equal(url, "/sw.js");
        assert.equal(options.scope, "/");
        assert.equal(options.updateViaCache, "none");
        return registration;
      },
    },
  };
  const notificationMock = {
    get permission() {
      return permission;
    },
    requestPermission: () => {
      events.push("permission");
      return ask();
    },
  };
  const windowMock = {
    isSecureContext: true,
    matchMedia: () => ({ matches: false }),
    atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
    crypto: webcrypto,
    PushManager: {},
    Notification: notificationMock,
  };
  const values = {
    window: windowMock,
    navigator: navigatorMock,
    Notification: notificationMock,
    fetch: (url: string, init?: RequestInit) => Promise.resolve(fetchResponse(url, init)),
  };
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(values)) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return {
    events,
    existing,
    fresh,
    navigator: navigatorMock,
    window: windowMock,
    setExisting: () => {
      current = existing;
    },
    setPermission: (value: NotificationPermission) => {
      permission = value;
    },
    setAsk: (value: typeof ask) => {
      ask = value;
    },
    setFetch: (value: typeof fetchResponse) => {
      fetchResponse = value;
    },
    restore: () => {
      for (const [name, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test("enrollment requests permission in the synchronous click stack before worker or network", async () => {
  const env = browser();
  try {
    let resolve!: (value: NotificationPermission) => void;
    env.setAsk(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = startPushEnrollment(settings);
    assert.deepEqual(env.events, ["permission"]);
    resolve("granted");
    const result = await pending;
    assert.equal(result.subscription, env.fresh);
    assert.equal(result.settings.currentDevice, true);
    assert.deepEqual(env.events, [
      "permission",
      "register",
      "get-subscription",
      "subscribe",
      "fetch:POST:/api/push/subscriptions",
    ]);
  } finally {
    env.restore();
  }
});

test("an already allowed and owned device is bound idempotently without a second prompt", async () => {
  const env = browser();
  try {
    env.setPermission("granted");
    env.setExisting();
    const result = await startPushEnrollment({
      ...settings,
      currentDevice: true,
      subscriptions: 1,
    });
    assert.equal(result.subscription, env.existing);
    assert.deepEqual(env.events, [
      "register",
      "get-subscription",
      "fetch:POST:/api/push/subscriptions",
    ]);
  } finally {
    env.restore();
  }
});

test("shared-device enrollment explicitly removes the old subscription before creating a fresh one", async () => {
  const env = browser();
  try {
    env.setPermission("granted");
    env.setExisting();
    const result = await startPushEnrollment(settings);
    assert.equal(result.subscription, env.fresh);
    assert.deepEqual(env.events, [
      "register",
      "get-subscription",
      "unsubscribe:existing",
      "subscribe",
      "fetch:POST:/api/push/subscriptions",
    ]);
  } finally {
    env.restore();
  }
});

test("failure to detach a shared device stops enrollment without transferring its endpoint", async () => {
  const env = browser();
  try {
    env.setPermission("granted");
    env.setExisting();
    env.existing.unsubscribe = async () => false;
    await assert.rejects(startPushEnrollment(settings), /기존 알림 연결/);
    assert.deepEqual(env.events, ["register", "get-subscription"]);
  } finally {
    env.restore();
  }
});

test("a failed authenticated registration unsubscribes only newly created subscriptions", async () => {
  const env = browser();
  try {
    env.setPermission("granted");
    env.setFetch(() =>
      Response.json(
        {
          ok: false,
          error: { code: "UNAUTHENTICATED", message: "로그인이 필요해요." },
        },
        { status: 401 },
      ),
    );
    await assert.rejects(
      startPushEnrollment(settings),
      (cause: unknown) => cause instanceof RequestError && cause.code === "UNAUTHENTICATED",
    );
    assert.equal(env.events.at(-1), "unsubscribe:fresh");
    env.events.length = 0;
    env.setExisting();
    await assert.rejects(startPushEnrollment({ ...settings, currentDevice: true }));
    assert.equal(
      env.events.some((event) => event.startsWith("unsubscribe:")),
      false,
    );
  } finally {
    env.restore();
  }
});

test("denial and dismissed permission do not register a worker or repeatedly request permission", async () => {
  const env = browser();
  try {
    env.setPermission("denied");
    await assert.rejects(startPushEnrollment(settings), /사이트 설정/);
    assert.deepEqual(env.events, []);
    env.setPermission("default");
    env.setAsk(() => Promise.resolve("default"));
    await assert.rejects(startPushEnrollment(settings), /알림을 허용하면/);
    assert.deepEqual(env.events, ["permission"]);
  } finally {
    env.restore();
  }
});

test("disabled, malformed-key, insecure, and iOS browser states never request system permission", async () => {
  const env = browser();
  try {
    await assert.rejects(startPushEnrollment({ ...settings, enabled: false }));
    await assert.rejects(startPushEnrollment({ ...settings, publicKey: "invalid" }));
    env.window.isSecureContext = false;
    await assert.rejects(startPushEnrollment(settings));
    env.window.isSecureContext = true;
    env.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
    await assert.rejects(startPushEnrollment(settings));
    assert.deepEqual(env.events, []);
    assert.match(pushPermissionRecoveryMessage(), /설정 → 알림 → Sliper/);
  } finally {
    env.restore();
  }
});

test("device settings requests include a digest rather than a push endpoint in the URL", async () => {
  const env = browser();
  try {
    let requested = "";
    env.setFetch((url) => {
      requested = url;
      return Response.json({ ok: true, data: settings });
    });
    await getPushSettings(env.existing);
    assert.match(requested, /^\/api\/push\/settings\?device=[a-f0-9]{64}$/);
    assert.equal(requested.includes(env.existing.endpoint), false);
    await getPushSettings(null);
    assert.equal(requested, "/api/push/settings");
  } finally {
    env.restore();
  }
});

test("a synchronous browser permission error is exposed as a rejected enrollment promise", async () => {
  const env = browser();
  try {
    env.setAsk(() => {
      throw new Error("permission failed");
    });
    let pending!: ReturnType<typeof startPushEnrollment>;
    assert.doesNotThrow(() => {
      pending = startPushEnrollment(settings);
    });
    await assert.rejects(pending, /permission failed/);
    assert.deepEqual(env.events, ["permission"]);
  } finally {
    env.restore();
  }
});
