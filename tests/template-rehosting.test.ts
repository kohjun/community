import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import { eventRecordLinks } from "../src/db/records-schema";
import { libraryEntries } from "../src/db/library-schema";
import { memberBlocks, contentRestrictions, memberSafety } from "../src/db/safety-schema";
import { CATEGORIES } from "../src/domain/categories";
import type { Database } from "../src/db/connection";
import { libraryService } from "../src/server/library-service";
import { templateRehostingOrigin } from "../src/server/template-rehosting";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
let owner: string, reader: string, postId: string, entryId: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname });
  return id;
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
  owner = await member("원래 주최자");
  reader = await member("다음 호스트");
  postId = randomUUID();
  entryId = randomUUID();
  await db.insert(libraryEntries).values({
    id: entryId,
    ownerId: owner,
    kind: "template",
    categorySlug: "party",
    title: "현재 발행된 진행 자료",
    summary: "다음 행사를 위한 진행 자료의 공개 소개입니다.",
    scenario: "PRIVATE-GUIDE 운영 시나리오는 자료 권한으로 보호됩니다.",
    rules: "게임의 규칙을 지켜주세요.",
    hostGuide: "시작과 종료 순서를 설명해주세요.",
    minPlayers: 2,
    maxPlayers: 10,
    durationMinutes: 60,
    priceKRW: 0,
    materials: [],
    rounds: [{ name: "미션", seconds: 300 }],
    tags: [],
  });
  await db.insert(base.posts).values({
    id: postId,
    authorId: owner,
    kind: "모집",
    categorySlug: "party",
    title: "수정된 모집글 제목",
    bodyMarkdown: "PRIVATE-POST 원래 글의 본문입니다.",
  });
  const ended = new Date("2026-01-01T08:00:00Z");
  await db.insert(base.eventSettings).values({
    postId,
    amountKRW: 0,
    capacity: 10,
    startsAt: new Date("2026-01-01T06:00:00Z"),
    endsAt: ended,
    completedAt: ended,
    completedBy: owner,
  });
  await db.insert(base.eventRecords).values({
    postId,
    ownerId: owner,
    status: "published",
    completedAt: ended,
    purpose: "PRIVATE-RECAP 이전 행사의 비공개 자료를 복사하지 않습니다.",
    bodyMarkdown: "PRIVATE-MEDIA 관련 사진과 영상은 원래 기록에 남아있습니다.",
    snapshot: {
      title: "당시 완료한 행사",
      category: "party",
      location: "서울 행사 공간",
      startsAt: "2026-01-01T06:00:00Z",
      endsAt: ended.toISOString(),
      hostPublicId: null,
      hostNickname: "원래 주최자",
      template: { id: entryId, title: "v1 자료", versionNumber: 1 },
    },
  });
  await db.insert(eventRecordLinks).values({ recordPostId: postId, libraryEntryId: entryId });
});
after(() => pg.close());
const origin = async (actor: string | null = reader) =>
  templateRehostingOrigin(
    connection,
    actor,
    await libraryService(connection).detail(reader, entryId),
    postId,
  );
test("rehosting preserves the frozen event summary and returns no old dates, guide, participants or media", async () => {
  const value = await origin();
  assert.deepEqual(value, {
    postId,
    title: "당시 완료한 행사",
    location: "서울 행사 공간",
    completedAt: "2026-01-01T08:00:00.000Z",
    previousTemplateVersion: 1,
  });
  assert.equal(JSON.stringify(value).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(value).includes(owner), false);
});
test("source records retain current member, draft, bidirectional block and moderation checks", async () => {
  await assert.rejects(origin(null), code("UNAUTHENTICATED"));
  await db
    .update(base.eventRecords)
    .set({ status: "draft" })
    .where(eq(base.eventRecords.postId, postId));
  await assert.rejects(origin(), code("NOT_FOUND"));
  assert.equal((await origin(owner)).postId, postId);
  await db
    .update(base.eventRecords)
    .set({ status: "published" })
    .where(eq(base.eventRecords.postId, postId));
  await db
    .insert(memberBlocks)
    .values({ blockerId: owner, blockedId: reader, displayLabel: "다음 호스트" });
  await assert.rejects(origin(), code("NOT_FOUND"));
  await db.delete(memberBlocks);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "record", targetId: postId, hidden: true, reason: "테스트 숨김" });
  await assert.rejects(origin(), code("NOT_FOUND"));
  await db.delete(contentRestrictions);
  await db.insert(memberSafety).values({ userId: reader, status: "closed" });
  await assert.rejects(origin(), code("FORBIDDEN"));
});
test("unrelated records cannot spoof source and recap-derived drafts keep only their own legitimate origin", async () => {
  await db.delete(eventRecordLinks).where(eq(eventRecordLinks.recordPostId, postId));
  await assert.rejects(origin(), code("NOT_FOUND"));
  const [original] = await db.select().from(libraryEntries).where(eq(libraryEntries.id, entryId));
  const derivedId = randomUUID();
  await db
    .insert(libraryEntries)
    .values({ ...original!, id: derivedId, sourceRecordPostId: postId });
  const derived = await libraryService(connection).detail(reader, derivedId);
  assert.equal(
    (await templateRehostingOrigin(connection, reader, derived, postId)).previousTemplateVersion,
    null,
  );
});
test("a visible record grants no current paid material rights to the next host", async () => {
  await db
    .update(libraryEntries)
    .set({ priceKRW: 12000, purchaseUrl: "https://example.invalid/purchase" })
    .where(eq(libraryEntries.id, entryId));
  const template = await libraryService(connection).detail(reader, entryId);
  assert.equal(template.canHost, false);
  await assert.rejects(
    templateRehostingOrigin(connection, reader, template, postId),
    code("FORBIDDEN"),
  );
});
