import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type Database } from "../src/db/connection";
import {
  profiles,
  posts,
  eventSettings,
  eventApplications,
  eventRecords,
  roomManagers,
  mediaAssets,
} from "../src/db/schema";
import { eventOperationsService } from "../src/server/event-operations-service";
import { playerService } from "../src/server/player-service";
import { recordService } from "../src/server/record-service";
import { portfolioService } from "../src/server/portfolio-service";
import { eventCreditService } from "../src/server/event-credit-service";
import { searchService } from "../src/server/search-service";
import { assertRecordMediaAccess } from "../src/server/record-policy";
import { videoAssets } from "../src/db/video-schema";
import { readImage } from "../src/server/media";
import { readVideo } from "../src/server/video-media";
import { inboxItems } from "../src/db/engagement-schema";
import { memberBlocks } from "../src/db/safety-schema";
import type { PostDocument } from "../src/domain/post-document";
const url = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw new Error("Record integration checks require the isolated local development database.");
const rollback = new Error("record-fixture-rollback");
const doc: PostDocument = {
  version: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "함께 만든 행사의 미션과 진행 과정을 다음 기획자를 위해 기록합니다.",
        },
      ],
    },
  ],
};
async function member(db: Database, nickname: string) {
  const id = randomUUID();
  await db.execute(sql`insert into auth.users(id) values(${id}::uuid)`);
  const [row] = await db
    .insert(profiles)
    .values({ id, nickname, phoneNumber: "01012345678" })
    .returning();
  return row!;
}
async function event(db: Database, owner: string, title: string) {
  const postId = randomUUID(),
    now = Date.now();
  await db.insert(posts).values({
    id: postId,
    authorId: owner,
    kind: "모집",
    categorySlug: "party",
    title,
    bodyMarkdown: "실제 데이터베이스에서 전체 기록 흐름을 검증하는 행사입니다.",
  });
  await db.insert(eventSettings).values({
    postId,
    amountKRW: 0,
    capacity: 10,
    startsAt: new Date(now - 7200000),
    endsAt: new Date(now - 3600000),
  });
  return postId;
}
test("native PostgreSQL: QR and manager attendance → completion → recap → accepted credits → portfolio and member-only search", async () => {
  const connection = createDatabase(url.toString(), 1);
  let fixturePostId = "",
    verified = false;
  try {
    await connection.db.transaction(async (tx) => {
      const db = tx as unknown as Database,
        host = await member(db, "흐름검증 주최자"),
        qr = await member(db, "흐름검증 QR"),
        manual = await member(db, "흐름검증 담당자"),
        absent = await member(db, "흐름검증 미참석"),
        crew = await member(db, "흐름검증 제작진"),
        reader = await member(db, "흐름검증 회원");
      fixturePostId = await event(db, host.id, "native-record-" + randomUUID());
      const applications = [];
      for (const user of [qr, manual, absent]) {
        const [app] = await db
          .insert(eventApplications)
          .values({
            postId: fixturePostId,
            userId: user.id,
            attendeeName: user.nickname,
            contact: "fixture@example.invalid",
            amountKRW: 0,
            status: "confirmed",
            confirmedAt: new Date(),
            expiresAt: new Date(Date.now() + 1800000),
          })
          .returning();
        applications.push(app!);
      }
      let clock = new Date(Date.now() - 5400000);
      const operations = eventOperationsService(db, () => clock),
        players = playerService(db),
        records = recordService(db),
        portfolio = portfolioService(db),
        credits = eventCreditService(db);
      const ticket = await operations.issue(qr.id, fixturePostId, {
        applicationId: applications[0]!.id,
      });
      await operations.scan(host.id, fixturePostId, { code: ticket.code }, true);
      clock = new Date();
      await players.recordResult(host.id, fixturePostId, {
        applicationId: applications[1]!.id,
        presence: "attended",
        outcome: "participated",
        observedRole: "brain",
      });
      await players.recordResult(host.id, fixturePostId, {
        applicationId: applications[2]!.id,
        presence: "no_show",
        outcome: "participated",
        observedRole: null,
      });
      assert.equal((await operations.finalize(host.id, fixturePostId)).recorded, 1);
      const first = await records.detail(host.id, fixturePostId);
      assert.equal(first.attended, 2);
      assert.equal(first.qrAttended, 1);
      assert.equal(first.managerAttended, 1);
      assert.equal((await operations.finalize(host.id, fixturePostId)).recorded, 0);
      assert.equal((await records.detail(host.id, fixturePostId)).completedAt, first.completedAt);
      await operations.writeReview(qr.id, fixturePostId, {
        title: "함께한 행사 후기",
        bodyMarkdown:
          "정확한 참가 확인을 거친 행사 후기입니다. 다음 행사에도 다시 참여하고 싶습니다.",
        rating: 5,
      });
      const imageId = randomUUID(),
        videoId = randomUUID();
      await db.insert(mediaAssets).values({
        id: imageId,
        uploaderId: host.id,
        objectKey: imageId + ".webp",
        contentType: "image/webp",
        byteSize: 100,
        status: "ready",
      });
      await db.insert(videoAssets).values({
        id: videoId,
        uploaderId: host.id,
        objectKey: videoId + ".mp4",
        width: 32,
        height: 32,
        byteSize: 100,
        durationSeconds: 1,
        status: "ready",
      });
      const recap: PostDocument = {
        ...doc,
        content: [
          ...doc.content,
          { type: "image", attrs: { assetId: imageId, alt: "검증 사진" } },
          { type: "uploadedVideo", attrs: { assetId: videoId } },
        ],
      };
      const saved = await records.save(host.id, fixturePostId, {
        expectedUpdatedAt: first.updatedAt,
        purpose: "누구나 함께 즐기는 게임과 소통 경험을 기획했습니다.",
        execution: "팀별 미션과 마지막 회고를 순서대로 진행했습니다.",
        highlights: "협력과 소통이 좋았습니다.",
        improvements: "안내 시간을 늘리겠습니다.",
        bodyDocument: recap,
        relatedPostIds: [],
        libraryIds: [],
      });
      const published = await records.publish(host.id, fixturePostId, {
        expectedUpdatedAt: saved.updatedAt,
        published: true,
      });
      const sharedDatabase = globalThis as unknown as {
        sliperConnection?: ReturnType<typeof createDatabase>;
      };
      const priorDatabase = sharedDatabase.sliperConnection;
      sharedDatabase.sliperConnection = { db, close: async () => {} };
      try {
        await assert.rejects(readImage(imageId, null));
        for (const method of ["GET", "HEAD"]) {
          await assert.rejects(
            readVideo(
              videoId,
              null,
              new Request("http://127.0.0.1:3000/api/videos/" + videoId, {
                method,
                headers: { Range: "bytes=0-9" },
              }),
            ),
          );
        }
        const head = await readVideo(
          videoId,
          reader.id,
          new Request("http://127.0.0.1:3000/api/videos/" + videoId, {
            method: "HEAD",
            headers: { Range: "bytes=0-9" },
          }),
        );
        assert.equal(head.status, 206);
        assert.equal(head.headers.get("Cache-Control"), "private, no-store");
        assert.equal(head.headers.get("Content-Range"), "bytes 0-9/100");
        const withdrawn = await records.publish(host.id, fixturePostId, {
          expectedUpdatedAt: published.updatedAt,
          published: false,
        });
        await assert.rejects(readImage(imageId, reader.id));
        await assert.rejects(
          readVideo(
            videoId,
            reader.id,
            new Request("http://127.0.0.1:3000/api/videos/" + videoId, { method: "HEAD" }),
          ),
        );
        await records.publish(host.id, fixturePostId, {
          expectedUpdatedAt: withdrawn.updatedAt,
          published: true,
        });
      } finally {
        if (priorDatabase) sharedDatabase.sliperConnection = priorDatabase;
        else delete sharedDatabase.sliperConnection;
      }
      assert.equal(published.reviewCount, 1);
      assert.equal(published.averageRating, 5);
      for (const role of ["MC", "기획자"] as const) {
        const list = await credits.create(host.id, fixturePostId, {
          memberPublicId: crew.publicId,
          role,
          note: "실제 행사 운영 확인",
        });
        const item = list.items.find((item) => item.role === role)!;
        await credits.decide(crew.id, item.id, {
          expectedUpdatedAt: item.updatedAt,
          decision: "accept",
        });
      }
      assert.equal((await portfolio.self(crew.id)).summary.contributed, 1);
      await assert.rejects(portfolio.view(reader.id, crew.publicId));
      await portfolio.updatePreference(crew.id, {
        visible: true,
        featuredEventIds: [fixturePostId],
      });
      assert.equal((await portfolio.view(reader.id, crew.publicId)).featured.length, 1);
      const hostStats = (await portfolio.self(host.id)).summary;
      assert.equal(hostStats.hostAttendeeCount, 2);
      assert.equal(hostStats.hostQrAttendeeCount, 1);
      assert.equal(hostStats.hostManagerAttendeeCount, 1);
      assert.equal(hostStats.hostAverageRating, 5);
      assert.equal(
        (await searchService(db).search(reader.id, { q: published.title, type: "record" })).total,
        1,
      );
      assert.equal(
        (await searchService(db).search(null, { q: published.title, type: "record" })).total,
        0,
      );
      await assert.rejects(assertRecordMediaAccess(db, fixturePostId, null));
      await db
        .insert(memberBlocks)
        .values({ blockerId: host.id, blockedId: reader.id, displayLabel: "검증" });
      await assert.rejects(records.detail(reader.id, fixturePostId));
      assert.equal(
        (await searchService(db).search(reader.id, { q: published.title, type: "record" })).total,
        0,
      );
      const notices = await db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.postId, fixturePostId));
      assert.equal(notices.filter((item) => item.kind === "records").length, 2);
      verified = true;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await connection.close();
  }
  assert.equal(verified, true);
  const check = createDatabase(url.toString(), 1);
  try {
    assert.equal(
      (await check.db.select().from(posts).where(eq(posts.id, fixturePostId))).length,
      0,
    );
  } finally {
    await check.close();
  }
});
test("native PostgreSQL: independent simultaneous completion requests preserve one draft and original completion evidence", async () => {
  const a = createDatabase(url.toString(), 1),
    b = createDatabase(url.toString(), 1);
  let postId = "",
    owner = "",
    manager = "";
  try {
    owner = (await member(a.db, "동시 완료 주최자")).id;
    manager = (await member(a.db, "동시 완료 담당자")).id;
    postId = await event(a.db, owner, "completion-race-" + randomUUID());
    await a.db.insert(roomManagers).values({ postId, userId: manager });
    const results = await Promise.all([
      eventOperationsService(a.db).finalize(owner, postId),
      eventOperationsService(b.db).finalize(manager, postId),
    ]);
    assert.equal(
      results.reduce((count, item) => count + item.recorded, 0),
      0,
    );
    const records = await a.db.select().from(eventRecords).where(eq(eventRecords.postId, postId));
    assert.equal(records.length, 1);
    const [first] = await a.db.select().from(eventSettings).where(eq(eventSettings.postId, postId));
    await eventOperationsService(b.db).finalize(manager, postId);
    const [again] = await a.db.select().from(eventSettings).where(eq(eventSettings.postId, postId));
    assert.equal(again!.completedAt!.toISOString(), first!.completedAt!.toISOString());
    assert.equal(again!.completedBy, first!.completedBy);
    assert.equal(again!.open, false);
  } finally {
    // This concurrency fixture has no applications/results, so no permanent participant audit is removed.
    if (postId) {
      await a.db.delete(eventRecords).where(eq(eventRecords.postId, postId));
      await a.db.delete(posts).where(eq(posts.id, postId));
    }
    for (const id of [owner, manager])
      if (id) await a.db.execute(sql`delete from auth.users where id=${id}::uuid`);
    await Promise.all([a.close(), b.close()]);
  }
});
