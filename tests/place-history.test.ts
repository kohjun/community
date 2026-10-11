import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import * as venues from "../src/db/venue-schema";
import { memberBlocks, memberSafety, contentRestrictions } from "../src/db/safety-schema";
import { eventLifecycleService } from "../src/server/event-lifecycle-service";
import { eventAdmissions } from "../src/db/event-operations-schema";
import { eventResults } from "../src/db/player-schema";
import type { Database } from "../src/db/connection";
import type { PostDocument } from "../src/domain/post-document";
import { CATEGORIES } from "../src/domain/categories";
import { venueSchema } from "../src/domain/discovery";
import { createPlaceHistoryService } from "../src/server/place-history-service";
import { eventMapService } from "../src/server/event-map-service";
import { participationService } from "../src/server/participation-service";
import { eventOperationsService } from "../src/server/event-operations-service";
import { recordService } from "../src/server/record-service";
import { AppError } from "../src/server/errors";
import { communityService } from "../src/server/community-service";
import { lightningService } from "../src/server/lightning-service";
import { libraryService } from "../src/server/library-service";

const pg = new PGlite(),
  db = drizzle(pg, { schema: { ...base, ...venues } }),
  connection = db as unknown as Database,
  service = createPlaceHistoryService(connection),
  places = eventMapService(connection),
  records = recordService(connection),
  participation = participationService(connection);
let host: string, reader: string, owner: string, qr: string, manual: string, absent: string;
let placeId: string;
const placeInput = {
  name: "선택 당시의 공원",
  address: "서울특별시 마포구 검사공원로 10",
  description: "실제 장소 선택과 완료 회고 연결을 확인하는 검증용 공유 장소입니다.",
  latitude: 37.55,
  longitude: 126.92,
  categorySlug: "party" as const,
  spaceType: "outdoor" as const,
  isFree: true,
  feeNote: "무료로 이용할 수 있습니다.",
  capacity: 20,
  tags: ["검사"],
  websiteUrl: null,
};
const content: PostDocument = {
  version: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "PRIVATE-RECAP-BODY 다음 기획자에게 남기는 실제 현장 회고입니다." },
      ],
    },
  ],
};
const reflection = {
  purpose: "함께 협력하는 공원 미션을 기획하고 운영한 행사입니다.",
  venueTips: "공원 입구에서 모이고 비가 오면 지붕 있는 공간을 미리 확인하세요.",
  execution: "PRIVATE-EXECUTION 참가자 실명과 내부 진행 계획이 있는 상세 회고입니다.",
  highlights: "공원 입구에서 모이니 참가자가 쉽게 합류했습니다.",
  improvements: "다음에는 비를 피할 수 있는 공간을 미리 확인하겠습니다.",
  bodyDocument: content,
  relatedPostIds: [] as string[],
  libraryIds: [] as string[],
};
const errorCode = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname, phoneNumber: "01012345678" });
  return id;
}
async function event(
  options: {
    venueId?: string | null;
    title?: string;
    category?: "party" | "sports";
  } = {},
) {
  const id = randomUUID();
  await db.insert(base.posts).values({
    id,
    authorId: host,
    kind: "모집",
    categorySlug: options.category ?? "party",
    title: options.title ?? "공원에서 실제로 진행한 미션 행사",
    bodyMarkdown: "PRIVATE-POST-BODY 주최자 내부 연락처와 진행 정보입니다.",
    location: placeInput.name,
    contactInfo: "PRIVATE-HOST-CONTACT",
    applicationUrl: null,
  });
  await db.insert(base.eventSettings).values({
    postId: id,
    amountKRW: 0,
    capacity: 20,
    open: true,
    startsAt: new Date("2020-01-01T01:00:00Z"),
    endsAt: new Date("2020-01-01T03:00:00Z"),
    venueLatitude: placeInput.latitude,
    venueLongitude: placeInput.longitude,
  });
  if (options.venueId !== null)
    await participation.configure(host, id, {
      amountKRW: 0,
      capacity: 20,
      open: true,
      venue: {
        latitude: placeInput.latitude,
        longitude: placeInput.longitude,
        communityVenueId: options.venueId ?? placeId,
      },
    });
  return id;
}
async function finish(id: string, publish = true) {
  await eventOperationsService(connection).finalize(host, id);
  if (!publish) return records.detail(host, id);
  const initial = await records.detail(host, id);
  const saved = await records.save(host, id, {
    ...reflection,
    expectedUpdatedAt: initial.updatedAt,
  });
  return records.publish(host, id, { expectedUpdatedAt: saved.updatedAt, published: true });
}
async function application(postId: string, userId: string) {
  const [entry] = await db
    .insert(base.eventApplications)
    .values({
      postId,
      userId,
      attendeeName: "PRIVATE-ATTENDEE-NAME",
      contact: "PRIVATE-ATTENDEE-CONTACT",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
      expiresAt: new Date("2020-01-01T04:00:00Z"),
    })
    .returning();
  return entry!;
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;truncate sliper.community_venues cascade");
  host = await member("행사 주최자");
  reader = await member("기록 탐색 회원");
  owner = await member("공원 등록 회원");
  qr = await member("PRIVATE-QR");
  manual = await member("PRIVATE-MANUAL");
  absent = await member("PRIVATE-ABSENT");
  placeId = (await places.create(owner, placeInput)).id;
});
after(() => pg.close());

