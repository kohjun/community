import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { CATEGORIES } from "../src/domain/categories";
import { communityService } from "../src/server/community-service";
import { assertContentAllowed, contentPolicyFields } from "../src/server/content-policy";
import { AppError } from "../src/server/errors";
import type { Database } from "../src/db/connection";
const pg = new PGlite(),
  db = drizzle(pg),
  service = communityService(db as unknown as Database);
let owner: string, reader: string;
const rejected = (error: unknown) =>
  error instanceof AppError && error.code === "VALIDATION" && /표현.*수정/.test(error.message);
const input = (extra: Record<string, unknown> = {}) => ({
  categorySlug: "party",
  title: "주말 모임 이야기",
  bodyMarkdown: "안전하게 함께 즐겨요.",
  ...extra,
});
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pg.query(
    "insert into sliper.categories select * from jsonb_populate_recordset(null::sliper.categories,$1::jsonb)",
    [
      JSON.stringify(
        CATEGORIES.map((c) => ({ slug: c.slug, name: c.name, sort_order: c.sortOrder })),
      ),
    ],
  );
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  owner = randomUUID();
  reader = randomUUID();
  for (const id of [owner, reader]) {
    await pg.query("insert into auth.users values($1)", [id]);
    await pg.query("insert into sliper.profiles(id,nickname) values($1,'검증 회원')", [id]);
  }
});
after(() => pg.close());

test("server extractor preserves displayed text across styles and omits identities and URLs", () => {
  const fields = contentPolicyFields({
    format: "씨발",
    postId: "씨발",
    applicationUrl: "https://example.com/씨발",
    bodyDocument: {
      version: 1,
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "씨",
              marks: [{ type: "link", attrs: { href: "https://example.com/" } }],
            },
            { type: "text", text: "발", marks: [{ type: "bold" }] },
          ],
        },
      ],
    },
  });
  assert.equal(
    fields.some((field) => field.text === "씨발\n"),
    true,
  );
  assert.equal(fields.length, 2);
  assert.throws(() => assertContentAllowed({ format: "씨발" }), rejected);
  assert.doesNotThrow(() =>
    assertContentAllowed({
      postId: "씨발",
      url: "https://example.com/씨발",
      expectedUpdatedAt: "씨발",
    }),
  );
});
test("rich text image captions and legacy markdown are covered without joining separate paragraphs", () => {
  const doc = (content: unknown[]) => ({ bodyDocument: { version: 1, type: "doc", content } });
  assert.throws(
    () =>
      assertContentAllowed(doc([{ type: "image", attrs: { assetId: randomUUID(), alt: "씨발" } }])),
    rejected,
  );
  assert.throws(
    () => assertContentAllowed(doc([{ type: "legacyMarkdown", attrs: { markdown: "개새끼" } }])),
    rejected,
  );
  assert.doesNotThrow(() =>
    assertContentAllowed(
      doc([
        { type: "paragraph", content: [{ type: "text", text: "씨" }] },
        { type: "paragraph", content: [{ type: "text", text: "발표합니다" }] },
      ]),
    ),
  );
});
test("helper fails with bounded validation for recursive or oversized payloads", () => {
  const recursive: Record<string, unknown> = {};
  recursive.child = recursive;
  assert.throws(
    () => assertContentAllowed(recursive),
    (error) => error instanceof AppError && error.code === "VALIDATION",
  );
  assert.throws(
    () => assertContentAllowed({ body: "a".repeat(1_000_001) }),
    (error) => error instanceof AppError && error.code === "VALIDATION",
  );
});
test("rejected creation cannot attach media, award activity, or persist a post", async () => {
  const image = randomUUID();
  await pg.query(
    "insert into sliper.media_assets(id,uploader_id,object_key,content_type,byte_size,status) values($1,$2,$3,'image/webp',10,'ready')",
    [image, owner, image + ".webp"],
  );
  await assert.rejects(
    service.createPost(owner, input({ title: "씨발", imageAssetIds: [image] })),
    rejected,
  );
  const [state] = (
    await pg.query<{ posts: number; activities: number; post_id: string | null }>(
      "select (select count(*)::int from sliper.posts) posts,(select count(*)::int from sliper.activity_events) activities,post_id from sliper.media_assets",
    )
  ).rows;
  assert.deepEqual(state, { posts: 0, activities: 0, post_id: null });
});
test("title tags poll and formatted text cannot bypass the same server check", async () => {
  for (const extra of [
    { tags: ["씨발"] },
    { kind: "투표", poll: { question: "무엇을 할까요?", options: ["보드게임", "개새끼"] } },
    { spoiler: true, spoilerTitle: "씨발", bodyMarkdown: "정상적인 본문입니다" },
    {
      bodyDocument: {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "씨" },
              { type: "text", text: "발", marks: [{ type: "bold" }] },
            ],
          },
        ],
      },
    },
  ])
    await assert.rejects(service.createPost(owner, input(extra)), rejected);
  assert.equal((await service.feed(null, { page: 1 })).pagination?.totalItems, 0);
});
test("rejected edits preserve the existing published revision and reactions", async () => {
  const post = await service.createPost(owner, input());
  await service.react(reader, post.id, "like", true);
  await assert.rejects(
    service.updatePost(owner, {
      ...input({ title: "씨발" }),
      postId: post.id,
      expectedUpdatedAt: post.updatedAt,
    }),
    rejected,
  );
  const current = await service.getPost(post.id, owner);
  assert.equal(current.title, post.title);
  assert.equal(current.updatedAt, post.updatedAt);
  assert.equal(current.likes, 1);
  await service.deletePost(owner, post.id);
});
test("blocked comments emit no notification and edits preserve original comment", async () => {
  const post = await service.createPost(owner, input());
  await assert.rejects(
    service.createComment(reader, { postId: post.id, bodyMarkdown: "씨발" }),
    rejected,
  );
  assert.equal(
    (await pg.query<{ total: number }>("select count(*)::int total from sliper.notifications"))
      .rows[0]!.total,
    0,
  );
  const added = await service.createComment(reader, {
    postId: post.id,
    bodyMarkdown: "다음에 함께해요.",
  });
  await assert.rejects(
    service.changeComment(reader, { commentId: added.comment.id, bodyMarkdown: "씨발" }),
    rejected,
  );
  assert.equal((await service.detail(post.id, owner)).comments[0]?.body, "다음에 함께해요.");
  await service.changeComment(reader, added.comment.id, true);
});
test("normal event sex-ratio, dating, criticism and educational text are accepted", async () => {
  const post = await service.createPost(
    owner,
    input({
      title: "성비 균형을 맞춘 소개팅",
      bodyMarkdown:
        "여성·남성 모두 환영해요. 도시 발전과 문화 공간을 이야기하고 프로그램 연출을 비판해요. 성교육 자료는 운영자에게 문의해주세요.",
    }),
  );
  assert.ok(post.id);
  await assert.rejects(
    service.createPost(null, input({ title: "씨발" })),
    (error) => error instanceof AppError && error.code === "UNAUTHENTICATED",
  );
});

