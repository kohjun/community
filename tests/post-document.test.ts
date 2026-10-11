import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import {
  postDocumentSchema,
  postDocumentImageIds,
  postDocumentToMarkdown,
  safeExternalLink,
  parseVideoUrl,
  type PostDocument,
  type PostDocumentNode,
} from "../src/domain/post-document";
import { createPostSchema } from "../src/domain/validation";
import { communityService } from "../src/server/community-service";
import { AppError } from "../src/server/errors";

const imageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const doc = (...content: PostDocumentNode[]): PostDocument => ({
  version: 1,
  type: "doc",
  content,
});
const paragraph = (text: string): PostDocumentNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const image = (id = imageId): PostDocumentNode => ({
  type: "image",
  attrs: { assetId: id, alt: "현장 사진" },
});
const video: PostDocumentNode = { type: "video", attrs: { url: "https://youtu.be/dQw4w9WgXcQ" } };
const input = {
  categorySlug: "party",
  kind: "이야기",
  title: "우리 이야기",
  bodyMarkdown: "기존 Markdown 내용",
};

test("rich documents preserve text-image-video-text order and normalize provider URLs", () => {
  const parsed = postDocumentSchema.parse(
    doc(paragraph("앞 설명"), image(), video, paragraph("뒤 설명")),
  );
  assert.deepEqual(
    parsed.content.map((node) => node.type),
    ["paragraph", "image", "video", "paragraph"],
  );
  assert.deepEqual(postDocumentImageIds(parsed), [imageId]);
  assert.equal(
    (parsed.content[2] as typeof video).attrs.url,
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  const text = postDocumentToMarkdown(parsed);
  assert.ok(text.indexOf("앞 설명") < text.indexOf("/api/media/" + imageId));
  assert.ok(text.indexOf("영상:") < text.indexOf("뒤 설명"));
});

test("text styles and hyperlinks accept only explicit safe attributes", () => {
  const formatted = doc({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "안내",
        marks: [
          { type: "bold" },
          { type: "underline" },
          { type: "link", attrs: { href: "https://example.com/guide" } },
        ],
      },
    ],
  });
  assert.ok(postDocumentSchema.safeParse(formatted).success);
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,evil",
    "https://user:pass@example.com",
    "https://127.0.0.1/a",
  ]) {
    const value = structuredClone(formatted);
    (value.content[0] as { content: { marks: unknown[] }[] }).content[0]!.marks = [
      { type: "link", attrs: { href } },
    ];
    assert.equal(postDocumentSchema.safeParse(value).success, false);
  }
  assert.equal(postDocumentSchema.safeParse({ ...formatted, style: "color:red" }).success, false);
});

test("arbitrary HTML, iframe, foreign source images and event-handler attributes are rejected", () => {
  for (const node of [
    { type: "html", content: "<script>alert(1)</script>" },
    { type: "iframe", attrs: { src: "https://evil.example" } },
    {
      type: "image",
      attrs: { assetId: imageId, alt: "x", src: "https://evil.example/x", onerror: "x" },
    },
    { type: "text", text: "x", marks: [{ type: "bold", attrs: { style: "color:red" } }] },
  ])
    assert.equal(
      postDocumentSchema.safeParse({ version: 1, type: "doc", content: [node] }).success,
      false,
    );
});

test("block structure prevents media nested inside paragraphs and malformed list content", () => {
  for (const content of [
    [{ type: "paragraph", content: [image()] }],
    [{ type: "bulletList", content: [paragraph("일반 문단")] }],
    [{ type: "listItem", content: [paragraph("항목")] }],
    [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "제목" }] }],
  ])
    assert.equal(postDocumentSchema.safeParse({ version: 1, type: "doc", content }).success, false);
  assert.ok(
    postDocumentSchema.safeParse(
      doc({
        type: "orderedList",
        attrs: { start: 3 },
        content: [{ type: "listItem", content: [paragraph("세 번째 항목")] }],
      }),
    ).success,
  );
});

test("documents enforce nested depth, node count, text and UTF-8 byte budgets", () => {
  let nested: PostDocumentNode = paragraph("내용");
  for (let i = 0; i < 9; i++) nested = { type: "blockquote", content: [nested] };
  assert.equal(postDocumentSchema.safeParse(doc(nested)).success, false);
  assert.equal(
    postDocumentSchema.safeParse(doc(...Array.from({ length: 251 }, () => paragraph("a")))).success,
    false,
  );
  assert.equal(postDocumentSchema.safeParse(doc(paragraph("a".repeat(30001)))).success, false);
  assert.equal(
    postDocumentSchema.safeParse(
      doc({ type: "legacyMarkdown", attrs: { markdown: "한".repeat(80000) } }),
    ).success,
    false,
  );
  const cyclic: Record<string, unknown> = { version: 1, type: "doc" };
  cyclic.content = [cyclic];
  assert.equal(postDocumentSchema.safeParse(cyclic).success, false);
});