test("place history requires an active member even when a public place has no records", async () => {
  await assert.rejects(service.history(null, placeId), errorCode("UNAUTHENTICATED"));
  await assert.rejects(service.history(randomUUID(), placeId), errorCode("FORBIDDEN"));
  for (const state of [
    { status: "closed", suspendedUntil: null },
    { status: "suspended", suspendedUntil: null },
    { status: "suspended", suspendedUntil: new Date(Date.now() + 86400000) },
  ]) {
    await db
      .insert(memberSafety)
      .values({ userId: reader, ...state })
      .onConflictDoUpdate({ target: memberSafety.userId, set: state });
    await assert.rejects(service.history(reader, placeId), errorCode("FORBIDDEN"));
  }
  await db
    .update(memberSafety)
    .set({ status: "suspended", suspendedUntil: new Date("2020-01-01T00:00:00Z") })
    .where(eq(memberSafety.userId, reader));
  const history = await service.history(reader, placeId);
  assert.deepEqual(history.items, []);
  assert.equal(history.hasMore, false);
});

test("registered venue identity is explicit; matching coordinates and elapsed time create no history", async () => {
  const selected = await event(),
    manualCoords = await event({ venueId: null }),
    identicalPlace = (await places.create(owner, { ...placeInput, name: "같은 좌표의 다른 장소" }))
      .id,
    another = await event({ venueId: identicalPlace });
  await db
    .update(base.eventSettings)
    .set({ open: false })
    .where(eq(base.eventSettings.postId, selected));
  assert.deepEqual((await service.history(reader, placeId)).items, []);
  await finish(manualCoords);
  await finish(another);
  assert.deepEqual((await service.history(reader, placeId)).items, []);
  await finish(selected);
  assert.deepEqual(
    (await service.history(reader, placeId)).items.map((item) => item.record.postId),
    [selected],
  );
  assert.deepEqual(
    (await service.history(reader, identicalPlace)).items.map((item) => item.record.postId),
    [another],
  );
  const [legacy] = await db
    .select()
    .from(base.eventRecords)
    .where(eq(base.eventRecords.postId, manualCoords));
  assert.equal(legacy!.snapshot.venue ?? null, null);
});

