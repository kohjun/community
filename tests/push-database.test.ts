import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { categories } from "../src/db/schema";
import { CATEGORIES } from "../src/domain/categories";

const pg = new PGlite();
const db = drizzle(pg);
const sqlState = (expected: string) => (error: unknown) =>
  (error as { code?: string }).code === expected;

async function member(nickname = "참가자") {
  const id = randomUUID();
  await pg.query("insert into auth.users (id) values ($1)", [id]);
  await pg.query("insert into sliper.profiles (id,nickname) values ($1,$2)", [id, nickname]);
  return id;
}

async function subscription(userId: string, expired = false) {
  const id = randomUUID();
  // Shape-valid keys are fixtures only; these tests never contact push providers.
  await pg.query(
    `insert into sliper.push_subscriptions
      (id,user_id,endpoint,p256dh,auth,vapid_public_key,expiration_time)
     values ($1,$2,$3,$4,$5,$6,case when $7 then now()-interval '1 minute' else null end)`,
    [
      id,
      userId,
      `https://web.push.apple.com/fixture/${id}`,
      "A".repeat(87),
      "A".repeat(22),
      "B".repeat(87),
      expired,
    ],
  );
  return id;
}

async function delivery(
  subscriptionId: string,
  recipientId: string,
  dedupeKey: string = randomUUID(),
) {
  const { rows } = await pg.query<{ id: string }>(
    `insert into sliper.push_deliveries
      (subscription_id,recipient_id,dedupe_key,kind,title,body,url)
     values ($1,$2,$3,'test','테스트 알림','Sliper 알림을 확인해주세요.','/me') returning id`,
    [subscriptionId, recipientId, dedupeKey],
  );
  return rows[0]!.id;
}

async function event(ownerId: string) {
  const id = randomUUID();
  await pg.query(
    "insert into sliper.posts (id,author_id,category_slug,kind,title,body_markdown,event_fee) values ($1,$2,'party','모집','푸시 테스트 행사','함께 참가해요','무료')",
    [id, ownerId],
  );
  await pg.query(
    "insert into sliper.event_settings (post_id,amount_krw,capacity) values ($1,0,20)",
    [id],
  );
  return id;
}

async function apply(postId: string, userId: string, confirmed = true) {
  const id = randomUUID();
  await pg.query(
    `insert into sliper.event_applications
      (id,post_id,user_id,attendee_name,contact,amount_krw,status,expires_at,confirmed_at)
     values ($1,$2,$3,'참가자','010-0000-0000',0,$4,now()+interval '30 minutes',
       case when $5 then now() else null end)`,
    [id, postId, userId, confirmed ? "confirmed" : "pending_payment", confirmed],
  );
  return id;
}

before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(categories).values([...CATEGORIES]);
});
beforeEach(() => pg.exec("truncate auth.users cascade;"));
after(() => pg.close());

test("push migrations are repeatable and all push tables remain private with RLS", async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  const { rows } = await pg.query<{
    name: string;
    rls: boolean;
    anon_access: boolean;
    member_access: boolean;
  }>(
    `select tablename as name, rowsecurity as rls,
      has_table_privilege('anon', 'sliper.'||tablename, 'SELECT') as anon_access,
      has_table_privilege('authenticated', 'sliper.'||tablename, 'SELECT') as member_access
     from pg_tables where schemaname='sliper' and tablename like 'push_%' order by tablename`,
  );
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.rls, true, row.name);
    assert.equal(row.anon_access, false, row.name);
    assert.equal(row.member_access, false, row.name);
  }
});

test("subscription ownership and endpoint identity cannot be transferred", async () => {
  const owner = await member(),
    other = await member("다른회원");
  const id = await subscription(owner);
  await assert.rejects(
    pg.query("update sliper.push_subscriptions set user_id=$1 where id=$2", [other, id]),
    sqlState("23514"),
  );
  await assert.rejects(
    pg.query(
      "update sliper.push_subscriptions set endpoint='https://web.push.apple.com/changed' where id=$1",
      [id],
    ),
    sqlState("23514"),
  );
  await pg.query("update sliper.push_subscriptions set auth=$1,updated_at=now() where id=$2", [
    "C".repeat(22),
    id,
  ]);
  await assert.rejects(
    pg.query("update sliper.push_subscriptions set auth='malformed' where id=$1", [id]),
    sqlState("23514"),
  );
});

test("delivery ownership, per-device deduplication and unsubscribe cascade are enforced", async () => {
  const owner = await member(),
    other = await member("다른회원");
  const id = await subscription(owner);
  await assert.rejects(delivery(id, other), sqlState("23503"));
  await delivery(id, owner, "same-event");
  await assert.rejects(delivery(id, owner, "same-event"), sqlState("23505"));
  const otherDevice = await subscription(owner);
  await delivery(otherDevice, owner, "same-event");
  await pg.query("delete from sliper.push_subscriptions where id=$1", [id]);
  const { rows } = await pg.query<{ count: number }>(
    "select count(*)::int as count from sliper.push_deliveries",
  );
  assert.equal(rows[0]!.count, 1);
});

