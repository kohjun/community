import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { libraryEntries, libraryVersions } from "../src/db/library-schema";
import { crews, crewActivity } from "../src/db/crew-schema";
import { communityVenues } from "../src/db/venue-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { lightningService } from "../src/server/lightning-service";
import { libraryService } from "../src/server/library-service";
import { recordService } from "../src/server/record-service";
import { eventMapService } from "../src/server/event-map-service";
import { crewService } from "../src/server/crew-service";
import { profileService } from "../src/server/profile-service";
import { AppError } from "../src/server/errors";
import { eventCreditService } from "../src/server/event-credit-service";
import { participationService } from "../src/server/participation-service";
import { eventOperationsService } from "../src/server/event-operations-service";
import { eventAdmissions, verifiedEventReviews } from "../src/db/event-operations-schema";

const pg = new PGlite(),
  db = drizzle(pg, { schema }),
  connection = db as unknown as Database;
const blocked = "씨발";
const validation = (error: unknown) => error instanceof AppError && error.code === "VALIDATION";
let owner: string;
const libraryInput = {
  kind: "template" as const,
  categorySlug: "party" as const,
  title: "함께하는 미션 레이스",
  summary: "팀별로 협동하며 동네를 탐험하는 예능 미션입니다.",
  scenario: "함께 세 가지 미션을 해결한 뒤 마지막 장소에서 결과를 확인합니다.",
  rules: "정해진 장소에서만 미션을 진행하고 안전 수칙을 지켜주세요.",
  materials: ["역할 카드"],
  hostGuide: "반갑습니다. 팀을 나누고 첫 번째 미션을 안내하겠습니다.",
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  rounds: [{ name: "첫 미션", seconds: 300 }],
  tags: ["미션"],
  priceKRW: 0,
  purchaseUrl: null,
};
const crewInput = {
  name: "미션 제작 크루",
  description: "함께 예능 미션 모임을 만드는 크루입니다.",
  category: "party",
  region: "서울",
  capacity: 20,
  recruiting: true,
};
const venueInput = {
  name: "미션 공원",
  address: "서울특별시 공원로 100",
  description: "소규모 팀 미션을 진행하기 좋은 넓은 야외 공간입니다.",
  latitude: 37.55,
  longitude: 126.92,
  categorySlug: "party",
  spaceType: "outdoor",
  isFree: true,
  feeNote: "",
  tags: ["미션"],
  websiteUrl: null,
};
const reflection = {
  purpose: "참가자와 함께 새로운 미션 경험을 만드는 행사입니다.",
  execution: "세 가지 미션을 함께 해결한 뒤 결과를 나누었습니다.",
  highlights: "협력적인 분위기가 좋았습니다.",
  improvements: "다음에는 설명 시간을 더 확보하겠습니다.",
  bodyDocument: {
    version: 1 as const,
    type: "doc" as const,
    content: [
      {
        type: "paragraph" as const,
        content: [{ type: "text" as const, text: "함께 미션을 해결한 현장 경험을 기록합니다." }],
      },
    ],
  },
  relatedPostIds: [],
  libraryIds: [],
};
before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = randomUUID();
  await pg.query("insert into auth.users values($1)", [owner]);
  await db.insert(schema.profiles).values({
    id: owner,
    nickname: "미션기획자",
    phoneNumber: "01012345678",
    profileCompletedAt: new Date(),
    onboardingConsentAt: new Date(),
  });
});
after(() => pg.close());

test("lightning checks public text before recruitment, settings or points are written", async () => {
  const startsAt = new Date(Date.now() + 86400000);
  const input = {
    categorySlug: "party",
    title: "함께하는 번개 모임",
    description: "가볍게 팀별 게임을 즐기는 동네 번개 모임입니다.",
    location: "서울 미션 공원",
    venue: { latitude: 37, longitude: 127 },
    startsAt: startsAt.toISOString(),
    endsAt: new Date(+startsAt + 3600000).toISOString(),
    capacity: 4,
    priceKRW: 0,
    applicationUrl: null,
  };
  await assert.rejects(
    lightningService(connection).create(owner, { ...input, title: blocked + " 모임" }),
    validation,
  );
  assert.equal((await db.select().from(schema.posts)).length, 0);
  assert.equal((await db.select().from(schema.eventSettings)).length, 0);
  assert.equal((await db.select().from(schema.activityEvents)).length, 0);
  await assert.rejects(
    lightningService(connection).create(null, { ...input, title: blocked + " 모임" }),
    (error: unknown) => error instanceof AppError && error.code === "UNAUTHENTICATED",
  );
});

test("library direct creation cannot bypass policy through rules; private drafts may be saved but not published", async () => {
  const service = libraryService(connection),
    content = { ...libraryInput, rules: libraryInput.rules + " " + blocked };
  await assert.rejects(service.create(owner, content), validation);
  assert.equal((await db.select().from(libraryEntries)).length, 0);
  const draft = await service.createDraft(owner, content);
  assert.equal(draft.status, "draft");
  await assert.rejects(
    service.publish(owner, draft.id, {
      expectedUpdatedAt: draft.updatedAt,
      changeSummary: "최초 발행",
      publicContentConsent: true,
    }),
    validation,
  );
  assert.equal((await db.select().from(libraryEntries))[0]!.status, "draft");
  assert.equal((await db.select().from(libraryVersions)).length, 0);
});

