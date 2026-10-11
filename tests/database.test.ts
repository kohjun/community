import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { categories } from "../src/db/schema";
import { CATEGORIES } from "../src/domain/categories";

// Real PostgreSQL semantics in an ephemeral WASM database; no Supabase credentials.
const pg = new PGlite();
const db = drizzle(pg);

async function member(nickname = "슬리퍼") {
  const id = randomUUID();
  await pg.query("insert into auth.users (id) values ($1)", [id]);
  await pg.query("insert into sliper.profiles (id, nickname) values ($1, $2)", [id, nickname]);
  return id;
}

async function post(authorId: string) {
  const id = randomUUID();
  await pg.query(
    "insert into sliper.posts (id, author_id, category_slug, title, body_markdown) values ($1,$2,'party','예능 파티','함께 놀아요')",
    [id, authorId],
  );
  return id;
}

async function comment(postId: string, authorId: string, parentId: string | null = null) {
  const id = randomUUID();
  await pg.query(
    "insert into sliper.comments (id, post_id, author_id, parent_id, body_markdown) values ($1,$2,$3,$4,'참가하고 싶어요')",
    [id, postId, authorId, parentId],
  );
  return id;
}

function sqlState(code: string) {
  return (error: unknown) => (error as { code?: string }).code === code;
}

async function seed() {
  await db
    .insert(categories)
    .values([...CATEGORIES])
    .onConflictDoUpdate({
      target: categories.slug,
      set: { name: sql`excluded.name`, sortOrder: sql`excluded.sort_order` },
    });
}

before(async () => {
  // Supabase owns these objects in production. Only the test fixture creates them.
  await pg.exec(
    "create schema auth; create table auth.users (id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed();
});

beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
});
after(async () => {
  await pg.close();
});

