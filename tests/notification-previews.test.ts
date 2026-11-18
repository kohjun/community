import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/connection";
import {
  categories,
  profiles,
  posts,
  comments,
  roomMessages,
  eventApplications,
  eventSettings,
  externalReceipts,
} from "../src/db/schema";
import { eventChanges } from "../src/db/event-lifecycle-schema";
import { CATEGORIES } from "../src/domain/categories";
import { notificationPreviews } from "../src/server/notification-previews";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
let owner: string, member: string, postId: string;
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(categories).values([...CATEGORIES]);
  owner = randomUUID();
  member = randomUUID();
  await pg.query("insert into auth.users values($1),($2)", [owner, member]);
  await db.insert(profiles).values([
    { id: owner, nickname: "주최자" },
    { id: member, nickname: "참가자" },
  ]);
  const [post] = await db
    .insert(posts)
    .values({
      authorId: owner,
      categorySlug: "party",
      kind: "모집",
      title: "주말 추리 모임",
      bodyMarkdown: "함께해요",
    })
    .returning();
  postId = post!.id;
  await db.insert(eventSettings).values({ postId, capacity: 10, amountKRW: 0 });
});
after(() => pg.close());
const item = (kind: string, sourceId: string, dedupeKey: string) => ({
  id: randomUUID(),
  recipientId: member,
  kind,
  postId,
  sourceId,
  dedupeKey,
  title: "이전 제목",
  body: "이전 본문",
});
test("anonymous reply previews never reveal the author's nickname and use current edited text", async () => {
  const [parent] = await db
    .insert(comments)
    .values({ postId, authorId: member, bodyMarkdown: "어디서 만나요?" })
    .returning();
  const [reply] = await db
    .insert(comments)
    .values({
      postId,
      parentId: parent!.id,
      authorId: owner,
      isAnonymous: true,
      bodyMarkdown: "**입구**에서 만나요!",
    })
    .returning();
  const entry = item("comment", reply!.id, "comment:" + reply!.id);
  let preview = (await notificationPreviews(connection, [entry])).get(entry.id)!;
  assert.equal(preview.title, "익명님이 내 댓글에 답글을 남겼어요");
  assert.equal(preview.body, "주말 추리 모임 · 입구에서 만나요!");
  assert.ok(!preview.title.includes("주최자"));
  await db
    .update(comments)
    .set({ bodyMarkdown: "1번 출구에서 만나요" })
    .where(eq(comments.id, reply!.id));
  preview = (await notificationPreviews(connection, [entry])).get(entry.id)!;
  assert.ok(preview.body.includes("1번 출구"));
  await db
    .update(posts)
    .set({ kind: "이야기", spoiler: true, spoilerTitle: "스포일러 주의" })
    .where(eq(posts.id, postId));
  preview = (await notificationPreviews(connection, [entry])).get(entry.id)!;
  assert.equal(preview.body, "글을 펼쳐 내용을 확인해주세요.");
  assert.ok(!preview.body.includes("출구"));
  await db.update(posts).set({ kind: "모집", spoiler: false }).where(eq(posts.id, postId));
});
test("announcement, approval wait, confirmation and cancellation have specific context and next steps", async () => {
  const [message] = await db
    .insert(roomMessages)
    .values({ postId, authorId: owner, body: "**준비물**은 편한 신발이에요." })
    .returning();
  const notice = item("announcement", message!.id, "room:" + message!.id);
  await db
    .update(posts)
    .set({ applicationUrl: "https://example.com/fixture" })
    .where(eq(posts.id, postId));
  const [application] = await db
    .insert(eventApplications)
    .values({
      postId,
      userId: member,
      attendeeName: "참가자",
      contact: "fixture-contact",
      amountKRW: 0,
      source: "external",
      externalReference: "fixture-purchase",
      status: "pending_approval",
      expiresAt: null,
    })
    .returning();
  const waiting = item(
    "participation",
    application!.id,
    "application:" + application!.id + ":pending_approval",
  );
  let previews = await notificationPreviews(connection, [notice, waiting]);
  assert.equal(previews.get(notice.id)!.title, "모임 공지 · 주말 추리 모임");
  assert.ok(previews.get(notice.id)!.body.includes("편한 신발"));
  assert.equal(previews.get(waiting.id)!.title, "참가 신청이 접수됐어요");
  await db.insert(externalReceipts).values({
    applicationId: application!.id,
    postId,
    reference: "fixture-purchase",
    amountKRW: 0,
    provider: "fixture",
    verification: "manual",
    verifiedBy: owner,
  });
  await db
    .update(eventApplications)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(eq(eventApplications.id, application!.id));
  previews = await notificationPreviews(connection, [waiting]);
  assert.equal(previews.get(waiting.id)!.title, "모임 참가가 확정됐어요");
  const [change] = await db
    .insert(eventChanges)
    .values({
      postId,
      kind: "cancel",
      revision: 1,
      reason: "주최자 사정으로 행사를 취소합니다.",
      createdBy: owner,
    })
    .returning();
  const cancellation = item("participation", change!.id, "event-change:" + change!.id);
  previews = await notificationPreviews(connection, [cancellation]);
  assert.equal(previews.get(cancellation.id)!.title, "참가할 모임이 취소됐어요");
  assert.ok(previews.get(cancellation.id)!.body.includes("주최자 사정"));
});