test("image and video limits reject duplicate assets and excessive media blocks", () => {
  assert.equal(postDocumentSchema.safeParse(doc(image(), image())).success, false);
  assert.equal(
    postDocumentSchema.safeParse(doc(...Array.from({ length: 11 }, () => image(randomUUID()))))
      .success,
    false,
  );
  assert.equal(
    postDocumentSchema.safeParse(doc(...Array.from({ length: 11 }, () => video))).success,
    false,
  );
  assert.equal(
    postDocumentSchema.safeParse(doc({ type: "image", attrs: { assetId: "../private", alt: "" } }))
      .success,
    false,
  );
});

test("legacy Markdown has one bounded preservation block and cannot inject extra attributes", () => {
  const markdown = "| 표 | 내용 |\n| --- | --- |\n| 1 | 2 |\n\n~~~js\nconst x = 1;\n~~~";
  const parsed = postDocumentSchema.parse(
    doc({ type: "legacyMarkdown", attrs: { markdown } }, paragraph("새 설명")),
  );
  assert.ok(postDocumentToMarkdown(parsed).includes(markdown));
  assert.equal(
    postDocumentSchema.safeParse(
      doc(
        { type: "legacyMarkdown", attrs: { markdown } },
        { type: "legacyMarkdown", attrs: { markdown } },
      ),
    ).success,
    false,
  );
  assert.equal(
    postDocumentSchema.safeParse(doc({ type: "legacyMarkdown", attrs: { markdown: "   " } }))
      .success,
    false,
  );
});

test("empty text documents fail while media-only rich posts have a valid server fallback", () => {
  assert.equal(postDocumentSchema.safeParse(doc({ type: "paragraph" })).success, false);
  assert.ok(postDocumentSchema.safeParse(doc(image())).success);
  assert.ok(
    createPostSchema.safeParse({
      ...input,
      bodyMarkdown: "",
      bodyDocument: doc(image()),
      imageAssetIds: [imageId],
    }).success,
  );
  assert.equal(
    createPostSchema.safeParse({ ...input, bodyDocument: doc(image()), imageAssetIds: [] }).success,
    false,
  );
});

test("external links reject credentials, private IPv4/IPv6, obfuscated localhost and unsafe schemes", () => {
  for (const href of [
    "javascript:alert(1)",
    "file:///x",
    "http://localhost/x",
    "http://example.local/x",
    "http://127.0.0.1/x",
    "http://2130706433/x",
    "http://0x7f000001/x",
    "http://10.1.2.3/x",
    "http://172.16.0.1/x",
    "http://192.168.0.1/x",
    "http://169.254.169.254/x",
    "http://[::1]/x",
    "http://[fd00::1]/x",
    "http://[fe80::1]/x",
    "https://x:y@example.com/x",
    "https://example.com/\\evil",
    "https://example.com/\n",
  ])
    assert.equal(safeExternalLink(href), null, href);
  assert.equal(safeExternalLink("https://example.com/guide"), "https://example.com/guide");
  assert.equal(safeExternalLink("http://example.com/guide"), "http://example.com/guide");
});

test("YouTube shorts and timestamps use the privacy embed host, never caller-controlled iframe URLs", () => {
  const parsed = parseVideoUrl("https://m.youtube.com/shorts/dQw4w9WgXcQ?t=1m2s&autoplay=1");
  assert.deepEqual(parsed, {
    provider: "youtube",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=62",
    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=62",
  });
  assert.equal(parseVideoUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseVideoUrl("https://www.youtube.com/embed/invalid"), null);
});

test("Vimeo unlisted URLs retain their access hash while unrelated providers become safe link cards", () => {
  const parsed = parseVideoUrl("https://player.vimeo.com/video/123456789?h=abcdef1234");
  assert.deepEqual(parsed, {
    provider: "vimeo",
    url: "https://vimeo.com/123456789/abcdef1234",
    embedUrl: "https://player.vimeo.com/video/123456789?h=abcdef1234",
  });
  const unknown = "https://video.example.com/watch/abc";
  assert.equal(parseVideoUrl(unknown), null);
  assert.ok(postDocumentSchema.safeParse(doc({ type: "video", attrs: { url: unknown } })).success);
  assert.equal(
    postDocumentSchema.safeParse(
      doc({ type: "video", attrs: { url: "http://video.example.com/watch" } }),
    ).success,
    false,
  );
});