test("completion keeps the selection snapshot when the place changes and blocks historical rebinding", async () => {
  const id = await event();
  const [selected] = await db
    .select()
    .from(venues.eventVenueLinks)
    .where(eq(venues.eventVenueLinks.postId, id));
  assert.equal(selected!.snapshot.name, placeInput.name);
  assert.equal(selected!.snapshot.version, 1);
  await places.update(owner, placeId, {
    ...placeInput,
    name: "나중에 바뀐 장소 이름",
    address: "서울특별시 마포구 변경된공원로 99",
    latitude: 37.6,
    longitude: 127,
    capacity: 5,
    isFree: false,
    version: 1,
  });
  await finish(id);
  const [completed] = await db
    .select()
    .from(base.eventRecords)
    .where(eq(base.eventRecords.postId, id));
  assert.deepEqual(completed!.snapshot.venue, selected!.snapshot);
  assert.equal((await service.history(reader, placeId)).items[0]!.record.postId, id);
  await assert.rejects(
    participation.configure(host, id, { amountKRW: 0, capacity: 20, open: false, venue: null }),
    errorCode("CONFLICT"),
  );
  await assert.rejects(
    db.delete(venues.eventVenueLinks).where(eq(venues.eventVenueLinks.postId, id)),
  );
  await assert.rejects(
    db
      .update(venues.eventVenueLinks)
      .set({ snapshot: { ...selected!.snapshot, name: "과거 장소 변조" } })
      .where(eq(venues.eventVenueLinks.postId, id)),
  );
  await assert.rejects(
    db
      .update(base.eventRecords)
      .set({ snapshot: { ...completed!.snapshot, venue: null } })
      .where(eq(base.eventRecords.postId, id)),
  );
  await eventOperationsService(connection).finalize(host, id);
  const [again] = await db.select().from(base.eventRecords).where(eq(base.eventRecords.postId, id));
  assert.deepEqual(again!.snapshot, completed!.snapshot);
});

test("selection rejects forged coordinates and atomically leaves the previous selection unchanged", async () => {
  const id = await event();
  const [before] = await db
    .select()
    .from(venues.eventVenueLinks)
    .where(eq(venues.eventVenueLinks.postId, id));
  await assert.rejects(
    participation.configure(host, id, {
      amountKRW: 0,
      capacity: 20,
      open: true,
      venue: { latitude: 38, longitude: 128, communityVenueId: placeId },
    }),
  );
  const [after] = await db
    .select()
    .from(venues.eventVenueLinks)
    .where(eq(venues.eventVenueLinks.postId, id));
  const [settings] = await db
    .select()
    .from(base.eventSettings)
    .where(eq(base.eventSettings.postId, id));
  assert.deepEqual(after, before);
  assert.equal(settings!.venueLatitude, placeInput.latitude);
  assert.equal(settings!.venueLongitude, placeInput.longitude);
  assert.equal(
    venueSchema.safeParse({ latitude: 37, longitude: 127, communityVenueId: "invalid" }).success,
    false,
  );
  await participation.configure(host, id, {
    amountKRW: 0,
    capacity: 20,
    open: true,
    venue: { latitude: placeInput.latitude, longitude: placeInput.longitude },
  });
  assert.equal(
    (await db.select().from(venues.eventVenueLinks).where(eq(venues.eventVenueLinks.postId, id)))
      .length,
    0,
  );
  await finish(id);
  assert.deepEqual((await service.history(reader, placeId)).items, []);
});

test("history shows only published, formally completed and accessible records, including for their host", async () => {
  const published = await event(),
    draft = await event(),
    withdrawn = await event(),
    sample = await event(),
    cancelled = await event(),
    hiddenPost = await event(),
    hiddenRecord = await event();
  await finish(published);
  await finish(draft, false);
  const withdraw = await finish(withdrawn);
  await records.publish(host, withdrawn, {
    expectedUpdatedAt: withdraw.updatedAt,
    published: false,
  });
  for (const id of [sample, hiddenPost, hiddenRecord]) await finish(id);
  await db.update(base.posts).set({ sample: true }).where(eq(base.posts.id, sample));
  await db
    .update(base.eventSettings)
    .set({ startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000) })
    .where(eq(base.eventSettings.postId, cancelled));
  await eventLifecycleService(connection).change(host, cancelled, {
    kind: "cancel",
    reason: "취소된 행사의 장소 이력 제외 검사",
    expectedRevision: 0,
    confirmed: true,
  });
  await assert.rejects(
    eventOperationsService(connection).finalize(host, cancelled),
    errorCode("CONFLICT"),
  );
  await db.insert(contentRestrictions).values([
    { targetType: "post", targetId: hiddenPost, reason: "원본 모집 비공개" },
    { targetType: "record", targetId: hiddenRecord, reason: "회고 기록 비공개" },
  ]);
  for (const actor of [reader, host])
    assert.deepEqual(
      (await service.history(actor, placeId)).items.map((item) => item.record.postId),
      [published],
    );
  for (const [blockerId, blockedId] of [
    [reader, host],
    [host, reader],
  ]) {
    await db
      .insert(memberBlocks)
      .values({ blockerId: blockerId!, blockedId: blockedId!, displayLabel: "기록 차단 확인" });
    assert.deepEqual((await service.history(reader, placeId)).items, []);
    await db
      .delete(memberBlocks)
      .where(and(eq(memberBlocks.blockerId, blockerId!), eq(memberBlocks.blockedId, blockedId!)));
  }
  await db.insert(memberSafety).values({ userId: host, status: "closed" });
  assert.deepEqual((await service.history(reader, placeId)).items, []);
});

