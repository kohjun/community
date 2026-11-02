import { test } from "node:test";
import assert from "node:assert/strict";
import { BoundedCache } from "../src/server/bounded-cache";
function cache(clock = () => 0) {
  return new BoundedCache<string>({ maxEntries: 2, maxBytes: 6, size: (v) => v.length, clock });
}
test("cache coalesces concurrent fills, expires, and does not retain failures", async () => {
  let now = 0,
    loads = 0;
  const c = cache(() => now);
  const load = async () => {
    loads++;
    return "abc";
  };
  assert.deepEqual(await Promise.all([c.read("one", 10, load), c.read("one", 10, load)]), [
    "abc",
    "abc",
  ]);
  assert.equal(loads, 1);
  await c.read("one", 10, load);
  assert.equal(loads, 1);
  now = 10;
  await c.read("one", 10, load);
  assert.equal(loads, 2);
  await assert.rejects(
    c.read("bad", 10, async () => {
      throw Error("offline");
    }),
  );
  assert.equal(await c.read("bad", 10, async () => "ok"), "ok");
  assert.equal(c.stats().pending, 0);
});
test("cache evicts by LRU and byte budget and skips oversized values", async () => {
  const c = cache();
  await c.read("one", 100, async () => "abc");
  await c.read("two", 100, async () => "def");
  await c.read("one", 100, async () => "bad");
  await c.read("three", 100, async () => "ghi");
  assert.equal(c.stats().bytes, 6);
  let loads = 0;
  await c.read("two", 100, async () => {
    loads++;
    return "de";
  });
  assert.equal(loads, 1);
  await c.read("big", 100, async () => "oversized");
  assert.ok(c.stats().bytes <= 6);
  assert.ok(c.stats().entries <= 2);
});
test("invalidation detaches in-flight work and cannot be undone by its late completion", async () => {
  for (const all of [false, true]) {
    const c = cache();
    let finish!: (v: string) => void;
    const old = c.read(
      "one",
      100,
      () =>
        new Promise<string>((r) => {
          finish = r;
        }),
    );
    await Promise.resolve();
    if (all) c.clear();
    else c.delete("one");
    assert.equal(await c.read("one", 100, async () => "new"), "new");
    finish("old");
    assert.equal(await old, "old");
    assert.equal(await c.read("one", 100, async () => "bad"), "new");
  }
});
