import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { posts, profiles, mediaAssets } from "../src/db/schema";
import { videoAssets } from "../src/db/video-schema";
import { mediaRetentionJobs } from "../src/db/media-retention-schema";
import { mediaRetentionService } from "../src/server/media-retention-service";
import { verifyLocalRetentionPath } from "../src/server/media-retention-local";
import { imageObjectStore } from "../src/server/image-storage";

const address = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev" ||
  !["postgres:", "postgresql:"].includes(address.protocol)
)
  throw Error("Media retention checks require the isolated local development database.");

test("native retention removes only expired fixture objects once and preserves linked files", async () => {
  const connection = createDatabase(address.href, 1),
    db = connection.db,
    service = mediaRetentionService(db);
  const owner = randomUUID(),
    post = randomUUID(),
    image = randomUUID(),
    video = randomUUID(),
    attached = randomUUID(),
    ids = [image, video, attached];
  const files = [
    ["uploads", image + ".webp"],
    ["videos", video + ".mp4"],
    ["uploads", attached + ".webp"],
  ].map(([folder, key]) => path.resolve(process.cwd(), ".local", folder!, key!));
  const bytes = Buffer.from("sliper-retention-fixture");
  let created = false;
  try {
    const before = await service.summary();
    assert.equal(
      before.eligibleImages + before.eligibleVideos + before.queued + before.processing,
      0,
      "Refuse fixture cleanup while unrelated cleanup work is available.",
    );
    await db.execute(sql`insert into auth.users(id) values(${owner}::uuid)`);
    created = true;
    await db.insert(profiles).values({ id: owner, nickname: "보관 회귀 검증" });
    await db.insert(posts).values({
      id: post,
      authorId: owner,
      title: "보관 연결 검증",
      bodyMarkdown: "이 파일은 글에 연결된 상태로 보존합니다.",
      categorySlug: "party",
      kind: "이야기",
    });
    const past = new Date(Date.now() - 31 * 86400000);
    await db.insert(mediaAssets).values([
      {
        id: image,
        uploaderId: owner,
        objectKey: image + ".webp",
        contentType: "image/webp",
        byteSize: bytes.length,
        status: "ready",
        createdAt: past,
        unattachedSince: past,
      },
      {
        id: attached,
        uploaderId: owner,
        postId: post,
        objectKey: attached + ".webp",
        contentType: "image/webp",
        byteSize: bytes.length,
        status: "ready",
        createdAt: past,
        unattachedSince: past,
      },
    ]);
    await db.insert(videoAssets).values({
      id: video,
      uploaderId: owner,
      objectKey: video + ".mp4",
      byteSize: bytes.length,
      width: 10,
      height: 10,
      durationSeconds: 1,
      status: "ready",
      createdAt: past,
      unattachedSince: past,
    });
    for (const file of files) {
      assert.ok(
        file
          .toLowerCase()
          .startsWith(path.resolve(process.cwd(), ".local").toLowerCase() + path.sep),
      );
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: "wx" });
    }
    assert.equal((await service.summary()).eligibleImages, 1);
    assert.equal((await service.summary()).eligibleVideos, 1);
    assert.equal(await service.reserve(), 2);
    assert.equal(await service.reserve(), 0);
    for (const id of [image, video]) {
      const [job] = await db
        .select()
        .from(mediaRetentionJobs)
        .where(eq(mediaRetentionJobs.assetId, id));
      assert.ok(job);
      assert.equal(job.status, "pending");
    }
    const result = await service.drain(async (kind, backend, key) => {
      assert.equal(backend, "local");
      assert.ok([image + ".webp", video + ".mp4"].includes(key));
      await verifyLocalRetentionPath(kind, key);
      await imageObjectStore(backend).remove(kind === "image" ? "post" : "video", key);
    });
    assert.deepEqual(result, { reserved: 0, attempted: 2, removed: 2 });
    await assert.rejects(readFile(files[0]!), { code: "ENOENT" });
    await assert.rejects(readFile(files[1]!), { code: "ENOENT" });
    assert.deepEqual(await readFile(files[2]!), bytes);
    const [linked] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, attached));
    assert.equal(linked!.status, "ready");
    assert.equal(linked!.postId, post);
    const [preserved] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, image));
    assert.equal(preserved!.status, "pending");
    assert.deepEqual(
      await service.drain(async () => {
        throw Error("Must not repeat file removal");
      }),
      { reserved: 0, attempted: 0, removed: 0 },
    );
    assert.equal((await service.summary()).removed, before.removed + 2);
  } finally {
    try {
      await db.delete(mediaRetentionJobs).where(inArray(mediaRetentionJobs.assetId, ids));
      if (created) {
        await db.delete(mediaAssets).where(inArray(mediaAssets.id, [image, attached]));
        await db.delete(videoAssets).where(eq(videoAssets.id, video));
        await db.delete(posts).where(eq(posts.id, post));
        await db.delete(profiles).where(eq(profiles.id, owner));
        await db.execute(sql`delete from auth.users where id=${owner}::uuid`);
      }
      for (const file of files) {
        assert.ok(
          file
            .toLowerCase()
            .startsWith(path.resolve(process.cwd(), ".local").toLowerCase() + path.sep),
        );
        await unlink(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    } finally {
      await connection.close();
    }
  }
});