test("hidden, blocked and removed source venues deny history without changing completed snapshots", async () => {
  const id = await event();
  await finish(id);
  const [initial] = await db
    .select()
    .from(base.eventRecords)
    .where(eq(base.eventRecords.postId, id));
  await db
    .insert(contentRestrictions)
    .values({ targetType: "venue", targetId: placeId, reason: "장소 검토 중" });
  await assert.rejects(service.history(reader, placeId), errorCode("NOT_FOUND"));
  const redacted = await records.detail(host, id);
  assert.equal(redacted.snapshot.venue, null);
  assert.equal(redacted.location, "장소 정보 비공개");
  assert.equal(redacted.venueTips, "");
  assert.equal(redacted.canEditVenueTips, false);
  await assert.rejects(
    records.save(host, id, { ...reflection, expectedUpdatedAt: redacted.updatedAt }),
    errorCode("FORBIDDEN"),
  );
  await records.save(host, id, {
    ...reflection,
    venueTips: undefined,
    expectedUpdatedAt: redacted.updatedAt,
  });
  const [preservedTip] = await db
    .select()
    .from(base.eventRecords)
    .where(eq(base.eventRecords.postId, id));
  assert.equal(preservedTip!.venueTips, reflection.venueTips);
  await db
    .delete(contentRestrictions)
    .where(
      and(eq(contentRestrictions.targetType, "venue"), eq(contentRestrictions.targetId, placeId)),
    );
  for (const [blockerId, blockedId] of [
    [reader, owner],
    [owner, reader],
  ]) {
    await db
      .insert(memberBlocks)
      .values({ blockerId: blockerId!, blockedId: blockedId!, displayLabel: "장소 차단 확인" });
    await assert.rejects(service.history(reader, placeId), errorCode("NOT_FOUND"));
    await db
      .delete(memberBlocks)
      .where(and(eq(memberBlocks.blockerId, blockerId!), eq(memberBlocks.blockedId, blockedId!)));
  }
  await places.remove(owner, placeId, { version: 1 });
  await assert.rejects(service.history(reader, placeId), errorCode("NOT_FOUND"));
  const [after] = await db.select().from(base.eventRecords).where(eq(base.eventRecords.postId, id));
  assert.deepEqual(after!.snapshot, initial!.snapshot);
});

test("history uses actual QR and manager attendance and contains no participant or private record content", async () => {
  const id = await event(),
    first = await application(id, qr),
    second = await application(id, manual);
  await application(id, absent);
  await db.insert(eventAdmissions).values({
    applicationId: first.id,
    postId: id,
    userId: qr,
    checkedBy: host,
    checkedAt: new Date("2020-01-01T02:00:00Z"),
  });
  await db.insert(eventResults).values({
    applicationId: second.id,
    postId: id,
    userId: manual,
    recorderId: host,
    presence: "attended",
    outcome: "participated",
    reason: "PRIVATE-RESULT-NOTE",
  });
  const published = await finish(id),
    history = await service.history(reader, placeId),
    item = history.items[0]!;
  assert.equal(published.attended, 2);
  assert.equal(item.record.attended, 2);
  assert.equal(item.record.qrAttended, 1);
  assert.equal(item.record.managerAttended, 1);
  const serialized = JSON.stringify(history);
  for (const privateValue of [
    host,
    reader,
    owner,
    qr,
    manual,
    absent,
    first.id,
    second.id,
    "PRIVATE-ATTENDEE",
    "PRIVATE-EXECUTION",
    "PRIVATE-RECAP-BODY",
    "PRIVATE-POST-BODY",
    "PRIVATE-HOST-CONTACT",
    "PRIVATE-APPLICATION",
    "PRIVATE-RESULT-NOTE",
    "bodyDocument",
    "bodyMarkdown",
    "imageAssetIds",
    "videoAssetIds",
    "phoneNumber",
    "ownerId",
    "uploaderId",
    "01012345678",
  ])
    assert.equal(
      serialized.includes(privateValue),
      false,
      "History exposed a private value: " + privateValue,
    );
});

