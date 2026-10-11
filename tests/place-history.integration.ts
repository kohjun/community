import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createDatabase, type Database } from "../src/db/connection";
import { eventApplications, eventRecords, eventSettings, posts, profiles } from "../src/db/schema";
import { communityVenues, eventVenueLinks } from "../src/db/venue-schema";
import { contentRestrictions } from "../src/db/safety-schema";
import { eventMapService } from "../src/server/event-map-service";
import { communityService } from "../src/server/community-service";
import { participationService } from "../src/server/participation-service";
import { eventOperationsService } from "../src/server/event-operations-service";
import { playerService } from "../src/server/player-service";
import { recordService } from "../src/server/record-service";
import { createPlaceHistoryService } from "../src/server/place-history-service";
import type { PostDocument } from "../src/domain/post-document";

const url = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw new Error(
    "Place-history integration checks require the isolated local development database.",
  );
const rollback = new Error("place-history-fixture-rollback");
const placeInput = {
  name: "선택 당시의 native 공원",
  address: "서울특별시 마포구 장소이력검사로 10",
  description: "장소 선택부터 공식 완료와 장소별 회고까지 검증하는 임시 공유 장소입니다.",
  latitude: 37.55,
  longitude: 126.92,
  categorySlug: "party" as const,
  spaceType: "outdoor" as const,
  isFree: true,
  feeNote: "무료 공간",
  capacity: 20,
  tags: ["검사"],
  websiteUrl: null,
};
const body: PostDocument = {
  version: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "PRIVATE-NATIVE-BODY 회고 본문에는 참가자와 내부 진행 계획이 포함되어 있습니다.",
        },
      ],
    },
  ],
};
const reflection = {
  purpose: "공원에서 협력과 소통을 경험하도록 미션을 기획했습니다.",
  execution: "PRIVATE-NATIVE-EXECUTION 주최자 내부 진행 계획을 남기는 상세 회고입니다.",
  highlights: "모임 입구 안내가 도움이 되었습니다.",
  improvements: "비를 피할 공간을 다음에는 미리 확인하겠습니다.",
  venueTips: "공원 입구에서 합류하고 비가 오면 지붕 있는 장소를 준비하세요.",
  bodyDocument: body,
  relatedPostIds: [] as string[],
  libraryIds: [] as string[],
};
async function member(db: Database, nickname: string) {
  const id = randomUUID();
  await db.execute(sql`insert into auth.users(id) values(${id}::uuid)`);
  const [row] = await db
    .insert(profiles)
    .values({
      id,
      nickname,
      phoneNumber: "01012345678",
      profileCompletedAt: new Date(),
      onboardingConsentAt: new Date(),
    })
    .returning();
  return row!;
}
function normalInput(title: string, venueId: string) {
  return {
    categorySlug: "party",
    kind: "모집",
    title,
    bodyMarkdown: "실제 데이터베이스에서 장소 이력의 전체 흐름을 검증하는 행사입니다.",
    location: placeInput.name,
    eventDate: "2020년 1월 1일",
    eventFee: "무료",
    venue: {
      latitude: placeInput.latitude,
      longitude: placeInput.longitude,
      communityVenueId: venueId,
      communityVenueVersion: 1,
    },
  };
}
async function publish(db: Database, host: string, id: string) {
  const records = recordService(db),
    initial = await records.detail(host, id),
    saved = await records.save(host, id, { ...reflection, expectedUpdatedAt: initial.updatedAt });
  return records.publish(host, id, { expectedUpdatedAt: saved.updatedAt, published: true });
}

