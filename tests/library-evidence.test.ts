import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import { libraryVersions, templateProvenance } from "../src/db/library-schema";
import { eventResults } from "../src/db/player-schema";
import { eventAdmissions, verifiedEventReviews } from "../src/db/event-operations-schema";
import { contentRestrictions, memberBlocks } from "../src/db/safety-schema";
import { CATEGORIES } from "../src/domain/categories";
import { libraryInputSchema, type LibraryDetail } from "../src/domain/library";
import type { Database } from "../src/db/connection";
import { libraryService } from "../src/server/library-service";
import { libraryEvidenceService } from "../src/server/library-evidence-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database,
  library = libraryService(connection),
  evidence = libraryEvidenceService(connection);
let host: string,
  reader: string,
  qr: string,
  manual: string,
  absent: string,
  entry: LibraryDetail,
  versionId: string;
const content = libraryInputSchema.parse({
  kind: "template",
  categorySlug: "mind-games",
  title: "버전별 운영 사례 템플릿",
  summary: "실제 완료 행사의 운영 사례와 참가 확인을 검증하는 자료입니다.",
  scenario: "PRIVATE-EDITION 참가자들이 역할 카드를 정하고 단서를 모아 협력하는 게임입니다.",
  rules: "각 참가자는 동일한 시간 동안 단서를 확인하고 공개 토론에 참여합니다.",
  hostGuide: "진행자는 모든 참가자가 참여하도록 순서를 정하고 시간을 안내합니다.",
  materials: ["역할 카드"],
  rounds: [{ name: "토론", seconds: 300 }],
  tags: [],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  priceKRW: 1000,
  purchaseUrl: "https://example.invalid/buy",
});
const code = (name: string) => (e: unknown) => e instanceof AppError && e.code === name;
async function member(name: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname: name });
  return id;
}
async function event(legacy = false, mismatch = false) {
  const id = randomUUID(),
    ended = new Date("2020-01-01T03:00:00Z");
  await db.insert(base.posts).values({
    id,
    authorId: host,
    kind: "모집",
    categorySlug: "mind-games",
    title: "현재 변경된 모집 제목",
    bodyMarkdown: "PRIVATE-EVENT-BODY",
    location: "현재 장소",
  });
  await db.insert(base.eventSettings).values({
    postId: id,
    amountKRW: 0,
    capacity: 20,
    open: true,
    startsAt: new Date("2020-01-01T01:00:00Z"),
    endsAt: ended,
    completedAt: ended,
    completedBy: host,
  });
  const creator = (await db.select().from(base.profiles).where(eq(base.profiles.id, host)))[0]!;
  await db.insert(templateProvenance).values({
    postId: id,
    entryId: entry.id,
    versionId: legacy ? null : versionId,
    snapshot: {
      ...content,
      category: content.categorySlug,
      author: creator.nickname,
      authorPublicId: creator.publicId,
      sourceId: entry.id,
      versionId: legacy ? null : versionId,
      versionNumber: legacy ? null : 1,
    },
  });
  await db.insert(base.eventRecords).values({
    postId: id,
    ownerId: host,
    status: "published",
    completedAt: ended,
    purpose: "완료 행사에서 실제 운영한 내용을 기록합니다.",
    execution: "PRIVATE-RECAP 실제 참가자 연락처와 내부 진행 기록입니다.",
    snapshot: {
      title: "당시 행사 제목",
      category: "mind-games",
      location: "당시 장소",
      startsAt: "2020-01-01T01:00:00Z",
      endsAt: ended.toISOString(),
      hostPublicId: creator.publicId,
      hostNickname: creator.nickname,
      template: {
        id: entry.id,
        title: content.title,
        ...(legacy ? {} : { versionId, versionNumber: mismatch ? 2 : 1 }),
      },
    },
  });
  return id;
}
async function attendance(
  postId: string,
  user: string,
  checked: boolean,
  presence: "attended" | "no_show" = "attended",
) {
  const [app] = await db
    .insert(base.eventApplications)
    .values({
      postId,
      userId: user,
      attendeeName: "PRIVATE-REAL-NAME",
      contact: "PRIVATE-PHONE",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
      expiresAt: new Date("2020-01-01T05:00:00Z"),
    })
    .returning();
  if (checked)
    await db.insert(eventAdmissions).values({
      applicationId: app!.id,
      postId,
      userId: user,
      checkedBy: host,
      checkedAt: new Date("2020-01-01T02:00:00Z"),
    });
  await db
    .insert(eventResults)
    .values({ applicationId: app!.id, postId, userId: user, recorderId: host, presence });
  return app!.id;
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  host = await member("자료 주최자");
  reader = await member("탐색 회원");
  qr = await member("QR 참가자");
  manual = await member("담당자 확인 참가자");
  absent = await member("미참석");
  entry = await library.create(host, content);
  versionId = (await db.select().from(libraryVersions))[0]!.id;
});
after(() => pg.close());
test("operating evidence uses frozen exact versions and distinguishes QR/manual attendance, ratings and financial refunds", async () => {
  const id = await event(),
    first = await attendance(id, qr, true);
  await attendance(id, manual, false);
  await attendance(id, absent, false, "no_show");
  const [review] = await db
    .insert(base.posts)
    .values({
      authorId: qr,
      kind: "후기",
      categorySlug: "mind-games",
      title: "인증 후기",
      bodyMarkdown: "PRIVATE-REVIEW-BODY",
    })
    .returning();
  await db.insert(verifiedEventReviews).values({
    reviewPostId: review!.id,
    eventPostId: id,
    applicationId: first,
    userId: qr,
    hostId: host,
    eventTitle: "당시 행사 제목",
    rating: 5,
    templateEntryId: entry.id,
  });
  await db
    .update(base.eventApplications)
    .set({ status: "refunded" })
    .where(eq(base.eventApplications.id, first));
  const page = await evidence.list(reader, entry.id),
    item = page.items[0]!;
  assert.equal(item.title, "당시 행사 제목");
  assert.equal(item.location, "당시 장소");
  assert.equal(item.versionNumber, 1);
  assert.equal(item.attended, 2);
  assert.equal(item.qrAttended, 1);
  assert.equal(item.managerAttended, 1);
  assert.equal(item.averageRating, 5);
  assert.equal(item.reviewCount, 1);
  for (const secret of ["PRIVATE-", qr, manual, host])
    assert.equal(JSON.stringify(page).includes(secret), false);
  assert.equal((await library.detail(reader, entry.id)).payload, null);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: review!.id, reason: "후기 숨김" });
  assert.equal((await evidence.list(reader, entry.id)).items[0]!.reviewCount, 0);
});
test("guests, hidden sources and blocked owners cannot use the evidence discovery endpoint", async () => {
  await event();
  await assert.rejects(evidence.list(null, entry.id), code("UNAUTHENTICATED"));
  await db
    .insert(memberBlocks)
    .values({ blockerId: reader, blockedId: host, displayLabel: "차단" });
  await assert.rejects(evidence.list(reader, entry.id), code("NOT_FOUND"));
  await db.delete(memberBlocks);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "library", targetId: entry.id, reason: "자료 숨김" });
  await assert.rejects(evidence.list(reader, entry.id), code("NOT_FOUND"));
});
test("only published completed records contribute; hidden/sample records and mismatched frozen editions are excluded", async () => {
  const visible = await event();
  await event(false, true);
  assert.equal((await evidence.list(reader, entry.id)).total, 1);
  await db.update(base.posts).set({ sample: true }).where(eq(base.posts.id, visible));
  assert.equal((await evidence.list(reader, entry.id)).total, 0);
  await db.update(base.posts).set({ sample: false }).where(eq(base.posts.id, visible));
  await db
    .insert(contentRestrictions)
    .values({ targetType: "record", targetId: visible, reason: "회고 숨김" });
  assert.equal((await evidence.list(reader, entry.id)).total, 0);
  await db.delete(contentRestrictions);
  await db
    .update(base.eventRecords)
    .set({ status: "withdrawn" })
    .where(eq(base.eventRecords.postId, visible));
  assert.equal((await evidence.list(reader, entry.id)).total, 0);
});
test("operating cases page at 20 and legacy editions are labelled without guessing a released version", async () => {
  for (let i = 0; i < 21; i++) await event();
  await event(true);
  const first = await evidence.list(reader, entry.id),
    next = await evidence.list(reader, entry.id, { page: 2 });
  assert.equal(first.total, 22);
  assert.equal(first.items.length, 20);
  assert.equal(next.items.length, 2);
  assert.equal(first.legacyCount, 1);
  assert.equal(first.versions[0]!.caseCount, 21);
  assert.equal(new Set([...first.items, ...next.items].map((p) => p.postId)).size, 22);
  const filtered = await evidence.list(reader, entry.id, { version: 1 });
  assert.equal(filtered.total, 21);
  assert.ok(filtered.items.every((p) => p.versionNumber === 1));
  await assert.rejects(evidence.list(reader, entry.id, { unknown: true }));
});
