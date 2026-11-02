import { videoAssets } from "../src/db/video-schema";
import { readVideo } from "../src/server/video-media";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { memberBlocks, contentRestrictions } from "../src/db/safety-schema";
import { CATEGORIES } from "../src/domain/categories";
import type { createDatabase } from "../src/db/connection";
import { localImageObjectStore } from "../src/server/image-storage-core";
import { readImage } from "../src/server/media";
import { imageObjectCacheStats } from "../src/server/image-object-cache";

test("warm image bytes and conditional validators cannot bypass hidden posts or private uploader access", async () => {
  const pg = new PGlite(),
    db = drizzle(pg);
  const shared = globalThis as unknown as { sliperConnection?: ReturnType<typeof createDatabase> },
    prior = shared.sliperConnection;
  const oldCloud = process.env.SLIPER_CLOUD_ONLY;
  process.env.SLIPER_CLOUD_ONLY = "false";
  const store = localImageObjectStore(),
    image = randomUUID(),
    privateImage = randomUUID(),
    owner = randomUUID();
  const video = randomUUID();
  const keys = [image + ".webp", privateImage + ".webp"];
  try {
    await pg.exec(
      "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
    );
    await migrate(db, { migrationsFolder: "./drizzle" });
    await db.insert(schema.categories).values([...CATEGORIES]);
    await pg.query("insert into auth.users values($1)", [owner]);
    await db.insert(schema.profiles).values({ id: owner, nickname: "미디어검증" });
    const [post] = await db
      .insert(schema.posts)
      .values({
        authorId: owner,
        categorySlug: "party",
        kind: "이야기",
        title: "공개 사진 검사",
        bodyMarkdown: "미디어 캐시 권한 검사",
      })
      .returning();
    for (const [index, id] of [image, privateImage].entries()) {
      await store.write("post", keys[index]!, new Uint8Array([1, 2, 3]));
      await db.insert(schema.mediaAssets).values({
        id,
        uploaderId: owner,
        postId: index === 0 ? post!.id : null,
        objectKey: keys[index]!,
        storageBackend: "local",
        contentType: "image/webp",
        byteSize: 3,
        status: "ready",
      });
    }
    await store.write("video", video + ".mp4", new Uint8Array([1, 2, 3]));
    await db.insert(videoAssets).values({
      id: video,
      uploaderId: owner,
      postId: post!.id,
      objectKey: video + ".mp4",
      storageBackend: "local",
      contentType: "video/mp4",
      byteSize: 3,
      width: 320,
      height: 240,
      durationSeconds: 1,
      status: "ready",
    });
    shared.sliperConnection = {
      db: db as unknown as ReturnType<typeof createDatabase>["db"],
      close: async () => {},
    };
    const first = await readImage(image, null, new Request("http://local/image"));
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag")!;
    assert.ok(etag);
    const seek = await readVideo(
      video,
      null,
      new Request("http://local/video", { headers: { Range: "bytes=0-1" } }),
    );
    assert.equal(seek.status, 206);
    assert.deepEqual([...new Uint8Array(await seek.arrayBuffer())], [1, 2]);
    const before = imageObjectCacheStats().loads;
    const conditional = () =>
      new Request("http://local/image", { headers: { "if-none-match": etag } });
    const second = await readImage(image, null, conditional());
    assert.equal(second.status, 304);
    assert.equal(imageObjectCacheStats().loads, before);
    const head = await readImage(
      image,
      null,
      new Request("http://local/image", { method: "HEAD" }),
    );
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(imageObjectCacheStats().loads, before);
    const viewer = randomUUID();
    await pg.query("insert into auth.users values($1)", [viewer]);
    await db.insert(schema.profiles).values({ id: viewer, nickname: "차단확인회원" });
    await db
      .insert(memberBlocks)
      .values({ blockerId: viewer, blockedId: owner, displayLabel: "검증 작성자" });
    await assert.rejects(readImage(image, viewer, conditional()));
    for (const method of ["GET", "HEAD"])
      await assert.rejects(
        readVideo(
          video,
          viewer,
          new Request("http://local/video", { method, headers: { Range: "bytes=0-1" } }),
        ),
      );
    await db.delete(memberBlocks);
    await db.insert(contentRestrictions).values({
      targetType: "post",
      targetId: post!.id,
      hidden: true,
      reason: "검증",
      updatedBy: owner,
    });
    await assert.rejects(readImage(image, null, conditional()));
    for (const method of ["GET", "HEAD"])
      await assert.rejects(
        readVideo(
          video,
          null,
          new Request("http://local/video", { method, headers: { Range: "bytes=0-1" } }),
        ),
      );
    await assert.rejects(
      readImage(
        image,
        owner,
        new Request("http://local/image", { method: "HEAD", headers: { "if-none-match": "*" } }),
      ),
    );
    await db.delete(contentRestrictions);
    await db
      .update(schema.posts)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(schema.posts.id, post!.id));
    await assert.rejects(readImage(image, null, conditional()));
    const own = await readImage(privateImage, owner, conditional());
    assert.equal(own.status, 200);
    assert.equal(own.headers.get("etag"), null);
    assert.equal(own.headers.get("cache-control"), "private, no-store");
    await assert.rejects(readImage(privateImage, null, conditional()));
  } finally {
    if (prior) shared.sliperConnection = prior;
    else delete shared.sliperConnection;
    if (oldCloud === undefined) delete process.env.SLIPER_CLOUD_ONLY;
    else process.env.SLIPER_CLOUD_ONLY = oldCloud;
    for (const key of keys) await store.remove("post", key);
    await store.remove("video", video + ".mp4");
    await pg.close();
  }
});