test("Markdown-rendered text cannot hide abuse behind links, entities or emphasis", () => {
  for (const bodyMarkdown of ["씨[발](https://example.com)", "씨&#48156;", "씨**발**"]) {
    assert.throws(() => assertContentAllowed({ bodyMarkdown }), rejected);
    assert.throws(
      () =>
        assertContentAllowed({
          bodyDocument: {
            version: 1,
            type: "doc",
            content: [{ type: "legacyMarkdown", attrs: { markdown: bodyMarkdown } }],
          },
        }),
      rejected,
    );
  }
  assert.doesNotThrow(() =>
    assertContentAllowed({ bodyMarkdown: "[진행 영상](https://example.com/fuck.mp4)" }),
  );
  assert.throws(() => assertContentAllowed({ title: "<씨발>" }), rejected);
});
test("rich content ignores derived video URL text and still checks real visible text", () => {
  assert.doesNotThrow(() =>
    assertContentAllowed({
      bodyMarkdown: "영상: https://example.com/fuck.mp4",
      bodyDocument: {
        version: 1,
        type: "doc",
        content: [{ type: "video", attrs: { url: "https://example.com/fuck.mp4" } }],
      },
    }),
  );
  assert.throws(
    () =>
      assertContentAllowed({
        bodyMarkdown: "정상 내용",
        bodyDocument: {
          version: 1,
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "씨발" }] }],
        },
      }),
    rejected,
  );
});
