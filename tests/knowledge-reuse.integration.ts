import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase, type Database } from "../src/db/connection";
import {
  eventApplications,
  eventSettings,
  mediaAssets,
  posts,
  profiles,
  roomManagers,
} from "../src/db/schema";
import { libraryEntries, libraryVersions, templateProvenance } from "../src/db/library-schema";
import { eventRecordLinks } from "../src/db/records-schema";
import { contentRestrictions } from "../src/db/safety-schema";
import { videoAssets } from "../src/db/video-schema";
import { libraryInputSchema, type LibraryInput } from "../src/domain/library";
import type { PostDocument } from "../src/domain/post-document";
import { eventOperationsService } from "../src/server/event-operations-service";
import { libraryService } from "../src/server/library-service";
import { playerService } from "../src/server/player-service";
import { createRecordTemplateService } from "../src/server/record-template-service";
import { recordService } from "../src/server/record-service";
import { AppError } from "../src/server/errors";

const url = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw new Error("Knowledge reuse checks require the isolated local development database.");

const rollback = new Error("knowledge-reuse-fixture-rollback");
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;

const originalContent = libraryInputSchema.parse({
  kind: "template",
  categorySlug: "mind-games",
  title: "유료 원본 운영 자료",
  summary: "실제 회고에서 작성자가 자신의 운영 경험을 별도 초안으로 만드는 검사입니다.",
  scenario: "ORIGINAL-PAID-SCENARIO 역할 카드의 비밀 정답과 전체 진행 시나리오입니다.",
  rules: "ORIGINAL-PAID-RULES 참가자에게 공개하지 않는 원본 자료의 진행 규칙입니다.",
  hostGuide: "ORIGINAL-PAID-GUIDE 원본 구매자에게만 제공되는 진행자 설명입니다.",
  materials: ["ORIGINAL-PAID-MATERIAL"],
  rounds: [{ name: "ORIGINAL-PAID-ROUND", seconds: 600 }],
  tags: ["추리"],
  minPlayers: 1,
  maxPlayers: 20,
  durationMinutes: 60,
  priceKRW: 15000,
  purchaseUrl: "https://example.invalid/knowledge-original",
  usageTerms: "원본 구매자의 개인 행사에서만 이용할 수 있습니다.",
  allowDerivatives: false,
  allowCommercialUse: false,
});

function hosting(title: string) {
  const start = Date.now() + 10 * 86400000;
  return {
    title,
    location: "서울 지식 재사용 검사 장소",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 3600000).toISOString(),
    amountKRW: 0,
    capacity: 5,
    description: "발행한 운영 자료의 정확한 버전으로 다음 행사를 개설하는 검사입니다.",
  };
}

async function member(db: Database, nickname: string) {
  const id = randomUUID();
  await db.execute(sql`insert into auth.users(id) values(${id}::uuid)`);
  const [row] = await db
    .insert(profiles)
    .values({ id, nickname, phoneNumber: "01012345678" })
    .returning();
  return row!;
}

