import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createReadPostsStore,
  MAX_READ_POSTS,
  READ_POSTS_STORAGE_KEY,
  readPostsStore,
} from "../src/lib/read-posts";
import { openPostContent } from "../src/lib/post-navigation";
import type { CommunityDetail } from "../src/domain/community";
const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
function browserStore(initial: string | null = null) {
  let raw = initial;
  let receive: ((value: string | null) => void) | undefined;
  let detached = 0;
  const store = createReadPostsStore({
    getStorage: () => ({
      getItem: (key) => {
        assert.equal(key, READ_POSTS_STORAGE_KEY);
        return raw;
      },
      setItem: (key, value) => {
        assert.equal(key, READ_POSTS_STORAGE_KEY);
        raw = value;
      },
    }),
    onStorage: (listener) => {
      receive = listener;
      return () => {
        receive = undefined;
        detached++;
      };
    },
  });
  return {
    store,
    raw: () => raw,
    otherTab: (value: string | null) => {
      raw = value;
      receive?.(value);
    },
    detached: () => detached,
  };
}
test("read history survives a new page session and contains only normalized post IDs", () => {
  const browser = browserStore();
  assert.deepEqual(browser.store.getSnapshot(), []);
  assert.equal(browser.store.mark(id(1).toUpperCase()), true);
  assert.equal(browser.store.mark("javascript:alert(1)"), false);
  assert.equal(browser.store.mark("private contact or title"), false);
  const nextPage = browserStore(browser.raw());
  assert.deepEqual(nextPage.store.getSnapshot(), [id(1)]);
  assert.deepEqual(nextPage.store.getServerSnapshot(), []);
  assert.equal(nextPage.store.getServerSnapshot(), nextPage.store.getServerSnapshot());
  assert.equal(nextPage.store.getSnapshot(), nextPage.store.getSnapshot());
});
test("corrupted, incompatible and oversized storage does not break reading", () => {
  for (const raw of [
    "{broken",
    JSON.stringify({ version: 2, ids: [id(1)] }),
    JSON.stringify({ version: 1, ids: null }),
    "x".repeat(MAX_READ_POSTS * 80 + 1),
  ]) {
    const { store } = browserStore(raw);
    assert.deepEqual(store.getSnapshot(), []);
    store.mark(id(2));
    assert.deepEqual(store.getSnapshot(), [id(2)]);
  }
  const { store } = browserStore(
    JSON.stringify({ version: 1, ids: [id(1), id(1).toUpperCase(), null, "bad", id(2)] }),
  );
  assert.deepEqual(store.getSnapshot(), [id(1), id(2)]);
});
test("unavailable browser storage keeps read marks alive while navigating", () => {
  for (const getStorage of [
    () => {
      throw new Error("SecurityError");
    },
    () => ({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    }),
  ]) {
    const store = createReadPostsStore({ getStorage });
    let notices = 0;
    const stop = store.subscribe(() => notices++);
    store.mark(id(3));
    assert.deepEqual(store.getSnapshot(), [id(3)]);
    assert.equal(notices, 1);
    stop();
  }
});
test("history stays bounded and revisiting a post retains it ahead of older entries", () => {
  const records = Array.from({ length: MAX_READ_POSTS }, (_, index) => id(index + 1));
  const { store, raw } = browserStore(JSON.stringify({ version: 1, ids: records }));
  store.mark(id(MAX_READ_POSTS));
  store.mark(id(MAX_READ_POSTS + 1));
  assert.equal(store.getSnapshot().length, MAX_READ_POSTS);
  assert.equal(store.getSnapshot()[0], id(MAX_READ_POSTS + 1));
  assert.equal(store.getSnapshot()[1], id(MAX_READ_POSTS));
  assert.equal(store.getSnapshot().includes(id(MAX_READ_POSTS - 1)), false);
  assert.equal(JSON.parse(raw()!).ids.length, MAX_READ_POSTS);
});
test("all mounted lists receive same-tab and other-tab read changes, then detach cleanly", () => {
  const { store, otherTab, detached } = browserStore();
  let first = 0,
    second = 0;
  const stopA = store.subscribe(() => first++),
    stopB = store.subscribe(() => second++);
  store.mark(id(1));
  assert.equal(first, 1);
  assert.equal(second, 1);
  otherTab(JSON.stringify({ version: 1, ids: [id(2)] }));
  assert.deepEqual(store.getSnapshot(), [id(2), id(1)]);
  assert.equal(first, 2);
  assert.equal(second, 2);
  stopA();
  otherTab(JSON.stringify({ version: 1, ids: [id(3), id(2)] }));
  assert.equal(first, 2);
  assert.equal(second, 3);
  otherTab(null);
  assert.deepEqual(store.getSnapshot(), []);
  stopB();
  assert.equal(detached(), 1);
});
function details(postId: string): CommunityDetail {
  return { post: { id: postId, title: "읽은 글" } } as CommunityDetail;
}
function success(detail: CommunityDetail) {
  return Response.json({ ok: true, data: detail });
}
test("only successfully displayed content becomes read; failed, superseded, closed and deleted posts stay unread", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const controller = new AbortController();
    let current = true,
      displayed = 0;
    const options = {
      isCurrent: () => current,
      reconcile: (value: CommunityDetail) => value,
      display: () => displayed++,
    };
    globalThis.fetch = async () => success(details(id(101)));
    assert.ok(await openPostContent(id(101), controller.signal, options));
    assert.equal(displayed, 1);
    assert.ok(readPostsStore.getSnapshot().includes(id(101)));
    globalThis.fetch = async () =>
      Response.json(
        { ok: false, error: { code: "NOT_FOUND", message: "없어요" } },
        { status: 404 },
      );
    await assert.rejects(openPostContent(id(102), controller.signal, options));
    assert.ok(!readPostsStore.getSnapshot().includes(id(102)));
    let resolve!: (response: Response) => void;
    globalThis.fetch = () =>
      new Promise<Response>((done) => {
        resolve = done;
      });
    const pending = openPostContent(id(103), controller.signal, options);
    current = false;
    resolve(success(details(id(103))));
    assert.equal(await pending, null);
    assert.ok(!readPostsStore.getSnapshot().includes(id(103)));
    current = true;
    const closed = new AbortController();
    const closedRequest = openPostContent(id(104), closed.signal, options);
    closed.abort();
    resolve(success(details(id(104))));
    assert.equal(await closedRequest, null);
    assert.ok(!readPostsStore.getSnapshot().includes(id(104)));
    globalThis.fetch = async () => success(details(id(105)));
    assert.equal(
      await openPostContent(id(105), controller.signal, { ...options, reconcile: () => null }),
      null,
    );
    assert.ok(!readPostsStore.getSnapshot().includes(id(105)));
    assert.equal(displayed, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returning to lists includes another tab's reads made while every list was unmounted", () => {
  const { store, otherTab } = browserStore();
  const stop = store.subscribe(() => {});
  store.mark(id(1));
  stop();
  otherTab(JSON.stringify({ version: 1, ids: [id(2), id(1)] }));
  assert.deepEqual(store.getSnapshot(), [id(1)]);
  const stopAgain = store.subscribe(() => {});
  assert.deepEqual(store.getSnapshot(), [id(2), id(1)]);
  stopAgain();
});