test("processing leases and terminal sent timestamps must remain consistent", async () => {
  const owner = await member(),
    sub = await subscription(owner),
    id = await delivery(sub, owner);
  await assert.rejects(
    pg.query("update sliper.push_deliveries set status='processing' where id=$1", [id]),
    sqlState("23514"),
  );
  await pg.query(
    "update sliper.push_deliveries set status='processing',locked_at=now(),lock_token=$1,attempts=1 where id=$2",
    [randomUUID(), id],
  );
  await assert.rejects(
    pg.query("update sliper.push_deliveries set status='sent',sent_at=now() where id=$1", [id]),
    sqlState("23514"),
  );
  await pg.query(
    "update sliper.push_deliveries set status='sent',sent_at=now(),locked_at=null,lock_token=null where id=$1",
    [id],
  );
  await assert.rejects(
    pg.query("update sliper.push_deliveries set attempts=-1 where id=$1", [id]),
    sqlState("23514"),
  );
});

test("confirmed applications enqueue one job per eligible device in the room-grant transaction", async () => {
  const owner = await member("주최자"),
    attendee = await member();
  await subscription(attendee);
  await subscription(attendee);
  await subscription(attendee, true);
  const postId = await event(owner),
    applicationId = await apply(postId, attendee);
  const { rows } = await pg.query<{ dedupe_key: string; kind: string; title: string; url: string }>(
    "select dedupe_key,kind,title,url from sliper.push_deliveries",
  );
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.dedupe_key, `application:${applicationId}:confirmed`);
    assert.equal(row.kind, "participation");
    assert.equal(row.title, "참가가 확정됐어요");
    assert.equal(row.url, `/rooms/${postId}`);
  }
  const members = await pg.query<{ revoked_at: string | null }>(
    "select revoked_at from sliper.room_members where user_id=$1 and post_id=$2",
    [attendee, postId],
  );
  assert.equal(members.rows.length, 1);
  assert.equal(members.rows[0]!.revoked_at, null);
  await pg.query("update sliper.event_applications set status=status where id=$1", [applicationId]);
  const count = await pg.query<{ count: number }>(
    "select count(*)::int as count from sliper.push_deliveries",
  );
  assert.equal(count.rows[0]!.count, 2);
});

test("participation opt-out prevents jobs without blocking the underlying application", async () => {
  const owner = await member("주최자"),
    attendee = await member();
  await subscription(attendee);
  await pg.query("insert into sliper.push_preferences(user_id,participation) values ($1,false)", [
    attendee,
  ]);
  const postId = await event(owner);
  await apply(postId, attendee);
  const { rows } = await pg.query<{ count: number }>(
    "select count(*)::int as count from sliper.push_deliveries",
  );
  assert.equal(rows[0]!.count, 0);
  const members = await pg.query<{ count: number }>(
    "select count(*)::int as count from sliper.room_members where revoked_at is null",
  );
  assert.equal(members.rows[0]!.count, 1);
});

test("approval and refund status transitions enqueue once and share room permission changes", async () => {
  const owner = await member("주최자"),
    attendee = await member();
  await subscription(attendee);
  const postId = await event(owner),
    applicationId = await apply(postId, attendee, false);
  await pg.query(
    "update sliper.event_applications set status='confirmed',confirmed_at=now() where id=$1",
    [applicationId],
  );
  await pg.query("update sliper.event_applications set status='refunded' where id=$1", [
    applicationId,
  ]);
  await pg.query("update sliper.event_applications set status=status where id=$1", [applicationId]);
  const { rows } = await pg.query<{ title: string; url: string }>(
    "select title,url from sliper.push_deliveries order by created_at,id",
  );
  assert.equal(rows.length, 2);
  assert.ok(
    rows.some((row) => row.title === "환불 처리가 완료됐어요" && row.url === `/events/${postId}`),
  );
  const members = await pg.query<{ revoked_at: string | null }>(
    "select revoked_at from sliper.room_members where user_id=$1 and post_id=$2",
    [attendee, postId],
  );
  assert.ok(members.rows[0]!.revoked_at);
});

test("rolling back an application also rolls back its room grant and push outbox rows", async () => {
  const owner = await member("주최자"),
    attendee = await member();
  await subscription(attendee);
  const postId = await event(owner);
  await pg.exec("begin;");
  await apply(postId, attendee);
  await pg.exec("rollback;");
  const { rows } = await pg.query<{ applications: number; members: number; deliveries: number }>(
    "select (select count(*)::int from sliper.event_applications) as applications,(select count(*)::int from sliper.room_members) as members,(select count(*)::int from sliper.push_deliveries) as deliveries",
  );
  assert.deepEqual(rows[0], { applications: 0, members: 0, deliveries: 0 });
});