test("native PostgreSQL: completed reflection becomes one private draft, publishes exact versions, and keeps member-only evidence private", async () => {
  const connection = createDatabase(url.toString(), 1);
  let fixturePostId = "",
    fixtureEntryId = "",
    verified = false;
  try {
    await connection.db.transaction(async (tx) => {
      const db = tx as unknown as Database,
        host = await member(db, "회고 재사용 주최자"),
        reader = await member(db, "회고 재사용 회원"),
        manager = await member(db, "회고 재사용 담당자"),
        attendee = await member(db, "PRIVATE-PARTICIPANT"),
        library = libraryService(db),
        records = recordService(db),
        conversion = createRecordTemplateService(db);

      const originalDraft = await library.createDraft(host.id, originalContent);
      const original = await library.publish(host.id, originalDraft.id, {
        expectedUpdatedAt: originalDraft.updatedAt,
        changeSummary: "유료 원본 자료 발행",
        publicContentConsent: true,
      });
      fixturePostId = (
        await library.host(host.id, original.id, hosting("native-knowledge-" + randomUUID()))
      ).postId;
      const settings = {
        startsAt: new Date(Date.now() - 7200000),
        endsAt: new Date(Date.now() - 3600000),
      };
      await db.update(eventSettings).set(settings).where(eq(eventSettings.postId, fixturePostId));
      await db.insert(roomManagers).values({ postId: fixturePostId, userId: manager.id });
      const [application] = await db
        .insert(eventApplications)
        .values({
          postId: fixturePostId,
          userId: attendee.id,
          attendeeName: "PRIVATE-ATTENDEE-NAME",
          contact: "PRIVATE-CONTACT@example.invalid",
          amountKRW: 0,
          status: "confirmed",
          confirmedAt: new Date(),
          expiresAt: new Date(Date.now() + 1800000),
        })
        .returning();
      await playerService(db).recordResult(host.id, fixturePostId, {
        applicationId: application!.id,
        presence: "attended",
        outcome: "participated",
        observedRole: "brain",
      });
      await eventOperationsService(db).finalize(host.id, fixturePostId);
      const emptyRecord = await records.detail(host.id, fixturePostId);
      assert.equal(emptyRecord.attended, 1);
      await assert.rejects(
        conversion.createDraft(host.id, fixturePostId, {
          expectedUpdatedAt: emptyRecord.updatedAt,
        }),
        code("VALIDATION"),
      );

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
      const document: PostDocument = {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "PRIVATE-RECAP-BODY 현장 기록은 회원만 볼 수 있어요." },
            ],
          },
          { type: "image", attrs: { assetId: imageId, alt: "PRIVATE-RECAP-IMAGE" } },
          { type: "uploadedVideo", attrs: { assetId: videoId } },
        ],
      };
      const reflection = {
        purpose: "HOST-PURPOSE 누구나 협력하며 즐기는 추리 경험을 기획했습니다.",
        execution: "HOST-EXECUTION 조별 미션과 토론을 진행하고 마지막에 회고했습니다.",
        highlights: "HOST-HIGHLIGHTS 서로의 의견을 경청하며 미션에 집중했습니다.",
        improvements: "HOST-IMPROVEMENTS 다음 행사에서는 안내와 휴식 시간을 늘리겠습니다.",
        bodyDocument: document,
        relatedPostIds: [],
        libraryIds: [],
      };
      const saved = await records.save(host.id, fixturePostId, {
        expectedUpdatedAt: emptyRecord.updatedAt,
        ...reflection,
      });
      assert.equal(saved.status, "draft");
      assert.equal(saved.images.length, 1);
      assert.equal(saved.videos.length, 1);
      await assert.rejects(
        conversion.createDraft(null, fixturePostId, { expectedUpdatedAt: saved.updatedAt }),
        code("UNAUTHENTICATED"),
      );
      await assert.rejects(
        conversion.createDraft(reader.id, fixturePostId, { expectedUpdatedAt: saved.updatedAt }),
        code("NOT_FOUND"),
      );
      await assert.rejects(
        conversion.createDraft(manager.id, fixturePostId, { expectedUpdatedAt: saved.updatedAt }),
        code("FORBIDDEN"),
      );
      await assert.rejects(
        conversion.createDraft(host.id, fixturePostId, {
          expectedUpdatedAt: emptyRecord.updatedAt,
        }),
        code("CONFLICT"),
      );

      // A private conversion needs only the record revision; public consent belongs to publication.
      const draft = await conversion.createDraft(host.id, fixturePostId, {
        expectedUpdatedAt: saved.updatedAt,
      });
      fixtureEntryId = draft.id;
      assert.equal(draft.status, "draft");
      assert.equal(draft.publishedVersion, 0);
      assert.equal(draft.sourceRecordPostId, fixturePostId);
      assert.equal(draft.sourceVersionId, null);
      assert.equal(draft.draftContent?.summary, reflection.purpose);
      assert.equal(draft.draftContent?.rules, reflection.execution);
      assert.equal(draft.draftContent?.scenario.includes(reflection.purpose), true);
      assert.equal(draft.draftContent?.scenario.includes(reflection.execution), true);
      assert.equal(draft.draftContent?.hostGuide.includes(reflection.highlights), true);
      assert.equal(draft.draftContent?.hostGuide.includes(reflection.improvements), true);
      assert.deepEqual(draft.draftContent?.materials, []);
      assert.equal(draft.draftContent?.priceKRW, 0);
      assert.equal(draft.draftContent?.purchaseUrl, null);
      assert.equal(draft.draftContent?.allowDerivatives, false);
      assert.equal(draft.draftContent?.allowCommercialUse, false);
      assert.equal(draft.draftContent?.durationMinutes, 60);
      const serialized = JSON.stringify(draft);
      for (const secret of [
        "PRIVATE-RECAP-BODY",
        "PRIVATE-RECAP-IMAGE",
        imageId,
        videoId,
        "PRIVATE-PARTICIPANT",
        "PRIVATE-ATTENDEE-NAME",
        "PRIVATE-CONTACT",
        attendee.id,
        application!.id,
        "ORIGINAL-PAID-",
      ])
        assert.equal(
          serialized.includes(secret),
          false,
          secret + " must stay in the source record",
        );
      const repeated = await conversion.createDraft(host.id, fixturePostId, {
        expectedUpdatedAt: saved.updatedAt,
      });
      assert.equal(repeated.id, draft.id);
      assert.equal(repeated.updatedAt, draft.updatedAt);
      assert.equal(
        (
          await db
            .select()
            .from(libraryEntries)
            .where(
              and(
                eq(libraryEntries.ownerId, host.id),
                eq(libraryEntries.sourceRecordPostId, fixturePostId),
              ),
            )
        ).length,
        1,
      );
      assert.equal(
        (
          await db
            .select()
            .from(eventRecordLinks)
            .where(
              and(
                eq(eventRecordLinks.recordPostId, fixturePostId),
                eq(eventRecordLinks.libraryEntryId, draft.id),
              ),
            )
        ).length,
        1,
      );
      for (const actor of [null, reader.id]) {
        await assert.rejects(library.detail(actor, draft.id), code("NOT_FOUND"));
        assert.equal(
          (await library.list(actor, {})).items.some((item) => item.id === draft.id),
          false,
        );
        await assert.rejects(library.versions(actor, draft.id, {}), code("NOT_FOUND"));
      }
      assert.equal((await library.versions(host.id, draft.id, {})).total, 0);
      assert.equal(
        (await library.list(host.id, { mine: true })).items.some((i) => i.id === draft.id),
        true,
      );
      await assert.rejects(
        library.publish(host.id, draft.id, {
          expectedUpdatedAt: draft.updatedAt,
          changeSummary: "회고 운영 자료 공개",
        }),
      );
      await assert.rejects(
        library.publish(host.id, draft.id, {
          expectedUpdatedAt: draft.updatedAt,
          changeSummary: "회고 운영 자료 공개",
          publicContentConsent: false,
        }),
      );

      const first = await library.publish(host.id, draft.id, {
        expectedUpdatedAt: draft.updatedAt,
        changeSummary: "작성자의 회고를 운영 자료로 발행",
        publicContentConsent: true,
      });
      const firstVersion = await library.version(host.id, draft.id, 1);
      assert.equal(first.publishedVersion, 1);
      assert.equal(firstVersion.sourceRecordPostId, fixturePostId);
      assert.equal((await library.detail(null, draft.id)).sourceRecordPostId, null);
      assert.equal((await library.detail(reader.id, draft.id)).sourceRecordPostId, null);
      assert.equal((await library.version(reader.id, draft.id, 1)).sourceRecordPostId, null);
      assert.equal(
        (await library.versions(reader.id, draft.id, {})).items[0]?.sourceRecordPostId,
        null,
      );
      const nextEvent = await library.host(reader.id, draft.id, hosting("다음 운영 행사"));
      const firstGuide = await library.eventTemplate(reader.id, nextEvent.postId);
      assert.equal(firstGuide?.versionId, firstVersion.id);
      assert.equal(firstGuide?.versionNumber, 1);
      assert.equal(firstGuide?.scenario, draft.draftContent?.scenario);

      const nextContent: LibraryInput = {
        ...draft.draftContent!,
        title: "회고에서 개선한 두 번째 운영판",
        scenario: "VERSION-TWO-PRIVATE 미션 설명을 늘리고 전체 회고 순서를 개선한 진행 자료입니다.",
      };
      const secondDraft = await library.saveDraft(host.id, draft.id, {
        expectedUpdatedAt: first.updatedAt,
        content: nextContent,
      });
      const publicDuringDraft = await library.detail(reader.id, draft.id);
      assert.equal(publicDuringDraft.publishedVersion, 1);
      assert.equal(publicDuringDraft.title, first.title);
      assert.equal(publicDuringDraft.payload?.scenario, firstVersion.payload?.scenario);
      assert.equal(publicDuringDraft.draftContent, null);
      assert.equal(JSON.stringify(publicDuringDraft).includes("VERSION-TWO-PRIVATE"), false);
      const second = await library.publish(host.id, draft.id, {
        expectedUpdatedAt: secondDraft.updatedAt,
        changeSummary: "미션 설명과 회고 진행 개선",
        publicContentConsent: true,
      });
      assert.equal(second.publishedVersion, 2);
      assert.equal(
        (await library.detail(reader.id, draft.id)).payload?.scenario,
        nextContent.scenario,
      );
      assert.equal(
        (await library.version(reader.id, draft.id, 1)).payload?.scenario,
        firstGuide?.scenario,
      );
      assert.deepEqual(await library.eventTemplate(reader.id, nextEvent.postId), firstGuide);
      const secondEvent = await library.host(reader.id, draft.id, hosting("두 번째 운영판 행사"));
      const secondGuide = await library.eventTemplate(reader.id, secondEvent.postId);
      assert.equal(secondGuide?.versionId, (await library.version(host.id, draft.id, 2)).id);
      assert.equal(secondGuide?.versionNumber, 2);
      assert.equal(secondGuide?.scenario, nextContent.scenario);

      // Source links follow the record's own access policy even after the library is public.
      const publicRecord = await records.publish(host.id, fixturePostId, {
        expectedUpdatedAt: saved.updatedAt,
        published: true,
      });
      assert.equal((await library.detail(reader.id, draft.id)).sourceRecordPostId, fixturePostId);
      assert.equal(
        (await library.version(reader.id, draft.id, 1)).sourceRecordPostId,
        fixturePostId,
      );
      assert.equal(
        (await library.versions(reader.id, draft.id, {})).items.every(
          (item) => item.sourceRecordPostId === fixturePostId,
        ),
        true,
      );
      assert.equal((await library.detail(null, draft.id)).sourceRecordPostId, null);
      const withdrawn = await records.publish(host.id, fixturePostId, {
        expectedUpdatedAt: publicRecord.updatedAt,
        published: false,
      });
      assert.equal((await library.detail(reader.id, draft.id)).sourceRecordPostId, null);
      assert.equal((await library.version(reader.id, draft.id, 1)).sourceRecordPostId, null);
      assert.equal(
        (await library.versions(reader.id, draft.id, {})).items[0]?.sourceRecordPostId,
        null,
      );
      assert.equal((await library.detail(host.id, draft.id)).sourceRecordPostId, fixturePostId);
      await assert.rejects(
        conversion.createDraft(host.id, fixturePostId, { expectedUpdatedAt: saved.updatedAt }),
        code("CONFLICT"),
      );
      assert.equal(
        (
          await conversion.createDraft(host.id, fixturePostId, {
            expectedUpdatedAt: withdrawn.updatedAt,
          })
        ).id,
        draft.id,
      );
      await db.insert(contentRestrictions).values({
        targetType: "record",
        targetId: fixturePostId,
        hidden: true,
        reason: "출처 기록 제한 검사",
      });
      assert.equal((await library.detail(host.id, draft.id)).sourceRecordPostId, null);
      assert.equal((await library.version(host.id, draft.id, 1)).sourceRecordPostId, null);
      assert.equal(
        (await library.versions(host.id, draft.id, {})).items[0]?.sourceRecordPostId,
        null,
      );
      assert.equal(
        (await library.detail(reader.id, draft.id)).payload?.scenario,
        nextContent.scenario,
      );
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
    assert.equal(
      (await check.db.select().from(libraryEntries).where(eq(libraryEntries.id, fixtureEntryId)))
        .length,
      0,
    );
  } finally {
    await check.close();
  }
});

