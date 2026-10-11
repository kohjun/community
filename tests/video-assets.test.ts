import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as baseSchema from "../src/db/schema";
import { videoAssets } from "../src/db/video-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import {
  postDocumentSchema,
  postDocumentVideoIds,
  postDocumentToMarkdown,
  type PostDocument,
  type PostDocumentNode,
} from "../src/domain/post-document";
import { createPostSchema } from "../src/domain/validation";
import { communityService } from "../src/server/community-service";
import { AppError } from "../src/server/errors";

const document = (...content: PostDocumentNode[]): PostDocument => ({
  version: 1,
  type: "doc",
  content,
});
const paragraph = (text: string): PostDocumentNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const uploadedVideo = (assetId: string): PostDocumentNode => ({
  type: "uploadedVideo",
  attrs: { assetId },
});
const input = {
  categorySlug: "party",
  kind: "이야기",
  title: "영상 후기",
  bodyMarkdown: "기존 본문",
};

test("uploaded video document blocks retain cursor order and derive private application URLs", () => {
  const id = randomUUID();
  const parsed = postDocumentSchema.parse(
    document(paragraph("앞"), uploadedVideo(id.toUpperCase()), paragraph("뒤")),
  );
  assert.deepEqual(postDocumentVideoIds(parsed), [id]);
  const fallback = postDocumentToMarkdown(parsed);
  assert.ok(fallback.indexOf("앞") < fallback.indexOf("/api/videos/" + id));
  assert.ok(fallback.indexOf("/api/videos/" + id) < fallback.indexOf("뒤"));
  const value = createPostSchema.parse({
    ...input,
    bodyMarkdown: "위조 내용",
    bodyDocument: parsed,
  });
  assert.equal(value.bodyMarkdown, fallback);
  assert.equal("videoAssetIds" in value, false);
  assert.ok(postDocumentSchema.safeParse(document(uploadedVideo(id))).success);
});

test("uploaded video blocks reject duplicates, more than three assets, URLs, extra attributes and inline nesting", () => {
  const id = randomUUID();
  const invalid = [
    document(uploadedVideo(id), uploadedVideo(id.toUpperCase())),
    document(...Array.from({ length: 4 }, () => uploadedVideo(randomUUID()))),
    document(uploadedVideo("../private")),
    document(uploadedVideo("https://example.com/video.mp4")),
    {
      version: 1,
      type: "doc",
      content: [{ type: "uploadedVideo", attrs: { assetId: id, src: "/secret", onerror: "x" } }],
    },
    document({ type: "paragraph", content: [uploadedVideo(id)] }),
  ];
  for (const candidate of invalid)
    assert.equal(postDocumentSchema.safeParse(candidate).success, false);
  assert.ok(
    postDocumentSchema.safeParse(
      document(...Array.from({ length: 3 }, () => uploadedVideo(randomUUID()))),
    ).success,
  );
});

const pg = new PGlite();
const db = drizzle(pg, { schema: { ...baseSchema, videoAssets } });
const service = communityService(db as unknown as Database);
let owner: string, other: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
const state = (expected: string) => (error: unknown) =>
  (error as { cause?: { code?: string }; code?: string }).cause?.code === expected ||
  (error as { code?: string }).code === expected;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values ($1)", [id]);
  await db.insert(baseSchema.profiles).values({ id, nickname });
  return id;
}
async function asset(uploaderId: string, status: "ready" | "pending" = "ready") {
  const id = randomUUID();
  await db.insert(videoAssets).values({
    id,
    uploaderId,
    objectKey: id + ".mp4",
    storageBackend: "local",
    contentType: "video/mp4",
    byteSize: 1024,
    width: 1280,
    height: 720,
    durationSeconds: 12.5,
    status,
  });
  return id;
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(baseSchema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("영상 작성자");
  other = await member("다른 작성자");
});
after(() => pg.close());

test("video CRUD attaches validated derivatives, publishes only safe DTO fields and reorders atomically", async () => {
  const a = await asset(owner),
    b = await asset(owner);
  const post = await service.createPost(owner, {
    ...input,
    bodyDocument: document(
      paragraph("전"),
      uploadedVideo(a),
      paragraph("중"),
      uploadedVideo(b),
      paragraph("후"),
    ),
  });
  assert.deepEqual(
    post.videos?.map((video) => video.id),
    [a, b],
  );
  assert.equal(post.videos?.[0]?.src, "/api/videos/" + a);
  assert.equal(post.videos?.[0]?.durationSeconds, 12.5);
  assert.equal(post.videos?.[0]?.byteSize, 1024);
  assert.equal(JSON.stringify(post).includes(owner), false);
  assert.equal(JSON.stringify(post).includes("objectKey"), false);
  assert.equal(JSON.stringify(post).includes("storageBackend"), false);
  const changed = await service.updatePost(owner, {
    ...input,
    postId: post.id,
    expectedUpdatedAt: post.updatedAt,
    bodyDocument: document(uploadedVideo(b), paragraph("새 순서"), uploadedVideo(a)),
  });
  assert.deepEqual(
    changed.videos?.map((video) => [video.id, video.sortOrder]),
    [
      [b, 0],
      [a, 1],
    ],
  );
  const feed = await service.feed(other);
  assert.deepEqual(feed.posts[0]?.videos, changed.videos);
  const detached = await service.updatePost(owner, {
    ...input,
    postId: post.id,
    expectedUpdatedAt: changed.updatedAt,
    bodyDocument: document(paragraph("영상 제거")),
  });
  assert.deepEqual(detached.videos, []);
  assert.ok((await db.select().from(videoAssets)).every((video) => video.postId === null));
});