test("native PostgreSQL: actual venue selection → QR and manager attendance → official completion → member-only place history, then rollback", async () => {
  const connection = createDatabase(url.toString(), 1);
  let fixturePostId = "",
    fixtureVenueId = "",
    verified = false;
  try {
    await connection.db.transaction(async (tx) => {
      const db = tx as unknown as Database,
        host = await member(db, "장소 흐름 주최자"),
        reader = await member(db, "장소 흐름 회원"),
        qr = await member(db, "PRIVATE-NATIVE-QR"),
        manual = await member(db, "PRIVATE-NATIVE-MANUAL"),
        absent = await member(db, "PRIVATE-NATIVE-ABSENT"),
        places = eventMapService(db);
      const place = await places.create(host.id, placeInput);
      fixtureVenueId = place.id;
      const created = await communityService(db).createPost(
        host.id,
        normalInput("native-place-history-" + randomUUID(), place.id),
      );
      fixturePostId = created.id;
      await participationService(db).configure(host.id, fixturePostId, {
        amountKRW: 0,
        capacity: 20,
        open: true,
        startsAt: "2020-01-01T01:00:00Z",
        endsAt: "2020-01-01T03:00:00Z",
      });
      const applications = [];
      for (const user of [qr, manual, absent]) {
        const [entry] = await db
          .insert(eventApplications)
          .values({
            postId: fixturePostId,
            userId: user.id,
            attendeeName: "PRIVATE-NATIVE-NAME",
            contact: "PRIVATE-NATIVE-CONTACT",
            amountKRW: 0,
            status: "confirmed",
            confirmedAt: new Date("2020-01-01T00:00:00Z"),
            expiresAt: new Date(Date.now() + 60000),
          })
          .returning();
        applications.push(entry!);
      }
      let clock = new Date("2020-01-01T02:00:00Z");
      const operations = eventOperationsService(db, () => clock),
        players = playerService(db),
        history = createPlaceHistoryService(db);
      const ticket = await operations.issue(qr.id, fixturePostId, {
        applicationId: applications[0]!.id,
      });
      await operations.scan(host.id, fixturePostId, { code: ticket.code }, true);
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
      const [selected] = await db
        .select()
        .from(eventVenueLinks)
        .where(eq(eventVenueLinks.postId, fixturePostId));
      await places.update(host.id, place.id, {
        ...placeInput,
        name: "나중에 변경된 native 장소",
        latitude: 37.6,
        longitude: 127,
        capacity: 8,
        version: 1,
      });
      assert.deepEqual((await history.history(reader.id, place.id)).items, []);
      clock = new Date();
      assert.equal((await operations.finalize(host.id, fixturePostId)).recorded, 1);
      assert.deepEqual((await history.history(host.id, place.id)).items, []);
      await publish(db, host.id, fixturePostId);
      const view = await history.history(reader.id, place.id),
        item = view.items[0]!;
      assert.equal(view.venue.name, "나중에 변경된 native 장소");
      assert.deepEqual(item.venue, selected!.snapshot);
      assert.equal(item.record.postId, fixturePostId);
      assert.equal(item.record.attended, 2);
      assert.equal(item.record.qrAttended, 1);
      assert.equal(item.record.managerAttended, 1);
      assert.equal(item.venueTips, reflection.venueTips);
      assert.equal(view.stats.completedEvents, 1);
      assert.equal(view.stats.attended, 2);
      assert.equal(view.stats.tips, 1);
      for (const secret of [
        host.id,
        reader.id,
        qr.id,
        manual.id,
        absent.id,
        "PRIVATE-NATIVE",
        "bodyDocument",
        "phoneNumber",
        "01012345678",
        applications[0]!.id,
      ])
        assert.equal(JSON.stringify(view).includes(secret), false);
      await assert.rejects(history.history(null, place.id));
      await db
        .insert(contentRestrictions)
        .values({ targetType: "venue", targetId: place.id, reason: "장소 공개 제한 검사" });
      await assert.rejects(history.history(reader.id, place.id));
      const [record] = await db
        .select()
        .from(eventRecords)
        .where(eq(eventRecords.postId, fixturePostId));
      assert.deepEqual(record!.snapshot.venue, selected!.snapshot);
      verified = true;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    try {
      assert.equal(verified, true);
      assert.equal(
        (
          await connection.db
            .select({ id: posts.id })
            .from(posts)
            .where(eq(posts.id, fixturePostId))
        ).length,
        0,
      );
      assert.equal(
        (
          await connection.db
            .select({ id: communityVenues.id })
            .from(communityVenues)
            .where(eq(communityVenues.id, fixtureVenueId))
        ).length,
        0,
      );
    } finally {
      await connection.close();
    }
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function raceConnection(label: string) {
  const tag = "place-history-race-" + label + "-" + randomUUID().slice(0, 8),
    client = postgres(url.toString(), {
      prepare: false,
      max: 1,
      connection: { application_name: tag, statement_timeout: 15000, lock_timeout: 12000 },
    });
  return { tag, client, db: drizzle(client) as unknown as Database };
}

test("native PostgreSQL: selecting and completing while a venue edit waits preserves one consistent original snapshot", async () => {
  const setup = raceConnection("setup"),
    selection = raceConnection("selection"),
    editing = raceConnection("editing"),
    selected = deferred(),
    release = deferred();
  let host = "",
    reader = "",
    venueId = "",
    postId = "",
    work: Promise<unknown> | undefined,
    edit: Promise<unknown> | undefined;
  try {
    host = (await member(setup.db, "장소 동시성 주최자")).id;
    reader = (await member(setup.db, "장소 동시성 회원")).id;
    venueId = (await eventMapService(setup.db).create(host, placeInput)).id;
    work = selection.db.transaction(async (tx) => {
      const db = tx as unknown as Database;
      postId = (
        await communityService(db).createPost(
          host,
          normalInput("native-place-race-" + randomUUID(), venueId),
        )
      ).id;
      await participationService(db).configure(host, postId, {
        amountKRW: 0,
        capacity: 20,
        open: true,
        startsAt: "2020-01-01T01:00:00Z",
        endsAt: "2020-01-01T03:00:00Z",
      });
      selected.resolve();
      await release.promise;
      await eventOperationsService(db).finalize(host, postId);
      await publish(db, host, postId);
    });
    void work.catch(() => {});
    await Promise.race([
      selected.promise,
      work.then(() => {
        throw new Error("Selection transaction ended before its venue lock was held.");
      }),
    ]);
    edit = eventMapService(editing.db).update(host, venueId, {
      ...placeInput,
      name: "동시 수정된 장소 정보",
      latitude: 37.6,
      longitude: 127,
      capacity: 8,
      isFree: false,
      version: 1,
    });
    void edit.catch(() => {});
    let observedLock = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [activity] =
        await setup.client`select wait_event_type from pg_stat_activity where application_name=${editing.tag} and state='active'`;
      if (activity?.wait_event_type === "Lock") {
        observedLock = true;
        break;
      }
      await delay(25);
    }
    assert.equal(
      observedLock,
      true,
      "A venue edit must wait for the selection transaction's shared row lock.",
    );
    release.resolve();
    await work;
    await edit;
    const history = await createPlaceHistoryService(setup.db).history(reader, venueId),
      item = history.items[0]!;
    assert.equal(history.venue.name, "동시 수정된 장소 정보");
    assert.equal(item.venue.name, placeInput.name);
    assert.equal(item.venue.latitude, placeInput.latitude);
    assert.equal(item.venue.longitude, placeInput.longitude);
    assert.equal(item.venue.version, 1);
    assert.equal(item.record.postId, postId);
    const [settings] = await setup.db
      .select()
      .from(eventSettings)
      .where(eq(eventSettings.postId, postId));
    assert.equal(settings!.venueLatitude, item.venue.latitude);
    assert.equal(settings!.venueLongitude, item.venue.longitude);
  } finally {
    release.resolve();
    await Promise.allSettled([work, edit]);
    try {
      if (postId) {
        await setup.client`delete from sliper.event_records where post_id=${postId}::uuid`;
        await setup.client`delete from sliper.event_settings where post_id=${postId}::uuid`;
        await setup.client`delete from sliper.posts where id=${postId}::uuid`;
      }
      if (venueId)
        await setup.client`delete from sliper.community_venues where id=${venueId}::uuid`;
      if (host || reader)
        await setup.client`delete from auth.users where id=any(${[host, reader].filter(Boolean)}::uuid[])`;
    } finally {
      await Promise.all([setup.client.end(), selection.client.end(), editing.client.end()]);
    }
  }
});