describe("PostgreSQL migrations and integrity", () => {
  it("migrations and category seed are repeatable without touching managed auth", async () => {
    await migrate(db, { migrationsFolder: "./drizzle" });
    await seed();
    const rows = await db.select().from(categories).orderBy(categories.sortOrder);
    assert.deepEqual(rows, CATEGORIES);
    await assert.rejects(
      pg.query("insert into sliper.categories values ('unknown','임의',9)"),
      sqlState("22P02"),
    );
  });

  it("requires a real auth identity and author when creating content", async () => {
    await assert.rejects(
      pg.query("insert into sliper.profiles (id, nickname) values ($1,'가짜회원')", [randomUUID()]),
      sqlState("23503"),
    );
    await assert.rejects(
      pg.query(
        "insert into sliper.posts (category_slug,title,body_markdown) values ('travel','여행','본문')",
      ),
      sqlState("23514"),
    );
  });

  it("accepts deep replies but rejects cross-post parents and moved edges", async () => {
    const author = await member();
    const first = await post(author);
    const second = await post(author);
    const root = await comment(first, author);
    let tail = root;
    for (let depth = 0; depth < 40; depth++) tail = await comment(first, author, tail);
    await assert.rejects(comment(second, author, root), sqlState("23503"));
    await assert.rejects(
      pg.query("update sliper.comments set parent_id=$1 where id=$2", [tail, root]),
      sqlState("23514"),
    );
    await assert.rejects(
      pg.query("update sliper.comments set post_id=$1 where id=$2", [second, tail]),
      sqlState("23514"),
    );
    const { rows } = await pg.query<{ count: number }>(
      "select count(*)::int as count from sliper.comments",
    );
    assert.equal(rows[0]?.count, 41);
  });

  it("rejects self cycles and multi-row cycles at insertion", async () => {
    const author = await member();
    const postId = await post(author);
    const a = randomUUID();
    const b = randomUUID();
    await assert.rejects(
      pg.query(
        "insert into sliper.comments (id,post_id,author_id,parent_id,body_markdown) values ($1,$2,$3,$1,'순환')",
        [a, postId, author],
      ),
      sqlState("23514"),
    );
    await assert.rejects(
      pg.query(
        "insert into sliper.comments (id,post_id,author_id,parent_id,body_markdown) values ($1,$3,$4,$2,'순환'),($2,$3,$4,$1,'순환')",
        [a, b, postId, author],
      ),
      sqlState("23503"),
    );
  });

  it("soft deletion scrubs text while preserving replies, and updates timestamps", async () => {
    const author = await member();
    const postId = await post(author);
    const root = await comment(postId, author);
    const reply = await comment(postId, author, root);
    await pg.query("update sliper.comments set status='deleted' where id=$1", [root]);
    const { rows } = await pg.query<{
      body_markdown: string;
      deleted_at: Date;
      updated_at: Date;
      created_at: Date;
    }>("select * from sliper.comments where id=$1", [root]);
    assert.equal(rows[0]?.body_markdown, "");
    assert.ok(rows[0]?.deleted_at);
    assert.ok(rows[0]!.updated_at >= rows[0]!.created_at);
    assert.equal(
      (await pg.query("select id from sliper.comments where id=$1", [reply])).rows.length,
      1,
    );
    await assert.rejects(
      pg.query(
        "update sliper.comments set status='published', deleted_at=null, body_markdown='복원' where id=$1",
        [root],
      ),
      sqlState("23514"),
    );
    await pg.query("update sliper.posts set status='deleted' where id=$1", [postId]);
    const deleted = await pg.query<{ title: string; body_markdown: string }>(
      "select title,body_markdown from sliper.posts where id=$1",
      [postId],
    );
    assert.deepEqual(deleted.rows[0], { title: "삭제된 게시글", body_markdown: "" });
  });

  it("deduplicates likes and bookmarks, including idempotent concurrent requests", async () => {
    const author = await member();
    const postId = await post(author);
    for (const table of ["post_likes", "bookmarks"]) {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          pg.query(
            `insert into sliper.${table} (post_id,user_id) values ($1,$2) on conflict do nothing returning post_id`,
            [postId, author],
          ),
        ),
      );
      assert.equal(
        results.reduce((count, result) => count + result.rows.length, 0),
        1,
      );
      await assert.rejects(
        pg.query(`insert into sliper.${table} (post_id,user_id) values ($1,$2)`, [postId, author]),
        sqlState("23505"),
      );
    }
  });

  it("stamps KST dates and counts a visitor only once even with a forged date", async () => {
    const author = await member();
    const first = await post(author);
    const second = await post(author);
    const hash = "a".repeat(64);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        pg.query<{ viewed_on: string }>(
          "insert into sliper.post_daily_views (post_id,visitor_hash,viewed_on) values ($1,$2,'2000-01-01') on conflict do nothing returning viewed_on::text",
          [first, hash],
        ),
      ),
    );
    assert.equal(
      results.reduce((count, result) => count + result.rows.length, 0),
      1,
    );
    const today = await pg.query<{ today: string }>(
      "select (statement_timestamp() at time zone 'Asia/Seoul')::date::text as today",
    );
    assert.equal(results.flatMap((result) => result.rows)[0]?.viewed_on, today.rows[0]?.today);
    await pg.query("insert into sliper.post_daily_views (post_id,visitor_hash) values ($1,$2)", [
      second,
      hash,
    ]);
    await assert.rejects(
      pg.query("update sliper.post_daily_views set viewed_on='2000-01-01' where post_id=$1", [
        first,
      ]),
      sqlState("23514"),
    );
  });

  it("rejects media from another member and enforces upload metadata limits", async () => {
    const author = await member();
    const other = await member("다른회원");
    const postId = await post(author);
    const assetId = randomUUID();
    const insert =
      "insert into sliper.media_assets (id,uploader_id,post_id,object_key,content_type,byte_size) values ($1,$2,$3,$4,'image/jpeg',$5)";
    await assert.rejects(
      pg.query(insert, [assetId, other, postId, `${assetId}.jpg`, 1024]),
      sqlState("23514"),
    );
    await assert.rejects(
      pg.query(insert, [assetId, author, postId, `${author}/${assetId}.jpg`, 1024]),
      (e: unknown) => ["23514", "22001"].includes((e as { code: string }).code),
    );
    await assert.rejects(
      pg.query(insert, [assetId, author, postId, `${assetId}.jpg`, 10485761]),
      sqlState("23514"),
    );
    await pg.query(insert, [assetId, author, postId, `${assetId}.jpg`, 1024]);
    const otherPost = await post(other);
    await assert.rejects(
      pg.query("update sliper.media_assets set uploader_id=null,post_id=$1 where id=$2", [
        otherPost,
        assetId,
      ]),
      sqlState("23514"),
    );
  });

  it("validates notification recipient/source and deduplicates overlapping events", async () => {
    const owner = await member();
    const replier = await member("답글회원");
    const outsider = await member("관계없는회원");
    const postId = await post(owner);
    const root = await comment(postId, owner);
    const reply = await comment(postId, replier, root);
    const insert =
      "insert into sliper.notifications (recipient_id,post_id,comment_id,kind) values ($1,$2,$3,$4)";
    await assert.rejects(
      pg.query(insert, [replier, postId, reply, "post_comment"]),
      sqlState("23514"),
    );
    await assert.rejects(
      pg.query(insert, [outsider, postId, reply, "comment_reply"]),
      sqlState("23514"),
    );
    await pg.query(insert, [owner, postId, reply, "comment_reply"]);
    await assert.rejects(
      pg.query(insert, [owner, postId, reply, "post_comment"]),
      sqlState("23505"),
    );
    await pg.query("update sliper.notifications set read_at=now() where recipient_id=$1", [owner]);
    await assert.rejects(
      pg.query("update sliper.notifications set recipient_id=$1", [outsider]),
      sqlState("23514"),
    );
  });

  it("retains conversations after account deletion and removes private account records", async () => {
    const author = await member();
    const postId = await post(author);
    const root = await comment(postId, author);
    const assetId = randomUUID();
    await pg.query(
      "insert into sliper.media_assets (id,uploader_id,post_id,object_key,content_type,byte_size) values ($1,$2,$3,$4,'image/png',128)",
      [assetId, author, postId, `${assetId}.png`],
    );
    await pg.query("insert into sliper.post_likes (post_id,user_id) values ($1,$2)", [
      postId,
      author,
    ]);
    await pg.query("delete from auth.users where id=$1", [author]);
    assert.equal((await pg.query("select * from sliper.profiles")).rows.length, 0);
    assert.equal((await pg.query("select * from sliper.post_likes")).rows.length, 0);
    assert.equal(
      (
        await pg.query<{ author_id: null }>("select author_id from sliper.posts where id=$1", [
          postId,
        ])
      ).rows[0]?.author_id,
      null,
    );
    assert.equal(
      (
        await pg.query<{ author_id: null }>("select author_id from sliper.comments where id=$1", [
          root,
        ])
      ).rows[0]?.author_id,
      null,
    );
    assert.deepEqual(
      (await pg.query("select uploader_id,post_id from sliper.media_assets where id=$1", [assetId]))
        .rows[0],
      { uploader_id: null, post_id: postId },
    );
  });

  it("denies raw schema access to public API roles and enables RLS on every table", async () => {
    const { rows } = await pg.query<{ count: number; total: number }>(
      "select count(*) filter (where rowsecurity)::int as count, count(*)::int as total from pg_tables where schemaname='sliper'",
    );
    assert.ok(rows[0] && rows[0].total > 0);
    assert.equal(rows[0].count, rows[0].total);
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      try {
        await assert.rejects(pg.query("select author_id from sliper.posts"), sqlState("42501"));
        await assert.rejects(
          pg.query("select recipient_id from sliper.notifications"),
          sqlState("42501"),
        );
      } finally {
        await pg.exec("reset role");
      }
    }
    // Defense in depth: accidental grants still do not create a permissive policy.
    await pg.exec("grant usage on schema sliper to anon; grant select on sliper.posts to anon;");
    const author = await member();
    await post(author);
    await pg.exec("set role anon");
    try {
      assert.equal((await pg.query("select * from sliper.posts")).rows.length, 0);
    } finally {
      await pg.exec(
        "reset role; revoke usage on schema sliper from anon; revoke select on sliper.posts from anon;",
      );
    }
  });
});