test("history text search is literal and category filters use the event snapshot", async () => {
  const literal = await event({ title: "100% 즐거운_공원 행사", category: "party" }),
    wildcard = await event({ title: "100X 즐거운A공원 행사", category: "party" }),
    sport = await event({ title: "100% 즐거운_공원 운동", category: "sports" });
  for (const id of [literal, wildcard, sport]) await finish(id);
  assert.deepEqual(
    (await service.history(reader, placeId, { q: "% 즐거운_", category: "party" })).items.map(
      (item) => item.record.postId,
    ),
    [literal],
  );
  assert.deepEqual(
    (await service.history(reader, placeId, { category: "sports" })).items.map(
      (item) => item.record.postId,
    ),
    [sport],
  );
  assert.deepEqual((await service.history(reader, placeId, { q: "존재하지 않는 행사" })).items, []);
  for (const query of [
    { q: "x".repeat(101) },
    { page: 0 },
    { page: 1001 },
    { page: 1.2 },
    { category: "invalid" },
    { ownerId: host },
    { mine: "1" },
  ])
    await assert.rejects(service.history(reader, placeId, query));
});

test("venue links have RLS and remain inaccessible to browser roles", async () => {
  const result = await pg.query<{ relrowsecurity: boolean }>(
    "select relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='sliper' and relname='event_venue_links'",
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.relrowsecurity, true);
  for (const role of ["anon", "authenticated"]) {
    await pg.exec(`set role ${role}`);
    try {
      await assert.rejects(pg.query("select * from sliper.event_venue_links"));
    } finally {
      await pg.exec("reset role");
    }
  }
});

test("all real creation paths bind registered places atomically and reject a forged selection", async () => {
  const venue = {
      latitude: placeInput.latitude,
      longitude: placeInput.longitude,
      communityVenueId: placeId,
      communityVenueVersion: 1,
    },
    start = new Date(Date.now() + 86400000),
    schedule = {
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 3600000).toISOString(),
    },
    community = communityService(connection),
    lightning = lightningService(connection),
    library = libraryService(connection);
  const normalInput = {
    categorySlug: "party",
    kind: "모집",
    title: "선택 장소에서 여는 일반 모임",
    bodyMarkdown: "직접 등록한 모임에서도 선택 장소의 신원을 정확하게 보존합니다.",
    location: placeInput.name,
    eventDate: "내일 오후",
    eventFee: "무료",
    venue,
  };
  const normal = await community.createPost(host, normalInput);
  const quickInput = {
    categorySlug: "party",
    title: "선택 장소에서 여는 번개",
    description: "공유 공원에서 함께 간단한 예능 게임을 즐기는 번개입니다.",
    location: placeInput.name,
    ...schedule,
    capacity: 8,
    venue,
  };
  const quick = await lightning.create(host, quickInput);
  const template = await library.create(host, {
    kind: "template",
    categorySlug: "party",
    title: "장소 선택 검증용 운영 자료",
    summary: "실제 운영 자료로 모임을 열 때도 장소 신원을 정확하게 보존합니다.",
    scenario: "함께 게임을 진행하면서 서로에게 질문하고 미션을 해결합니다.",
    rules: "팀별로 순서를 지키면서 정해진 시간 안에 미션을 해결합니다.",
    materials: ["질문 카드"],
    hostGuide: "참가자를 공원 입구에 모은 뒤 진행 순서와 안전 안내를 설명합니다.",
    minPlayers: 2,
    maxPlayers: 20,
    durationMinutes: 60,
    rounds: [{ name: "첫 미션", seconds: 600 }],
    tags: ["게임"],
    priceKRW: 0,
    purchaseUrl: null,
    allowCommercialUse: true,
  });
  const hostingInput = {
    title: "선택 장소에서 운영 자료 모임",
    location: placeInput.name,
    ...schedule,
    amountKRW: 0,
    capacity: 8,
    description: "정확하게 선택한 공원에서 운영 자료의 내용을 진행하는 행사입니다.",
    venue,
  };
  const hosted = await library.host(host, template.id, hostingInput);
  for (const id of [normal.id, quick.postId, hosted.postId]) {
    const [link] = await db
      .select()
      .from(venues.eventVenueLinks)
      .where(eq(venues.eventVenueLinks.postId, id));
    const [settings] = await db
      .select()
      .from(base.eventSettings)
      .where(eq(base.eventSettings.postId, id));
    assert.equal(link!.venueId, placeId);
    assert.equal(link!.snapshot.id, placeId);
    assert.equal(link!.snapshot.name, placeInput.name);
    assert.equal(settings!.venueLatitude, placeInput.latitude);
    assert.equal(settings!.venueLongitude, placeInput.longitude);
  }
  const initialPostCount = (await db.select({ id: base.posts.id }).from(base.posts)).length,
    initialLinkCount = (await db.select().from(venues.eventVenueLinks)).length,
    forged = { ...venue, longitude: 128 };
  await assert.rejects(community.createPost(host, { ...normalInput, venue: forged }));
  await assert.rejects(lightning.create(host, { ...quickInput, venue: forged }));
  await assert.rejects(library.host(host, template.id, { ...hostingInput, venue: forged }));
  assert.equal((await db.select({ id: base.posts.id }).from(base.posts)).length, initialPostCount);
  assert.equal((await db.select().from(venues.eventVenueLinks)).length, initialLinkCount);
});