test("native PostgreSQL: independent simultaneous publications commit exactly one immutable version", async () => {
  const a = createDatabase(url.toString(), 1),
    b = createDatabase(url.toString(), 1);
  let ownerId = "",
    entryId = "";
  try {
    ownerId = (await member(a.db, "동시 발행 검증 작성자")).id;
    const content = { ...originalContent, priceKRW: 0, purchaseUrl: null };
    const draft = await libraryService(a.db).createDraft(ownerId, content);
    entryId = draft.id;
    const input = {
      expectedUpdatedAt: draft.updatedAt,
      changeSummary: "두 연결의 동시 최초 발행 검사",
      publicContentConsent: true,
    };
    const results = await Promise.allSettled([
      libraryService(a.db).publish(ownerId, draft.id, input),
      libraryService(b.db).publish(ownerId, draft.id, input),
    ]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    const rejection = results.find((item) => item.status === "rejected");
    assert.equal(rejection?.status, "rejected");
    if (rejection?.status === "rejected") assert.equal(code("CONFLICT")(rejection.reason), true);
    const versions = await a.db
      .select()
      .from(libraryVersions)
      .where(eq(libraryVersions.entryId, entryId));
    assert.equal(versions.length, 1);
    assert.equal(versions[0]?.number, 1);
    assert.deepEqual(versions[0]?.content, content);
    const published = await libraryService(b.db).detail(ownerId, entryId);
    assert.equal(published.publishedVersion, 1);
    assert.equal(published.draftContent, null);
    await assert.rejects(
      b.db
        .update(libraryVersions)
        .set({ changeSummary: "과거 발행본 수정 시도" })
        .where(eq(libraryVersions.entryId, entryId)),
    );
    assert.equal(
      (await libraryService(a.db).version(ownerId, entryId, 1)).changeSummary,
      input.changeSummary,
    );
  } finally {
    // Only this test's temporary entry and profile are committed; no attendance or account state changes.
    if (entryId) {
      await a.db.delete(templateProvenance).where(eq(templateProvenance.entryId, entryId));
      await a.db.delete(libraryEntries).where(eq(libraryEntries.id, entryId));
    }
    if (ownerId) await a.db.execute(sql`delete from auth.users where id=${ownerId}::uuid`);
    await Promise.all([a.close(), b.close()]);
  }
  const check = createDatabase(url.toString(), 1);
  try {
    assert.equal(
      (await check.db.select().from(libraryEntries).where(eq(libraryEntries.id, entryId))).length,
      0,
    );
    assert.equal(
      (await check.db.select().from(profiles).where(eq(profiles.id, ownerId))).length,
      0,
    );
  } finally {
    await check.close();
  }
});