test("template hosting rejects prohibited new descriptions and copied legacy titles", async () => {
  const service = libraryService(connection),
    entry = await service.create(owner, libraryInput);
  const startsAt = new Date(Date.now() + 86400000);
  const hosting = {
    title: "함께하는 미션 모임",
    location: "서울 미션 공원",
    description: "함께 다양한 팀 미션을 즐기는 예능 모임입니다.",
    startsAt: startsAt.toISOString(),
    endsAt: new Date(+startsAt + 3600000).toISOString(),
    amountKRW: 0,
    capacity: 4,
    applicationUrl: null,
  };
  await assert.rejects(
    service.host(owner, entry.id, { ...hosting, description: hosting.description + blocked }),
    validation,
  );
  const [version] = await db.select().from(libraryVersions);
  // Simulate a historical edition inserted before policy enforcement without
  // weakening the existing immutable-edition trigger.
  await db.insert(libraryVersions).values({
    entryId: entry.id,
    number: 2,
    content: { ...version!.content, title: blocked + " 미션" },
    changeSummary: "이전 발행 자료",
    publisherId: owner,
    legacy: true,
  });
  await db
    .update(libraryEntries)
    .set({ publishedVersion: 2 })
    .where(eq(libraryEntries.id, entry.id));
  await assert.rejects(service.host(owner, entry.id, hosting), validation);
  assert.equal((await db.select().from(schema.posts)).length, 0);
});

async function eventRecord(completed = true) {
  const ended = new Date("2020-01-01T03:00:00Z");
  const [post] = await db
    .insert(schema.posts)
    .values({
      authorId: owner,
      categorySlug: "party",
      kind: "모집",
      title: "함께한 미션 모임",
      bodyMarkdown: "팀별 미션을 함께 즐긴 행사입니다.",
    })
    .returning();
  await db.insert(schema.eventSettings).values({
    postId: post!.id,
    amountKRW: 0,
    capacity: 10,
    startsAt: new Date("2020-01-01T01:00:00Z"),
    endsAt: ended,
    completedAt: completed ? ended : null,
    completedBy: completed ? owner : null,
  });
  if (completed)
    await db.insert(schema.eventRecords).values({
      postId: post!.id,
      ownerId: owner,
      completedAt: ended,
      snapshot: {
        title: post!.title,
        category: "party",
        location: "서울 미션 공원",
        startsAt: "2020-01-01T01:00:00Z",
        endsAt: ended.toISOString(),
        hostPublicId: null,
        hostNickname: "미션기획자",
        template: null,
      },
    });
  return post!.id;
}
test("record drafts remain editable while publication and published edits enforce policy atomically", async () => {
  const service = recordService(connection),
    id = await eventRecord();
  const initial = await service.detail(owner, id);
  const draft = await service.save(owner, id, {
    ...reflection,
    execution: reflection.execution + blocked,
    expectedUpdatedAt: initial.updatedAt,
  });
  await assert.rejects(
    service.publish(owner, id, { published: true, expectedUpdatedAt: draft.updatedAt }),
    validation,
  );
  assert.equal((await service.detail(owner, id)).status, "draft");
  const clean = await service.save(owner, id, {
    ...reflection,
    expectedUpdatedAt: draft.updatedAt,
  });
  const published = await service.publish(owner, id, {
    published: true,
    expectedUpdatedAt: clean.updatedAt,
  });
  await assert.rejects(
    service.save(owner, id, {
      ...reflection,
      improvements: blocked,
      expectedUpdatedAt: published.updatedAt,
    }),
    validation,
  );
  assert.equal((await service.detail(owner, id)).improvements, reflection.improvements);
  await db
    .update(schema.eventRecords)
    .set({ execution: blocked })
    .where(eq(schema.eventRecords.postId, id));
  const legacy = await service.detail(owner, id);
  assert.equal(
    (await service.publish(owner, id, { published: false, expectedUpdatedAt: legacy.updatedAt }))
      .status,
    "withdrawn",
  );
});

test("venue fee notes and tags are checked but unrelated capacity edits do not rescan legacy labels", async () => {
  const service = eventMapService(connection);
  await assert.rejects(service.create(owner, { ...venueInput, feeNote: blocked }), validation);
  assert.equal((await db.select().from(communityVenues)).length, 0);
  const venue = await service.create(owner, venueInput);
  await assert.rejects(
    service.update(owner, venue.id, { ...venueInput, tags: [blocked], version: venue.version }),
    validation,
  );
  await db
    .update(communityVenues)
    .set({ name: blocked + " 공원" })
    .where(eq(communityVenues.id, venue.id));
  const updated = await service.update(owner, venue.id, {
    ...venueInput,
    name: blocked + " 공원",
    capacity: 15,
    version: venue.version,
  });
  assert.equal(updated.capacity, 15);
});

