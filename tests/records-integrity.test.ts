import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import * as records from "../src/db/records-schema";
import { eventResults } from "../src/db/player-schema";
import { videoAssets } from "../src/db/video-schema";
import { eventOperationsService } from "../src/server/event-operations-service";
import { communityService } from "../src/server/community-service";
import { attachRecordMedia } from "../src/server/record-media";
import type { Database } from "../src/db/connection";
import type { PostDocument } from "../src/domain/post-document";
import { CATEGORIES } from "../src/domain/categories";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
let owner: string, attendee: string, postId: string, applicationId: string;
let now = new Date();
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  now = new Date();
  owner = randomUUID();
  attendee = randomUUID();
  for (const [id, nickname] of [
    [owner, "기록 주최자"],
    [attendee, "확인 참가자"],
  ]) {
    await pg.query("insert into auth.users values($1)", [id]);
    await db.insert(base.profiles).values({ id: id!, nickname: nickname! });
  }
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      kind: "모집",
      categorySlug: "party",
      title: "보존되는 행사 기록",
      bodyMarkdown: "실제 완료와 변경 이력 검증 행사입니다.",
    })
    .returning();
  postId = post!.id;
  await db.insert(base.eventSettings).values({
    postId,
    capacity: 5,
    amountKRW: 0,
    startsAt: new Date(now.getTime() - 7200000),
    endsAt: new Date(now.getTime() - 3600000),
  });
  const [app] = await db
    .insert(base.eventApplications)
    .values({
      postId,
      userId: attendee,
      attendeeName: "확인 참가자",
      contact: "fixture@example.invalid",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: now,
      expiresAt: new Date(now.getTime() + 1800000),
    })
    .returning();
  applicationId = app!.id;
});
after(() => pg.close());
async function finish() {
  return eventOperationsService(connection, () => now).finalize(owner, postId);
}
async function result() {
  await db.insert(eventResults).values({
    applicationId,
    postId,
    userId: attendee,
    recorderId: owner,
    presence: "attended",
    outcome: "participated",
    reason: "담당자 참가 확인",
  });
}
test("elapsed or closed events do not imply formal completion; repeated completion keeps original snapshot and time", async () => {
  await result();
  await db
    .update(base.eventSettings)
    .set({ open: false })
    .where(eq(base.eventSettings.postId, postId));
  assert.equal((await db.select().from(base.eventRecords)).length, 0);
  await finish();
  const [first] = await db.select().from(base.eventRecords);
  const [settings] = await db.select().from(base.eventSettings);
  assert.equal(first!.snapshot.title, "보존되는 행사 기록");
  assert.equal(settings!.completedBy, owner);
  now = new Date(now.getTime() + 60000);
  await db
    .update(base.posts)
    .set({ title: "나중에 바뀐 모집 제목" })
    .where(eq(base.posts.id, postId));
  await finish();
  const [second] = await db.select().from(base.eventRecords);
  const [again] = await db.select().from(base.eventSettings);
  assert.deepEqual(second!.snapshot, first!.snapshot);
  assert.equal(second!.completedAt.toISOString(), first!.completedAt.toISOString());
  assert.equal(again!.completedAt?.toISOString(), settings!.completedAt?.toISOString());
  await assert.rejects(() =>
    db
      .update(base.eventRecords)
      .set({ snapshot: { ...first!.snapshot, title: "과거 기록 변조" } })
      .where(eq(base.eventRecords.postId, postId)),
  );
});
test("current result projection retains append-only before/after audit evidence", async () => {
  await result();
  await db
    .update(eventResults)
    .set({ outcome: "won", reason: "마지막 라운드 점수 확인" })
    .where(eq(eventResults.applicationId, applicationId));
  const history = await db.select().from(records.eventResultRevisions);
  assert.equal(history.length, 2);
  assert.equal(history[0]!.before, null);
  assert.equal((history[1]!.after as { outcome: string }).outcome, "won");
  assert.equal((history[1]!.before as { outcome: string }).outcome, "participated");
  await assert.rejects(() =>
    db
      .update(records.eventResultRevisions)
      .set({ reason: "기록 변조" })
      .where(eq(records.eventResultRevisions.id, history[0]!.id)),
  );
  await assert.rejects(() =>
    db
      .delete(records.eventResultRevisions)
      .where(eq(records.eventResultRevisions.id, history[0]!.id)),
  );
});
test("record media cannot have two parents, move to a public story or be attached by another uploader", async () => {
  await finish();
  const assetId = randomUUID();
  await db.insert(base.mediaAssets).values({
    id: assetId,
    uploaderId: owner,
    objectKey: assetId + ".webp",
    contentType: "image/webp",
    byteSize: 24,
    status: "ready",
  });
  const doc: PostDocument = {
    version: 1,
    type: "doc",
    content: [{ type: "image", attrs: { assetId, alt: "현장" } }],
  };
  await db.transaction((tx) =>
    attachRecordMedia(tx as unknown as Parameters<typeof attachRecordMedia>[0], postId, owner, doc),
  );
  await assert.rejects(() =>
    db.update(base.mediaAssets).set({ postId }).where(eq(base.mediaAssets.id, assetId)),
  );
  await assert.rejects(() =>
    communityService(connection).createPost(owner, {
      categorySlug: "party",
      kind: "이야기",
      title: "공개 글로 가져오기",
      bodyMarkdown: "기록 미디어는 가져오면 안 됩니다.",
      imageAssetIds: [assetId],
    }),
  );
  await assert.rejects(() =>
    db.transaction((tx) =>
      attachRecordMedia(
        tx as unknown as Parameters<typeof attachRecordMedia>[0],
        postId,
        attendee,
        doc,
      ),
    ),
  );
  const [asset] = await db.select().from(base.mediaAssets);
  assert.equal(asset!.recordPostId, postId);
  assert.equal(asset!.postId, null);
  await db
    .update(base.mediaAssets)
    .set({ recordPostId: null })
    .where(eq(base.mediaAssets.id, assetId));
  const [detached] = await db.select().from(base.mediaAssets);
  assert.equal(detached!.recordOriginPostId, postId);
  await assert.rejects(() =>
    db
      .update(base.mediaAssets)
      .set({ recordOriginPostId: null, postId })
      .where(eq(base.mediaAssets.id, assetId)),
  );
  await assert.rejects(() =>
    communityService(connection).createPost(owner, {
      categorySlug: "party",
      kind: "이야기",
      title: "분리 후에도 비공개",
      bodyMarkdown: "기록에서 제거한 이미지도 회원 전용으로 유지합니다.",
      imageAssetIds: [assetId],
    }),
  );
});
test("record-bound video still requires ready state and record owner", async () => {
  await finish();
  const id = randomUUID();
  await db.insert(videoAssets).values({
    id,
    uploaderId: owner,
    objectKey: id + ".mp4",
    byteSize: 100,
    width: 32,
    height: 32,
    durationSeconds: 1,
    status: "pending",
  });
  await assert.rejects(() =>
    db.update(videoAssets).set({ recordPostId: postId }).where(eq(videoAssets.id, id)),
  );
  await db
    .update(videoAssets)
    .set({ status: "ready", recordPostId: postId })
    .where(eq(videoAssets.id, id));
  await assert.rejects(() => db.update(videoAssets).set({ postId }).where(eq(videoAssets.id, id)));
  const [asset] = await db.select().from(videoAssets);
  assert.equal(asset!.recordPostId, postId);
});
