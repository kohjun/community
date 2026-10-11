import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, after, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import * as schema from "../src/db/schema";
import { contentRestrictions, memberBlocks } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import {
  postPath,
  postShareOrigin,
  publicPostShare,
  ogTitleText,
} from "../src/domain/post-sharing";
import { readPublicPostShare } from "../src/server/post-sharing-reader";
import { createPostReader } from "../src/server/post-reader";
import { renderPostShareImage } from "../src/server/post-share-image";
import { AppError } from "../src/server/errors";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const source = {
  id,
  title: "새로운 모임을 만들어요",
  categorySlug: "party" as const,
  kind: "이야기" as const,
  createdAt: new Date("2026-10-05T03:00:00.000Z"),
};
test("post addresses contain a normalized UUID and never retain tracking or unsafe path values", () => {
  assert.equal(postPath(id.toUpperCase()), "/posts/" + id);
  for (const invalid of [
    "",
    "null",
    "../admin",
    id + "?token=secret",
    id + "#reply",
    "<script>",
    "00000000-0000-0000-0000-000000000000",
  ]) {
    assert.throws(() => postPath(invalid));
  }
});
test("canonical origin is taken from validated configuration, with loopback limited to local mode", () => {
  assert.equal(postShareOrigin("https://sliper.example/")?.href, "https://sliper.example/");
  assert.equal(postShareOrigin("http://127.0.0.1:3000", true)?.href, "http://127.0.0.1:3000/");
  assert.equal(postShareOrigin(undefined, true)?.href, "http://127.0.0.1:3000/");
  assert.equal(postShareOrigin(undefined), null);
  for (const value of [
    "http://sliper.example",
    "https://user:pass@sliper.example",
    "https://sliper.example/path",
    "https://sliper.example?token=secret",
    "https://sliper.example/#secret",
    "javascript:evil",
    "https://127.0.0.1",
    "http://localhost:3000",
  ]) {
    assert.equal(postShareOrigin(value), null);
  }
  assert.equal(postShareOrigin("invalid", true), null);
});
test("sharing projection excludes body, contact, anonymous identity, account IDs and images", () => {
  const privateSource = {
    ...source,
    body: "private body secret-phone",
    bodyDocument: { content: [{ attrs: { url: "secret-url" } }] },
    contactInfo: "private contact",
    authorId: randomUUID(),
    author: "private real name",
    isAnonymous: true,
    images: [{ src: "private-image" }],
  };
  const share = publicPostShare(privateSource);
  assert.deepEqual(
    Object.keys(share).sort(),
    ["path", "title", "description", "category", "kind", "publishedAt"].sort(),
  );
  const serialized = JSON.stringify(share);
  for (const value of [
    "private body",
    "private contact",
    privateSource.authorId,
    "private real name",
    "private-image",
    "secret-url",
  ])
    assert.equal(serialized.includes(value), false);
  assert.equal(
    share.description,
    "파티 · 이야기 | 취향 맞는 사람들과 나누는 Sliper 커뮤니티. 글과 댓글을 확인해보세요.",
  );
});
test("shared titles hide common contact strings and truncate complete graphemes", () => {
  const share = publicPostShare({
    ...source,
    title: "<b>문의</b> 010-1234-5678 hi@example.com https://example.com/token?private=1\u202e",
  });
  assert.equal(share.title, "문의 [연락처] [이메일] [링크]");
  const family = "👨‍👩‍👧‍👦";
  const long = publicPostShare({ ...source, title: family.repeat(75) });
  assert.equal(long.title, family.repeat(69) + "…");
});
test("unknown OG glyphs stay local while Korean and Latin supported text remains", () => {
  const coverage = new Set(Array.from("한글 text□").map((char) => char.codePointAt(0)!));
  assert.equal(ogTitleText("한글 text 😎", coverage), "한글 text □");
});

const pg = new PGlite();
const db = drizzle(pg, { schema });
const database = db as unknown as Database;
let owner: string, viewer: string, postId: string;
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = randomUUID();
  viewer = randomUUID();
  postId = randomUUID();
  await pg.query("insert into auth.users values($1),($2)", [owner, viewer]);
  await db.insert(schema.profiles).values([
    { id: owner, nickname: "비공개 작성자" },
    { id: viewer, nickname: "공개 열람자" },
  ]);
  await db.insert(schema.posts).values({
    id: postId,
    categorySlug: "party",
    authorId: owner,
    isAnonymous: true,
    title: source.title,
    kind: "이야기",
    bodyMarkdown: "전화번호와 비공개 본문",
    contactInfo: "01012345678",
  });
});
after(() => pg.close());
const notFound = (error: unknown) => error instanceof AppError && error.code === "NOT_FOUND";
test("published anonymous posts have safe public previews without private author data", async () => {
  const share = await readPublicPostShare(database, postId);
  assert.equal(share.title, source.title);
  const json = JSON.stringify(share);
  for (const privateValue of [
    owner,
    viewer,
    "비공개 작성자",
    "전화번호와 비공개 본문",
    "01012345678",
  ])
    assert.equal(json.includes(privateValue), false);
  const visible = await createPostReader(database).getPost(postId, viewer);
  assert.equal(visible.author, "익명");
});
test("deleted, hidden, missing and malformed posts cannot expose share metadata", async () => {
  for (const invalid of ["invalid", randomUUID(), postId + "?token=secret"])
    await assert.rejects(readPublicPostShare(database, invalid), notFound);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: postId, hidden: true, reason: "운영 검토" });
  await assert.rejects(readPublicPostShare(database, postId), notFound);
  await db
    .update(contentRestrictions)
    .set({ hidden: false })
    .where(eq(contentRestrictions.targetId, postId));
  assert.equal((await readPublicPostShare(database, postId)).title, source.title);
  await db.update(schema.posts).set({ status: "deleted" }).where(eq(schema.posts.id, postId));
  await assert.rejects(readPublicPostShare(database, postId), notFound);
});
test("detail loading retains viewer blocking while bot preview remains limited to public fields", async () => {
  await db
    .insert(memberBlocks)
    .values({ blockerId: viewer, blockedId: owner, displayLabel: "차단한 작성자" });
  await assert.rejects(createPostReader(database).getPost(postId, viewer), notFound);
  const publicShare = await readPublicPostShare(database, postId);
  assert.equal(publicShare.title, source.title);
  assert.equal("authorId" in publicShare, false);
});
test("Korean OG images render locally with no external font, emoji or image fetch", async () => {
  const [font, logo, data] = await Promise.all([
    readFile("public/fonts/SliperShareSans-SemiBold.ttf"),
    readFile("public/images/sliper-icon-192.png"),
    readFile("public/fonts/SliperShareSans-coverage.json", "utf8"),
  ]);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("External asset fetch attempted");
  };
  try {
    const image = renderPostShareImage(
      publicPostShare({ ...source, title: "슬리퍼와 함께 예능 한 스푼 😎 여행 話題" }),
      { font, logo, coverage: new Set<number>(JSON.parse(data) as number[]) },
    );
    const body = Buffer.from(await image.arrayBuffer());
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("cache-control"), "private, no-store");
    assert.deepEqual([...body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const metadata = await sharp(body).metadata();
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 630);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