test("dedicated venue tips are author-owned, remain when omitted, and filter without scanning private recap fields", async () => {
  const withTips = await event({ title: "장소 운영 팁이 있는 행사" }),
    withoutTips = await event({ title: "장소 팁을 남기지 않은 행사" });
  const initial = await finish(withTips);
  await finish(withoutTips, false);
  const blank = await records.detail(host, withoutTips);
  const savedBlank = await records.save(host, withoutTips, {
    ...reflection,
    venueTips: "",
    expectedUpdatedAt: blank.updatedAt,
  });
  await records.publish(host, withoutTips, {
    expectedUpdatedAt: savedBlank.updatedAt,
    published: true,
  });
  await assert.rejects(
    records.save(reader, withTips, {
      ...reflection,
      venueTips: "다른 회원의 장소 팁을 수정하려는 시도",
      expectedUpdatedAt: initial.updatedAt,
    }),
    errorCode("FORBIDDEN"),
  );
  const { venueTips: _tips, ...withoutTipField } = reflection;
  await records.save(host, withTips, { ...withoutTipField, expectedUpdatedAt: initial.updatedAt });
  const page = await service.history(reader, placeId, { tab: "tips" });
  assert.deepEqual(
    page.items.map((item) => item.record.postId),
    [withTips],
  );
  assert.equal(page.items[0]!.venueTips, reflection.venueTips);
  assert.equal(page.stats.completedEvents, 2);
  assert.equal(page.stats.tips, 1);
  const filtered = await service.history(reader, placeId, { q: "지붕 있는 공간" });
  assert.deepEqual(
    filtered.items.map((item) => item.record.postId),
    [withTips],
  );
  assert.equal(filtered.stats.completedEvents, 2);
  assert.deepEqual((await service.history(reader, placeId, { q: "PRIVATE-EXECUTION" })).items, []);
  assert.deepEqual((await service.history(reader, placeId, { q: "PRIVATE-RECAP-BODY" })).items, []);
});

test("history pages have stable completion order, accurate totals and statistics independent of page or search", async () => {
  const ids: string[] = [];
  for (let index = 0; index < 23; index++) {
    const id = await event({ title: "장소 이력 페이지 검사 " + index });
    ids.push(id);
    await eventOperationsService(connection, () => new Date("2021-01-01T00:00:00Z")).finalize(
      host,
      id,
    );
    const initial = await records.detail(host, id),
      saved = await records.save(host, id, { ...reflection, expectedUpdatedAt: initial.updatedAt });
    await records.publish(host, id, { expectedUpdatedAt: saved.updatedAt, published: true });
  }
  const expected = [...ids].sort().reverse(),
    first = await service.history(reader, placeId),
    second = await service.history(reader, placeId, { page: 2 });
  assert.deepEqual(
    first.items.map((item) => item.record.postId),
    expected.slice(0, 20),
  );
  assert.deepEqual(
    second.items.map((item) => item.record.postId),
    expected.slice(20),
  );
  assert.equal(first.total, 23);
  assert.equal(first.pageCount, 2);
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, false);
  assert.equal(first.stats.completedEvents, 23);
  assert.deepEqual(second.stats, first.stats);
  const filtered = await service.history(reader, placeId, { q: "존재하지 않는 검색" });
  assert.equal(filtered.total, 0);
  assert.deepEqual(filtered.items, []);
  assert.deepEqual(filtered.stats, first.stats);
});

