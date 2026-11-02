import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  restoreLegacyContent,
  type LegacyContent,
  type RestoreQuery,
  type LegacyRow,
} from "../scripts/lib/legacy-content-restore";
import { communityService } from "../src/server/community-service";
import type { Database } from "../src/db/connection";
const pg = new PGlite();
const db = drizzle(pg);
let owner: string;
const query: RestoreQuery = async (sql, parameters) =>
  (await pg.query<LegacyRow>(sql, parameters)).rows;
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pg.exec("insert into sliper.categories values('party','파티',8)");
});
after(() => pg.close());
beforeEach(async () => {
  await pg.exec("truncate sliper.posts cascade;truncate auth.users cascade");
  owner = randomUUID();
  await pg.query("insert into auth.users values($1)", [owner]);
  await pg.query("insert into sliper.profiles(id,nickname) values($1,'현재 회원')", [owner]);
});
async function fixture(): Promise<LegacyContent> {
  const ids = [randomUUID(), randomUUID()],
    root = randomUUID(),
    reply = randomUUID();
  for (let i = 0; i < 2; i++)
    await pg.query(
      "insert into sliper.posts(id,author_id,category_slug,title,kind,body_markdown,sample,is_anonymous,created_at) values($1,$2,'party','이전 글','모집','보존할 본문',$3,$3,'2026-10-01T00:00:00.123456Z')",
      [ids[i], owner, i === 1],
    );
  await pg.query(
    "insert into sliper.comments(id,post_id,author_id,body_markdown) values($1,$2,$3,'부모 댓글')",
    [root, ids[0], owner],
  );
  await pg.query(
    "insert into sliper.comments(id,post_id,parent_id,author_id,body_markdown) values($1,$2,$3,$4,'답글')",
    [reply, ids[0], root, owner],
  );
  await pg.query(
    "insert into sliper.event_settings(post_id,amount_krw,capacity,open) values($1,0,10,false)",
    [ids[0]],
  );
  const asset = randomUUID();
  await pg.query(
    "insert into sliper.media_assets(id,uploader_id,post_id,object_key,storage_backend,content_type,byte_size,status) values($1,$2,$3,$4,'supabase','image/png',10,'ready')",
    [asset, owner, ids[0], asset + ".png"],
  );
  const rows = async (table: string) =>
    (await query(`select to_jsonb(t) as row from sliper.${table} t`)).map(
      (result) => result.row as LegacyRow,
    );
  const payload = {
    posts: await rows("posts"),
    comments: await rows("comments"),
    media: await rows("media_assets"),
    settings: await rows("event_settings"),
  };
  for (const row of [...payload.posts, ...payload.comments]) {
    row.author_id = null;
    row.imported_author_name = row.is_anonymous ? null : "이전 작성자";
  }
  for (const row of payload.media) row.uploader_id = null;
  await pg.exec("delete from sliper.posts");
  return payload;
}
async function transaction(payload: LegacyContent) {
  await pg.exec("begin");
  try {
    const result = await restoreLegacyContent(query, payload, owner);
    await pg.exec("commit");
    return result;
  } catch (error) {
    await pg.exec("rollback");
    throw error;
  }
}
test("historical restore preserves posts, anonymous attribution, threaded comments and private media without creating accounts", async () => {
  const payload = await fixture(),
    result = await transaction(payload);
  assert.deepEqual(result, { alreadyRestored: false, posts: 2, comments: 2, media: 1 });
  const [counts] = await query(
    "select (select count(*)::int from auth.users) users,(select count(*)::int from sliper.profiles) profiles,(select count(*)::int from sliper.notifications) notifications",
  );
  assert.deepEqual(counts, { users: 1, profiles: 1, notifications: 0 });
  const service = communityService(db as unknown as Database);
  const detail = await service.detail(payload.posts[0]!.id as string, owner);
  assert.equal(detail.post.isMine, false);
  assert.equal(detail.post.author, "이전 작성자 · 이전 작성자");
  assert.equal(detail.post.images.length, 1);
  assert.equal(detail.comments[0]?.isMine, false);
  const anonymous = await service.detail(payload.posts[1]!.id as string, owner);
  assert.equal(anonymous.post.author, "익명");
  assert.equal(anonymous.post.sample, true);
  assert.equal(anonymous.post.createdAt, "2026-10-01T00:00:00.123456Z");
  const [media] = await query("select uploader_id,storage_backend from sliper.media_assets");
  assert.deepEqual(media, { uploader_id: null, storage_backend: "supabase" });
});
test("an exact repeated restore is read-only and does not duplicate comments or change revisions", async () => {
  const payload = await fixture();
  await transaction(payload);
  const before = await query("select to_jsonb(p) as row from sliper.posts p order by id");
  assert.equal((await transaction(payload)).alreadyRestored, true);
  assert.deepEqual(
    await query("select to_jsonb(p) as row from sliper.posts p order by id"),
    before,
  );
});
test("partial collisions and changed existing content abort instead of overwriting", async () => {
  const payload = await fixture();
  await transaction(payload);
  await assert.rejects(
    transaction({
      ...payload,
      posts: [...payload.posts, { ...payload.posts[0], id: randomUUID() }],
    }),
    /Partial restore collision/,
  );
  const altered = structuredClone(payload);
  altered.posts[0]!.body_markdown = "수정된 본문";
  await assert.rejects(transaction(altered), /no overwrite/);
  assert.equal((await query("select count(*)::int total from sliper.posts"))[0]!.total, 2);
});
test("missing reply parents roll back every inserted post and comment", async () => {
  const payload = await fixture();
  payload.comments = payload.comments.filter((row) => row.parent_id !== null);
  await assert.rejects(transaction(payload), /Missing parent/);
  assert.equal((await query("select count(*)::int total from sliper.posts"))[0]!.total, 0);
});
test("record-restricted files and reopened historical events are rejected before insertion", async () => {
  const payload = await fixture();
  payload.media[0]!.record_origin_post_id = randomUUID();
  await assert.rejects(transaction(payload), /Record-restricted/);
  payload.media[0]!.record_origin_post_id = null;
  payload.settings[0]!.open = true;
  await assert.rejects(transaction(payload), /remain closed/);
});
test("attribution constraints preserve signed-in creation guards and reject anonymous name disclosure", async () => {
  const payload = await fixture();
  await transaction(payload);
  await assert.rejects(
    pg.query("update sliper.posts set is_anonymous=true where imported_author_name is not null"),
  );
  await assert.rejects(
    pg.query(
      "insert into sliper.posts(category_slug,title,body_markdown,imported_author_name) values('party','무단 글','본문','이전 작성자')",
    ),
  );
  await assert.rejects(
    pg.query(
      "insert into sliper.posts(author_id,category_slug,title,body_markdown,imported_author_name) values($1,'party','무단 이름','본문','기존 이름')",
      [owner],
    ),
  );
});

test("repeat checks compare timezone-equivalent timestamps without losing microseconds", async () => {
  const payload = await fixture();
  payload.posts[0]!.created_at = "2026-10-01T09:00:00.123456+09:00";
  await transaction(payload);
  assert.equal((await transaction(payload)).alreadyRestored, true);
  payload.posts[0]!.created_at = "2026-10-01T09:00:00.123457+09:00";
  await assert.rejects(transaction(payload), /no overwrite/);
});
