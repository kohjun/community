import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://sliper.example";
const POST = "a8b5a8f3-7f78-4ff3-8121-ebedac4cc056";

function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const displayed: {
    title: string;
    options: { body: string; data: { url: string }; tag?: string };
  }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  let focused = 0;
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      listeners.set(name, callback),
    skipWaiting: async () => undefined,
    registration: {
      showNotification: async (title: string, options: (typeof displayed)[number]["options"]) => {
        displayed.push({ title, options });
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => [] as unknown[],
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  runInNewContext(source, { self, URL });
  async function emit(name: string, value: object) {
    const pending: Promise<unknown>[] = [];
    const callback = listeners.get(name);
    assert.ok(callback, `missing ${name} handler`);
    callback({ ...value, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  }
  return {
    listeners,
    displayed,
    opened,
    navigated,
    emit,
    focused: () => focused,
    existingWindow: (url = `${ORIGIN}/stories`) => {
      self.clients.matchAll = async () => [
        {
          url,
          focus: async () => {
            focused += 1;
          },
          navigate: async (url: string) => {
            navigated.push(url);
            return {
              focus: async () => {
                focused += 1;
              },
            };
          },
        },
      ];
    },
  };
}

test("push worker displays safe local targets and does not cache authenticated requests", async () => {
  const runtime = worker();
  assert.equal(runtime.listeners.has("fetch"), false);
  await runtime.emit("push", {
    data: {
      json: () => ({
        title: "새 공지",
        body: "새 공지가 등록됐어요.",
        url: `/events/${POST}?secret=ignored#fragment`,
      }),
    },
  });
  assert.equal(runtime.displayed[0]?.title, "새 공지");
  assert.equal(runtime.displayed[0]?.options.data.url, `/events/${POST}`);
  await runtime.emit("push", {
    data: { json: () => ({ url: `/?post=${POST}&tracking=ignored` }) },
  });
  assert.equal(runtime.displayed[1]?.options.data.url, `/?post=${POST}`);
  await runtime.emit("push", { data: { json: () => ({ url: `/rooms/${POST}` }) } });
  assert.equal(runtime.displayed[2]?.options.data.url, `/rooms/${POST}`);
});

test("malformed push payloads show a generic notification and reject remote or API links", async () => {
  const runtime = worker();
  await runtime.emit("push", {
    data: {
      json: () => {
        throw new Error("invalid JSON");
      },
    },
  });
  assert.equal(runtime.displayed[0]?.title, "Sliper");
  assert.equal(runtime.displayed[0]?.options.data.url, "/");
  for (const url of [
    "https://attacker.example/",
    "//attacker.example/",
    "javascript:alert(1)",
    "/api/community/me",
    "/?post=invalid",
  ]) {
    await runtime.emit("push", { data: { json: () => ({ url }) } });
    assert.equal(runtime.displayed.at(-1)?.options.data.url, "/");
  }
});

test("notification content is bounded and clicking cannot navigate outside Sliper", async () => {
  const runtime = worker();
  await runtime.emit("push", {
    data: {
      json: () => ({
        title: "x".repeat(500),
        body: "y".repeat(1000),
        tag: "z".repeat(500),
        url: "/mypage",
      }),
    },
  });
  assert.equal(runtime.displayed[0]?.title.length, 120);
  assert.equal(runtime.displayed[0]?.options.body.length, 240);
  assert.equal(runtime.displayed[0]?.options.tag?.length, 120);
  let closed = false;
  await runtime.emit("notificationclick", {
    notification: {
      close: () => {
        closed = true;
      },
      data: { url: "https://attacker.example/" },
    },
  });
  assert.equal(closed, true);
  assert.deepEqual(runtime.opened, [`${ORIGIN}/`]);
});

test("notification click focuses an existing target window without navigating other tabs", async () => {
  const runtime = worker();
  runtime.existingWindow(`${ORIGIN}/events/${POST}`);
  await runtime.emit("notificationclick", {
    notification: {
      close: () => undefined,
      data: { url: `/events/${POST}` },
    },
  });
  assert.equal(runtime.navigated.length, 0);
  assert.equal(runtime.focused(), 1);
  assert.equal(runtime.opened.length, 0);
});

test("notification click preserves another page and opens the event separately", async () => {
  const runtime = worker();
  runtime.existingWindow();
  await runtime.emit("notificationclick", {
    notification: {
      close: () => undefined,
      data: { url: `/events/${POST}` },
    },
  });
  assert.equal(runtime.navigated.length, 0);
  assert.equal(runtime.focused(), 0);
  assert.deepEqual(runtime.opened, [`${ORIGIN}/events/${POST}`]);
});