test("deleting saved history while lists are unmounted does not resurrect old read marks", () => {
  for (const cleared of [null, JSON.stringify({ version: 1, ids: [] })]) {
    const { store, otherTab, raw } = browserStore();
    const stop = store.subscribe(() => {});
    store.mark(id(11));
    stop();
    otherTab(cleared);
    const resumed = store.subscribe(() => {});
    assert.deepEqual(store.getSnapshot(), []);
    store.mark(id(12));
    assert.deepEqual(store.getSnapshot(), [id(12)]);
    assert.deepEqual(JSON.parse(raw()!).ids, [id(12)]);
    resumed();
  }
});

test("deleting saved history is respected before recording the next post without mounted lists", () => {
  const { store, otherTab, raw } = browserStore();
  store.mark(id(13));
  otherTab(null);
  store.mark(id(14));
  assert.deepEqual(store.getSnapshot(), [id(14)]);
  assert.deepEqual(JSON.parse(raw()!).ids, [id(14)]);
});

test("failed writes to an empty storage area retain unsaved read marks when lists remount", () => {
  const store = createReadPostsStore({
    getStorage: () => ({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    }),
  });
  const stop = store.subscribe(() => {});
  store.mark(id(15));
  stop();
  const resumed = store.subscribe(() => {});
  assert.deepEqual(store.getSnapshot(), [id(15)]);
  store.mark(id(16));
  assert.deepEqual(store.getSnapshot(), [id(16), id(15)]);
  resumed();
});