test("direct video supports public HTTPS MP4, WebM and OGG only", () => {
  for (const extension of ["mp4", "webm", "ogg"])
    assert.equal(
      parseVideoUrl("https://cdn.example.com/demo." + extension + "?token=abc")?.provider,
      "file",
    );
  assert.equal(parseVideoUrl("http://cdn.example.com/demo.mp4"), null);
  assert.equal(parseVideoUrl("https://127.0.0.1/demo.mp4"), null);
  assert.equal(parseVideoUrl("https://cdn.example.com/demo.html"), null);
});

const pg = new PGlite(),
  db = drizzle(pg, { schema });
const service = communityService(db as unknown as Database);
let owner: string, other: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(schema.profiles).values({ id, nickname });
  return id;
}
async function asset(userId: string) {
  const id = randomUUID();
  await db.insert(schema.mediaAssets).values({
    id,
    uploaderId: userId,
    objectKey: id + ".png",
    byteSize: 100,
    contentType: "image/png",
    status: "ready",
  });
  return id;
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("문서작성자");
  other = await member("다른작성자");
});
after(() => pg.close());

test("rich CRUD derives searchable body from JSON and preserves document ordering", async () => {
  const id = await asset(owner);
  const bodyDocument = doc(paragraph("원본 검색 문구"), image(id), video, paragraph("마지막 문단"));
  const post = await service.createPost(owner, {
    ...input,
    bodyDocument,
    bodyMarkdown: "조작된 검색 문구",
    imageAssetIds: [id],
  });
  assert.ok(post.body.includes("원본 검색 문구"));
  assert.equal(post.body.includes("조작된"), false);
  assert.deepEqual(
    post.bodyDocument?.content.map((n) => n.type),
    ["paragraph", "image", "video", "paragraph"],
  );
  assert.equal((await service.feed(other, { search: "원본 검색 문구" })).posts.length, 1);
  assert.equal((await service.feed(other, { search: "조작된 검색 문구" })).posts.length, 0);
  const changed = doc(paragraph("새 문장"), video, image(id), paragraph("결론"));
  const edited = await service.updatePost(owner, {
    ...input,
    postId: post.id,
    expectedUpdatedAt: post.updatedAt,
    bodyDocument: changed,
    imageAssetIds: [id],
  });
  assert.deepEqual(
    edited.bodyDocument?.content.map((n) => n.type),
    ["paragraph", "video", "image", "paragraph"],
  );
  assert.equal(edited.images[0]?.id, id);
  const row = (await db.select().from(schema.posts).where(eq(schema.posts.id, post.id)))[0]!;
  assert.deepEqual(row.bodyDocument, edited.bodyDocument);
});