test("foreign, unready, nonexistent and previously attached videos roll back the entire post transaction", async () => {
  for (const id of [await asset(other), await asset(owner, "pending"), randomUUID()])
    await assert.rejects(
      service.createPost(owner, { ...input, bodyDocument: document(uploadedVideo(id)) }),
      code("FORBIDDEN"),
    );
  assert.equal((await service.feed(owner)).posts.length, 0);
  const mine = await asset(owner);
  const original = await service.createPost(owner, {
    ...input,
    bodyDocument: document(uploadedVideo(mine)),
  });
  await assert.rejects(
    service.createPost(owner, { ...input, bodyDocument: document(uploadedVideo(mine)) }),
    code("FORBIDDEN"),
  );
  const foreign = await asset(other);
  await assert.rejects(
    service.updatePost(owner, {
      ...input,
      postId: original.id,
      expectedUpdatedAt: original.updatedAt,
      bodyDocument: document(uploadedVideo(foreign)),
    }),
    code("FORBIDDEN"),
  );
  const unchanged = await service.getPost(original.id, owner);
  assert.deepEqual(unchanged.bodyDocument, original.bodyDocument);
  assert.deepEqual(unchanged.videos, original.videos);
});

test("explicit Markdown conversion detaches videos and forged stored documents do not reveal private IDs", async () => {
  const id = await asset(owner);
  const post = await service.createPost(owner, {
    ...input,
    bodyDocument: document(uploadedVideo(id)),
  });
  const converted = await service.updatePost(owner, {
    ...input,
    postId: post.id,
    expectedUpdatedAt: post.updatedAt,
    bodyDocument: null,
  });
  assert.equal(converted.bodyDocument, null);
  assert.deepEqual(converted.videos, []);
  const secret = await asset(other);
  await db
    .update(baseSchema.posts)
    .set({ bodyDocument: document(uploadedVideo(secret)) })
    .where(eq(baseSchema.posts.id, post.id));
  const forged = await service.getPost(post.id, other);
  assert.equal(forged.bodyDocument, null);
  assert.equal(JSON.stringify(forged).includes(secret), false);
  await service.deletePost(owner, post.id);
  await assert.rejects(service.getPost(post.id, owner), code("NOT_FOUND"));
});

test("database enforces video derivative bounds, readiness, ownership and immutable metadata", async () => {
  const id = await asset(owner);
  for (const patch of [
    { storageBackend: "supabase" as const },
    { uploaderId: other },
    { byteSize: 2048 },
    { width: 640 },
    { height: 480 },
    { durationSeconds: 20 },
    { objectKey: randomUUID() + ".mp4" },
  ])
    await assert.rejects(
      db.update(videoAssets).set(patch).where(eq(videoAssets.id, id)),
      state("23514"),
    );
  const foreignPost = await service.createPost(other, input);
  await assert.rejects(
    db.update(videoAssets).set({ postId: foreignPost.id }).where(eq(videoAssets.id, id)),
    state("23514"),
  );
  const pending = await asset(owner, "pending");
  const ownPost = await service.createPost(owner, input);
  await assert.rejects(
    db.update(videoAssets).set({ postId: ownPost.id }).where(eq(videoAssets.id, pending)),
    state("23514"),
  );
  for (const patch of [
    { byteSize: 26214401 },
    { byteSize: 0 },
    { width: 1921 },
    { height: 0 },
    { durationSeconds: 181 },
    { durationSeconds: 0 },
    { durationSeconds: Number.NaN },
    { durationSeconds: Number.POSITIVE_INFINITY },
    { sortOrder: 3 },
    { contentType: "video/webm" as "video/mp4" },
  ]) {
    const candidate = randomUUID();
    await assert.rejects(
      db.insert(videoAssets).values({
        id: candidate,
        uploaderId: owner,
        objectKey: candidate + ".mp4",
        byteSize: 100,
        width: 1280,
        height: 720,
        durationSeconds: 10,
        ...patch,
      }),
      state("23514"),
    );
  }
});

test("video assets are private under RLS and orphaned ownership cannot be reattached", async () => {
  const id = await asset(owner);
  const post = await service.createPost(owner, {
    ...input,
    bodyDocument: document(uploadedVideo(id)),
  });
  const schemaMeta = await pg.query<{ enabled: boolean }>(
    "select relrowsecurity as enabled from pg_class where oid='sliper.video_assets'::regclass",
  );
  assert.equal(schemaMeta.rows[0]?.enabled, true);
  const privileges = await pg.query<{ allowed: boolean }>(
    "select has_table_privilege('anon','sliper.video_assets','select') as allowed",
  );
  assert.equal(privileges.rows[0]?.allowed, false);
  await pg.query("delete from auth.users where id=$1", [owner]);
  const video = (await db.select().from(videoAssets).where(eq(videoAssets.id, id)))[0]!;
  assert.equal(video.uploaderId, null);
  assert.equal(video.postId, post.id);
  const another = await service.createPost(other, input);
  await assert.rejects(
    db.update(videoAssets).set({ postId: another.id }).where(eq(videoAssets.id, id)),
    state("23514"),
  );
  await assert.rejects(
    db.update(videoAssets).set({ uploaderId: other }).where(eq(videoAssets.id, id)),
    state("23514"),
  );
});