test("existing selections survive settings edits while explicit new venue versions require a deliberate reselect", async () => {
  const id = await event();
  const [original] = await db
    .select()
    .from(venues.eventVenueLinks)
    .where(eq(venues.eventVenueLinks.postId, id));
  const updated = await places.update(owner, placeId, {
    ...placeInput,
    name: "현재 버전의 공원",
    latitude: 37.6,
    longitude: 127,
    version: 1,
  });
  await participation.configure(host, id, {
    amountKRW: 0,
    capacity: 19,
    open: false,
    venue: {
      latitude: placeInput.latitude,
      longitude: placeInput.longitude,
      communityVenueId: placeId,
      communityVenueVersion: 1,
    },
  });
  const [preserved] = await db
    .select()
    .from(venues.eventVenueLinks)
    .where(eq(venues.eventVenueLinks.postId, id));
  assert.deepEqual(preserved!.snapshot, original!.snapshot);
  await participation.configure(host, id, {
    amountKRW: 0,
    capacity: 19,
    open: false,
    venue: {
      latitude: updated.latitude,
      longitude: updated.longitude,
      communityVenueId: placeId,
      communityVenueVersion: updated.version,
    },
  });
  const [reselected] = await db
    .select()
    .from(venues.eventVenueLinks)
    .where(eq(venues.eventVenueLinks.postId, id));
  assert.equal(reselected!.snapshot.version, 2);
  assert.equal(reselected!.snapshot.name, updated.name);
  await finish(id);
  assert.deepEqual((await service.history(reader, placeId)).items[0]!.venue, reselected!.snapshot);
});

test("having any attendee prevents changing registered venue identity even when coordinates are identical", async () => {
  const id = await event(),
    sameCoordsPlace = (
      await places.create(owner, { ...placeInput, name: "같은 좌표지만 다른 장소" })
    ).id;
  await application(id, qr);
  const selected = {
    latitude: placeInput.latitude,
    longitude: placeInput.longitude,
    communityVenueId: placeId,
  };
  await participation.configure(host, id, {
    amountKRW: 0,
    capacity: 20,
    open: false,
    venue: selected,
  });
  await assert.rejects(
    participation.configure(host, id, {
      amountKRW: 0,
      capacity: 20,
      open: false,
      venue: { ...selected, communityVenueId: sameCoordsPlace },
    }),
    errorCode("CONFLICT"),
  );
  await assert.rejects(
    participation.configure(host, id, {
      amountKRW: 0,
      capacity: 20,
      open: false,
      venue: { latitude: placeInput.latitude, longitude: placeInput.longitude },
    }),
    errorCode("CONFLICT"),
  );
  const [link] = await db
    .select()
    .from(venues.eventVenueLinks)
    .where(eq(venues.eventVenueLinks.postId, id));
  assert.equal(link!.venueId, placeId);
});

test("a closed or currently suspended place owner makes the source unavailable but an expired suspension does not", async () => {
  const id = await event();
  await finish(id);
  for (const state of [
    { status: "closed", suspendedUntil: null },
    { status: "suspended", suspendedUntil: null },
    { status: "suspended", suspendedUntil: new Date(Date.now() + 86400000) },
  ]) {
    await db
      .insert(memberSafety)
      .values({ userId: owner, ...state })
      .onConflictDoUpdate({ target: memberSafety.userId, set: state });
    await assert.rejects(service.history(reader, placeId), errorCode("NOT_FOUND"));
  }
  await db
    .update(memberSafety)
    .set({ status: "suspended", suspendedUntil: new Date("2020-01-01T00:00:00Z") })
    .where(eq(memberSafety.userId, owner));
  assert.equal((await service.history(reader, placeId)).items[0]!.record.postId, id);
});