test("crew names and announcements enforce policy without blocking unrelated legacy settings edits", async () => {
  const service = crewService(connection);
  await assert.rejects(
    service.create(owner, { ...crewInput, name: blocked + " 크루" }),
    validation,
  );
  assert.equal((await db.select().from(crews)).length, 0);
  const crew = await service.create(owner, crewInput);
  const originalActivity = (await db.select().from(crewActivity)).length;
  await assert.rejects(service.announce(owner, crew.id, { body: blocked }), validation);
  assert.equal((await db.select().from(crewActivity)).length, originalActivity);
  await db
    .update(crews)
    .set({ name: blocked + " 크루" })
    .where(eq(crews.id, crew.id));
  const legacy = await service.detail(owner, crew.id);
  const updated = await service.update(owner, crew.id, {
    ...crewInput,
    name: legacy.name,
    capacity: 12,
    expectedUpdatedAt: legacy.updatedAt,
  });
  assert.equal(updated.capacity, 12);
});

test("public profile text is filtered while unchanged legacy names permit private contact updates", async () => {
  const service = profileService(connection, async () => []);
  await assert.rejects(
    service.updateProfile(owner, { nickname: "미션기획자", bio: blocked }),
    validation,
  );
  const [untouched] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, owner));
  assert.equal(untouched!.bio, "");
  await db
    .update(schema.profiles)
    .set({ nickname: blocked + " 이름" })
    .where(eq(schema.profiles.id, owner));
  const updated = await service.updateProfile(owner, {
    nickname: blocked + " 이름",
    phoneNumber: "01087654321",
  });
  assert.equal(updated.phoneNumber, "01087654321");
});

test("production credit checks its note only on public acceptance; refusal evidence remains editable", async () => {
  const service = eventCreditService(connection),
    postId = await eventRecord(),
    target = randomUUID();
  await pg.query("insert into auth.users values($1)", [target]);
  const [person] = await db
    .insert(schema.profiles)
    .values({ id: target, nickname: "진행파트너", phoneNumber: "01012345678" })
    .returning();
  const pending = await service.create(owner, postId, {
    memberPublicId: person!.publicId,
    role: "MC",
    note: "이전 확인 내역: " + blocked,
  });
  const credit = pending.items.find((item) => item.publicId === person!.publicId)!;
  assert.equal(credit.status, "pending");
  await assert.rejects(
    service.decide(target, credit.id, {
      decision: "accept",
      note: "",
      expectedUpdatedAt: credit.updatedAt,
    }),
    validation,
  );
  assert.equal(
    (await service.event(owner, postId)).items.find((item) => item.id === credit.id)!.status,
    "pending",
  );
  const refused = await service.decide(target, credit.id, {
    decision: "reject",
    note: "확인 내역에 " + blocked + " 표현이 있어 거절합니다.",
    expectedUpdatedAt: credit.updatedAt,
  });
  assert.equal(refused.items.find((item) => item.id === credit.id)!.status, "rejected");
});

test("organizer application questions and announcements cannot bypass text policy", async () => {
  const service = participationService(connection),
    postId = await eventRecord(false);
  await assert.rejects(
    service.configure(owner, postId, {
      amountKRW: 0,
      capacity: 10,
      open: true,
      approvalMode: "manual",
      questions: [
        { id: randomUUID(), type: "text", prompt: blocked, required: false, options: [] },
      ],
    }),
    validation,
  );
  assert.equal((await db.select().from(schema.eventSettings))[0]!.questions.length, 0);
  await assert.rejects(service.send(owner, postId, { body: blocked }), validation);
  assert.equal((await db.select().from(schema.roomMessages)).length, 0);
});

test("QR-certified review creation enforces policy before inserting the separate public review post", async () => {
  const postId = await eventRecord(),
    attendee = randomUUID();
  await pg.query("insert into auth.users values($1)", [attendee]);
  await db
    .insert(schema.profiles)
    .values({ id: attendee, nickname: "인증참가자", phoneNumber: "01012345678" });
  const [application] = await db
    .insert(schema.eventApplications)
    .values({
      postId,
      userId: attendee,
      attendeeName: "인증참가자",
      contact: "private-local-fixture",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    })
    .returning();
  await db
    .insert(eventAdmissions)
    .values({ applicationId: application!.id, postId, userId: attendee, checkedBy: owner });
  await assert.rejects(
    eventOperationsService(connection).writeReview(attendee, postId, {
      title: "함께한 미션 후기",
      bodyMarkdown: "팀별로 함께 협동하며 미션을 해결했던 좋은 경험입니다. " + blocked,
      rating: 5,
    }),
    validation,
  );
  assert.equal((await db.select().from(verifiedEventReviews)).length, 0);
  assert.equal((await db.select().from(schema.posts)).length, 1);
});