test("temporary storage blocking preserves in-memory marks, then observes a real removal once access returns", () => {
  let raw: string | null = null;
  let blocked = false;
  const store = createReadPostsStore({
    getStorage: () => {
      if (blocked) throw new Error("SecurityError");
      return {
        getItem: () => raw,
        setItem: (_key, value) => {
          raw = value;
        },
      };
    },
  });
  store.mark(id(17));
  blocked = true;
  store.mark(id(18));
  const stop = store.subscribe(() => {});
  assert.deepEqual(store.getSnapshot(), [id(18), id(17)]);
  stop();
  raw = null;
  blocked = false;
  const resumed = store.subscribe(() => {});
  assert.deepEqual(store.getSnapshot(), []);
  resumed();
});

test("post detail requests and responses compare UUIDs canonically without mismatched read marks", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const uppercase = "ABCDEF12-3456-4789-ABCD-EF0123456789";
    const canonical = uppercase.toLowerCase();
    let displayed: CommunityDetail | null = null;
    let requests = 0;
    globalThis.fetch = async (url) => {
      requests++;
      assert.equal(String(url), `/api/community/posts/${canonical}`);
      return success(details(uppercase));
    };
    const options = {
      isCurrent: () => true,
      reconcile: (value: CommunityDetail) => value,
      display: (value: CommunityDetail) => {
        displayed = value;
      },
    };
    const result = await openPostContent(uppercase, new AbortController().signal, options);
    assert.equal(result?.post.id, canonical);
    assert.equal((displayed as CommunityDetail | null)?.post.id, canonical);
    assert.ok(readPostsStore.getSnapshot().includes(canonical));
    assert.ok(!readPostsStore.getSnapshot().includes(uppercase));
    assert.equal(await openPostContent("invalid-id", new AbortController().signal, options), null);
    assert.equal(requests, 1);
    globalThis.fetch = async () => success(details(id(120)));
    displayed = null;
    assert.equal(await openPostContent(id(119), new AbortController().signal, options), null);
    assert.equal(displayed, null);
    assert.ok(!readPostsStore.getSnapshot().includes(id(119)));
    assert.ok(!readPostsStore.getSnapshot().includes(id(120)));
    globalThis.fetch = async () => success(details(id(121)));
    assert.equal(
      await openPostContent(id(121), new AbortController().signal, {
        ...options,
        reconcile: () => details(id(122)),
      }),
      null,
    );
    assert.ok(!readPostsStore.getSnapshot().includes(id(121)));
    assert.ok(!readPostsStore.getSnapshot().includes(id(122)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("read marks are not recorded if displaying a loaded post fails", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => success(details(id(125)));
    await assert.rejects(
      openPostContent(id(125), new AbortController().signal, {
        isCurrent: () => true,
        reconcile: (value) => value,
        display: () => {
          throw new Error("could not display");
        },
      }),
      /could not display/,
    );
    assert.ok(!readPostsStore.getSnapshot().includes(id(125)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("queued storage changes use the latest value rather than reviving an already deleted record", () => {
  let raw: string | null = null;
  let receive!: (value: string | null) => void;
  const store = createReadPostsStore({
    getStorage: () => ({
      getItem: () => raw,
      setItem: (_key, value) => {
        raw = value;
      },
    }),
    onStorage: (listener) => {
      receive = listener;
      return () => {};
    },
  });
  const stop = store.subscribe(() => {});
  store.mark(id(30));
  const obsolete = raw;
  raw = null;
  receive(null);
  receive(obsolete);
  assert.deepEqual(store.getSnapshot(), []);
  store.mark(id(31));
  receive(null);
  assert.deepEqual(store.getSnapshot(), [id(31)]);
  stop();
});
