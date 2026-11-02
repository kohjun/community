import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { authorizedImageResponse } from "../src/server/image-delivery";
import { cachedImageObjectStore } from "../src/server/image-object-cache";
import type { ImageObjectStore } from "../src/server/image-storage-core";
test("public image validation avoids bytes for weak/list validators and HEAD; private images never return 304", async () => {
  let loads = 0;
  const image = { id: randomUUID(), byteSize: 3, contentType: "image/webp", browserCache: true };
  const load = async () => {
    loads++;
    return new Uint8Array([1, 2, 3]);
  };
  const first = await authorizedImageResponse(new Request("http://local/image"), image, load);
  const etag = first.headers.get("etag")!;
  assert.ok(etag);
  assert.match(first.headers.get("cache-control")!, /private.*no-cache/);
  for (const value of [etag, "W/" + etag, '"other", W/' + etag, "*"]) {
    const response = await authorizedImageResponse(
      new Request("http://local/image", { headers: { "if-none-match": value } }),
      image,
      load,
    );
    assert.equal(response.status, 304);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  const head = await authorizedImageResponse(
    new Request("http://local/image", { method: "HEAD" }),
    image,
    load,
  );
  assert.equal(head.headers.get("content-length"), "3");
  assert.equal(loads, 1);
  const privateResponse = await authorizedImageResponse(
    new Request("http://local/image", { headers: { "if-none-match": etag } }),
    { ...image, browserCache: false },
    load,
  );
  assert.equal(privateResponse.status, 200);
  assert.equal(privateResponse.headers.get("etag"), null);
  assert.equal(privateResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(loads, 2);
});
test("image object reads coalesce, isolate projects and callers, and removal invalidates warm bytes", async () => {
  let reads = 0;
  const store: ImageObjectStore = {
    backend: "supabase",
    write: async () => {},
    remove: async () => {},
    read: async () => {
      reads++;
      return new Uint8Array([1, 2, 3]);
    },
  };
  const namespace = randomUUID(),
    object = randomUUID() + ".webp",
    a = cachedImageObjectStore(store, namespace),
    b = cachedImageObjectStore(store, namespace + "other");
  const [first] = await Promise.all([a.read("post", object), a.read("post", object)]);
  assert.equal(reads, 1);
  first![0] = 99;
  assert.equal((await a.read("post", object))[0], 1);
  await b.read("post", object);
  assert.equal(reads, 2);
  await a.remove("post", object);
  await a.read("post", object);
  assert.equal(reads, 3);
});