test("rich image references reject foreign, pending and already-attached private assets atomically", async () => {
  const foreign = await asset(other);
  await assert.rejects(
    service.createPost(owner, {
      ...input,
      bodyDocument: doc(image(foreign)),
      imageAssetIds: [foreign],
    }),
    code("FORBIDDEN"),
  );
  assert.equal((await service.feed(owner)).posts.length, 0);
  const pending = await asset(owner);
  await db
    .update(schema.mediaAssets)
    .set({ status: "pending" })
    .where(eq(schema.mediaAssets.id, pending));
  await assert.rejects(
    service.createPost(owner, {
      ...input,
      bodyDocument: doc(image(pending)),
      imageAssetIds: [pending],
    }),
    code("FORBIDDEN"),
  );
  const mine = await asset(owner),
    original = await service.createPost(owner, {
      ...input,
      bodyDocument: doc(image(mine)),
      imageAssetIds: [mine],
    });
  await assert.rejects(
    service.createPost(owner, { ...input, bodyDocument: doc(image(mine)), imageAssetIds: [mine] }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    service.updatePost(owner, {
      ...input,
      postId: original.id,
      expectedUpdatedAt: original.updatedAt,
      bodyDocument: doc(image(foreign)),
      imageAssetIds: [foreign],
    }),
    code("FORBIDDEN"),
  );
  const unchanged = await service.getPost(original.id, owner);
  assert.equal(unchanged.images[0]?.id, mine);
  assert.deepEqual(unchanged.bodyDocument, original.bodyDocument);
});

test("rich updates cannot silently discard documents and explicit conversion preserves legacy API compatibility", async () => {
  const post = await service.createPost(owner, { ...input, bodyDocument: doc(paragraph("본문")) });
  await assert.rejects(
    service.updatePost(owner, { ...input, postId: post.id, expectedUpdatedAt: post.updatedAt }),
    code("VALIDATION"),
  );
  const converted = await service.updatePost(owner, {
    ...input,
    postId: post.id,
    expectedUpdatedAt: post.updatedAt,
    bodyDocument: null,
  });
  assert.equal(converted.bodyDocument, null);
  assert.equal(converted.body, input.bodyMarkdown);
  const legacy = await service.createPost(owner, input);
  const edited = await service.updatePost(owner, {
    ...input,
    postId: legacy.id,
    expectedUpdatedAt: legacy.updatedAt,
    bodyMarkdown: "레거시 수정",
  });
  assert.equal(edited.body, "레거시 수정");
  assert.equal(edited.bodyDocument, null);
});

test("public DTOs never expose a forged or dangling private image document from stored JSON", async () => {
  const post = await service.createPost(owner, input),
    secret = await asset(other);
  await db
    .update(schema.posts)
    .set({ bodyDocument: doc(paragraph("x"), image(secret)) })
    .where(eq(schema.posts.id, post.id));
  const detail = await service.getPost(post.id, other);
  assert.equal(detail.bodyDocument, null);
  assert.equal(JSON.stringify(detail).includes(secret), false);
  assert.equal(detail.body, input.bodyMarkdown);
});

test("document text, image alt and preserved Markdown reject PostgreSQL-invalid Unicode", () => {
  for (const invalid of ["a\u0000b", "\ud800", "\udfff"]) {
    assert.equal(postDocumentSchema.safeParse(doc(paragraph(invalid))).success, false);
    assert.equal(
      postDocumentSchema.safeParse(
        doc({ type: "image", attrs: { assetId: imageId, alt: invalid } }),
      ).success,
      false,
    );
    assert.equal(
      postDocumentSchema.safeParse(doc({ type: "legacyMarkdown", attrs: { markdown: invalid } }))
        .success,
      false,
    );
  }
  assert.ok(postDocumentSchema.safeParse(doc(paragraph("슬리퍼 😎 한글"))).success);
});

test("near-200KB compact documents round trip despite PostgreSQL JSON representation whitespace", async () => {
  const paragraphs: PostDocumentNode[] = Array.from({ length: 100 }, () => ({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "x",
        marks: [
          {
            type: "link",
            attrs: { href: "https://example.com/" + "a".repeat(1800) },
          },
        ],
      },
    ],
  }));
  const document = doc(...paragraphs);
  const bytes = () => new TextEncoder().encode(JSON.stringify(document)).byteLength;
  let remaining = 204800 - 100 - bytes();
  for (const node of paragraphs) {
    if (node.type !== "paragraph") continue;
    const text = node.content?.[0];
    if (text?.type !== "text") continue;
    const link = text.marks?.[0];
    if (link?.type !== "link") continue;
    const count = Math.min(2048 - link.attrs.href.length, remaining);
    link.attrs.href += "a".repeat(count);
    remaining -= count;
    if (!remaining) break;
  }
  assert.equal(remaining, 0);
  assert.ok(bytes() < 204800);
  const parsed = postDocumentSchema.parse(document);
  const post = await service.createPost(owner, { ...input, bodyDocument: parsed });
  assert.deepEqual(post.bodyDocument, parsed);
  const size = await pg.query<{ bytes: number }>(
    "select octet_length(body_document::text) as bytes from sliper.posts where id=$1",
    [post.id],
  );
  assert.ok(size.rows[0]!.bytes > 204800);
  assert.ok(size.rows[0]!.bytes < 262144);
});

test("soft deleting a rich post clears both Markdown and JSON in the database", async () => {
  const id = await asset(owner);
  const post = await service.createPost(owner, {
    ...input,
    bodyDocument: doc(paragraph("삭제될 내용"), image(id)),
    imageAssetIds: [id],
  });
  await service.deletePost(owner, post.id);
  const row = (await db.select().from(schema.posts).where(eq(schema.posts.id, post.id)))[0]!;
  assert.equal(row.status, "deleted");
  assert.equal(row.bodyMarkdown, "");
  assert.equal(row.bodyDocument, null);
});

test("the database rejects document objects with missing required shape fields", async () => {
  const post = await service.createPost(owner, input);
  await assert.rejects(
    db
      .update(schema.posts)
      .set({ bodyDocument: {} as PostDocument })
      .where(eq(schema.posts.id, post.id)),
  );
  const row = (await db.select().from(schema.posts).where(eq(schema.posts.id, post.id)))[0]!;
  assert.equal(row.bodyDocument, null);
});
