import assert from "node:assert/strict";
import test from "node:test";
import { RequestSequence } from "../src/lib/request-sequence";
import { carouselPosition, nextCarouselPosition, shouldAdvanceCarousel } from "../src/lib/carousel";
import { readPostContent, recordPostVisit } from "../src/lib/post-navigation";
import { actionData, communityRequest } from "../src/lib/api-client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("a late daily-visit response cannot overwrite a newly saved profile", async () => {
  const requests = new RequestSequence(),
    visit = deferred<string>(),
    save = deferred<string>();
  let profile = "original";
  const pendingVisit = requests.run(
    () => visit.promise,
    (value) => {
      profile = value;
    },
  );
  const pendingSave = requests.run(
    () => save.promise,
    (value) => {
      profile = value;
    },
  );
  save.resolve("saved");
  await pendingSave;
  visit.resolve("old visit");
  await pendingVisit;
  assert.equal(profile, "saved");
});
test("unmounted profile requests are ignored", async () => {
  const requests = new RequestSequence(),
    pending = deferred<string>();
  let applied = false;
  const work = requests.run(
    () => pending.promise,
    () => {
      applied = true;
    },
  );
  requests.invalidate();
  pending.resolve("late");
  await work;
  assert.equal(applied, false);
});
test("carousel autoplay stays paused when the pointer leaves but keyboard focus remains", () => {
  const ready = {
    paused: false,
    hovered: false,
    focused: false,
    hidden: false,
    reducedMotion: false,
  };
  assert.equal(shouldAdvanceCarousel(ready), true);
  for (const flag of Object.keys(ready))
    assert.equal(shouldAdvanceCarousel({ ...ready, [flag]: true }), false);
  assert.equal(shouldAdvanceCarousel({ ...ready, hovered: false, focused: true }), false);
});
test("carousel wraps after a fractional final position and handles a rail that fits", () => {
  assert.deepEqual(carouselPosition(530, 1000, 470, 220), { max: 530, pages: 4, index: 3 });
  assert.deepEqual(nextCarouselPosition(440, 1000, 470, 220, 1), { index: 3, offset: 530 });
  assert.deepEqual(nextCarouselPosition(530, 1000, 470, 220, 1), { index: 0, offset: 0 });
  assert.deepEqual(nextCarouselPosition(0, 1000, 470, 220, -1), { index: 3, offset: 530 });
  assert.deepEqual(nextCarouselPosition(0, 470, 470, 220, 1), { index: 0, offset: 0 });
});
test("request client rejects HTML, malformed envelopes and failed success responses with a readable message", async (t) => {
  const responses = [
    new Response("<html>error</html>", { status: 500 }),
    Response.json({ unexpected: true }),
    Response.json({ ok: true, data: 3 }, { status: 500 }),
    Response.json({ ok: "true", data: 3 }),
    Response.json({ ok: true }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  for (let index = 0; index < 5; index++)
    await assert.rejects(communityRequest("/me"), /서버 응답/);
});
test("request client preserves server validation, JSON payloads and cancellation", async (t) => {
  let captured: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    captured = options;
    return Response.json(
      { ok: false, error: { message: "제목을 입력해주세요." } },
      { status: 400 },
    );
  });
  await assert.rejects(communityRequest("/posts", "POST", { title: "" }), /제목을 입력/);
  assert.equal(captured?.credentials, "same-origin");
  assert.equal(captured?.body, JSON.stringify({ title: "" }));
  const controller = new AbortController();
  controller.abort();
  t.mock.method(globalThis, "fetch", async () => {
    throw new DOMException("Aborted", "AbortError");
  });
  await assert.rejects(communityRequest("/me", "GET", undefined, controller.signal), {
    name: "AbortError",
  });
  await assert.rejects(communityRequest("/me"), /서버에 연결/);
});
test("request client returns valid data and keeps upload bodies as FormData", async (t) => {
  const form = new FormData();
  form.append("file", new Blob(["image"]), "image.png");
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    assert.equal(options.body, form);
    assert.equal(options.headers, undefined);
    return Response.json({ ok: true, data: { id: "image" } });
  });
  assert.deepEqual(await communityRequest("/uploads", "POST", form), { id: "image" });
});
test("Server Action bridge starts work once and returns data or the action failure", async () => {
  let calls = 0;
  assert.equal(
    await actionData(async () => {
      calls++;
      return { ok: true, data: 42 };
    }),
    42,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    actionData(async () => ({ ok: false, error: { code: "VALIDATION", message: "입력 확인" } })),
    /입력 확인/,
  );
  await assert.rejects(
    actionData(async () => {
      throw new Error("transport failed");
    }),
    /transport failed/,
  );
});

test("opening a post reads content without waiting for or requiring a view POST", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    calls.push(options.method!);
    assert.equal(options.method, "GET");
    return Response.json({
      ok: true,
      data: { post: { id: "post" }, comments: [], nextCommentCursor: null },
    });
  });
  assert.equal((await readPostContent("post")).post.id, "post");
  assert.deepEqual(calls, ["GET"]);
});
test("failed or cancelled view counting remains nonfatal after a post opens", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Origin mismatch" } },
      { status: 403 },
    ),
  );
  assert.equal(await recordPostVisit("post"), null);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network unavailable");
  });
  assert.equal(await recordPostVisit("post"), null);
});
