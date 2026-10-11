import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import { libraryEntries, libraryVersions, templateProvenance } from "../src/db/library-schema";
import { contentRestrictions, memberBlocks, memberSafety } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { emptyEventPlan } from "../src/domain/event-plan";
import {
  libraryInputSchema,
  type LibraryDetail,
  type LibraryInput,
  type LibraryListQuery,
} from "../src/domain/library";
import { libraryService } from "../src/server/library-service";
import { libraryEvidenceService } from "../src/server/library-evidence-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database,
  library = libraryService(connection),
  evidence = libraryEvidenceService(connection);
let owner: string, reader: string, other: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
const content = libraryInputSchema.parse({
  kind: "template",
  categorySlug: "mind-games",
  title: "조건으로 찾는 추리 게임",
  summary: "필요한 인원과 시간을 확인하고 운영 자료를 찾는 공개 요약입니다.",
  scenario: "PRIVATE-SCENARIO 참가자가 역할 카드를 확인하고 라운드별 단서를 모으는 게임입니다.",
  rules: "PRIVATE-RULES 역할 카드를 공개하지 않고 차례로 단서를 설명합니다.",
  hostGuide: "PRIVATE-HOST-GUIDE 진행자는 라운드별로 시간을 안내하고 결과를 확인합니다.",
  materials: ["PRIVATE-MATERIAL"],
  rounds: [{ name: "PRIVATE-ROUND", seconds: 300 }],
  tags: ["추리"],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  priceKRW: 0,
  purchaseUrl: null,
});
const indoor = { preparationDifficulty: "easy", environment: "indoor", requiredStaff: 0 } as const;
const outdoor = {
  preparationDifficulty: "advanced",
  environment: "outdoor",
  requiredStaff: 4,
} as const;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname });
  return id;
}
async function create(overrides: Partial<LibraryInput> = {}, actor = owner) {
  return library.create(actor, { ...content, ...overrides });
}
async function ids(query: Partial<LibraryListQuery> = {}, actor: string | null = reader) {
  return (await library.list(actor, query)).items.map((item) => item.id).sort();
}
async function completed(
  entry: LibraryDetail,
  options: {
    legacy?: boolean;
    mismatch?: boolean;
    recordOwner?: string;
    snapshotEntryId?: string;
  } = {},
) {
  const id = randomUUID(),
    host = options.recordOwner ?? other,
    ended = new Date("2020-01-01T03:00:00Z"),
    profile = (await db.select().from(base.profiles).where(eq(base.profiles.id, host)))[0]!,
    version = (
      await db
        .select()
        .from(libraryVersions)
        .where(and(eq(libraryVersions.entryId, entry.id), eq(libraryVersions.number, 1)))
    )[0]!;
  await db.insert(base.posts).values({
    id,
    authorId: host,
    kind: "모집",
    categorySlug: "mind-games",
    title: "완료된 실제 행사",
    bodyMarkdown: "PRIVATE-EVENT-BODY",
    location: "서울",
  });
  await db.insert(base.eventSettings).values({
    postId: id,
    amountKRW: 0,
    capacity: 10,
    startsAt: new Date("2020-01-01T01:00:00Z"),
    endsAt: ended,
    completedAt: ended,
    completedBy: host,
  });
  await db.insert(templateProvenance).values({
    postId: id,
    entryId: entry.id,
    versionId: options.legacy ? null : version.id,
    snapshot: {
      ...content,
      category: content.categorySlug,
      author: profile.nickname,
      authorPublicId: profile.publicId,
      sourceId: entry.id,
      versionId: options.legacy ? null : version.id,
      versionNumber: options.legacy ? null : 1,
    },
  });
  await db.insert(base.eventRecords).values({
    postId: id,
    ownerId: host,
    status: "published",
    completedAt: ended,
    purpose: "실제로 사용한 자료의 행사 기록입니다.",
    execution: "PRIVATE-RECAP",
    snapshot: {
      title: "당시 실제 행사",
      category: "mind-games",
      location: "서울",
      startsAt: "2020-01-01T01:00:00Z",
      endsAt: ended.toISOString(),
      hostPublicId: profile.publicId,
      hostNickname: profile.nickname,
      template: {
        id: options.snapshotEntryId ?? entry.id,
        title: entry.title,
        ...(options.legacy
          ? {}
          : { versionId: version.id, versionNumber: options.mismatch ? 2 : 1 }),
      },
    },
  });
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
  owner = await member("자료 작성자");
  reader = await member("탐색 회원");
  other = await member("실제 행사 주최자");
});
after(() => pg.close());

test("inclusive player and duration filters compose with type, category and actual material price", async () => {
  const short = await create({ minPlayers: 4, maxPlayers: 8, durationMinutes: 45 }),
    paid = await create({
      kind: "rulebook",
      minPlayers: 8,
      maxPlayers: 12,
      durationMinutes: 90,
      priceKRW: 12000,
      purchaseUrl: "https://example.invalid/purchase",
    }),
    travel = await create({
      categorySlug: "travel",
      minPlayers: 1,
      maxPlayers: 4,
      durationMinutes: 5,
    });
  assert.deepEqual(await ids({ players: 4 }), [short.id, travel.id].sort());
  assert.deepEqual(await ids({ players: 8 }), [short.id, paid.id].sort());
  assert.deepEqual(await ids({ players: 3, category: "mind-games" }), []);
  assert.deepEqual(
    await ids({
      players: 8,
      maxDurationMinutes: 45,
      price: "free",
      kind: "template",
      category: "mind-games",
    }),
    [short.id],
  );
  assert.deepEqual(await ids({ players: 8, maxDurationMinutes: 89, price: "paid" }), []);
  assert.deepEqual(
    await ids({ players: 12, maxDurationMinutes: 90, price: "paid", kind: "rulebook" }),
    [paid.id],
  );
});

test("discovery metadata is explicitly public; missing values never inherit protected event plan facts", async () => {
  const plan = emptyEventPlan();
  plan.reference.location = "PRIVATE-OUTDOOR-LOCATION";
  plan.reference.participants = 23;
  plan.reference.participantFeeKRW = 3000;
  plan.planningIntent = "PRIVATE-PLANNING-INTENT";
  const legacy = await create({
      eventPlan: plan,
      priceKRW: 12000,
      purchaseUrl: "https://example.invalid/paid",
    }),
    first = await create({ discoveryMetadata: indoor }),
    second = await create({ discoveryMetadata: outdoor }),
    unknown = await create({
      discoveryMetadata: { preparationDifficulty: null, environment: null, requiredStaff: null },
    });
  assert.deepEqual((await library.detail(reader, legacy.id)).discoveryMetadata, null);
  assert.deepEqual(await ids({ environment: "outdoor" }), [second.id]);
  assert.deepEqual(await ids({ maxStaff: 0 }), [first.id]);
  assert.deepEqual(await ids({ maxStaff: 4 }), [first.id, second.id].sort());
  assert.deepEqual(await ids({ environment: "indoor", difficulty: "easy", maxStaff: 0 }), [
    first.id,
  ]);
  assert.deepEqual(await ids({ players: 23 }), []);
  const page = await library.list(reader, {}),
    paid = page.items.find((item) => item.id === legacy.id)!;
  assert.equal(paid.priceKRW, 12000);
  assert.equal(paid.discoveryMetadata, null);
  assert.equal(
    page.items.find((item) => item.id === unknown.id)?.discoveryMetadata?.requiredStaff,
    null,
  );
  for (const forbidden of [
    "eventPlan",
    "scenario",
    "rules",
    "materials",
    "hostGuide",
    "rounds",
    "draftContent",
    "ownerId",
  ])
    assert.equal(Object.hasOwn(paid, forbidden), false, forbidden);
  assert.equal(JSON.stringify(page).includes("PRIVATE-"), false);
  assert.equal((await library.detail(reader, legacy.id)).payload, null);
  assert.equal((await library.version(reader, legacy.id, 1)).content, null);
  assert.equal((await library.version(reader, legacy.id, 1)).discoveryMetadata, null);
});

test("public metadata publishes atomically, survives older client edits and never rewrites historical versions or event snapshots", async () => {
  let entry = await create({ discoveryMetadata: indoor });
  const future = new Date(Date.now() + 10 * 86400000),
    hosted = await library.host(owner, entry.id, {
      title: "메타데이터를 보존하는 행사",
      location: "서울",
      startsAt: future.toISOString(),
      endsAt: new Date(future.getTime() + 3600000).toISOString(),
      amountKRW: 0,
      capacity: 5,
      description: "발행 당시의 운영 조건을 변경 없이 보존하는 행사입니다.",
    });
  const [beforeSnapshot] = await db
    .select()
    .from(templateProvenance)
    .where(eq(templateProvenance.postId, hosted.postId));
  entry = await library.saveDraft(owner, entry.id, {
    content: { ...content, discoveryMetadata: outdoor },
    expectedUpdatedAt: entry.updatedAt,
  });
  assert.deepEqual(entry.discoveryMetadata, indoor);
  assert.deepEqual(entry.draftContent?.discoveryMetadata, outdoor);
  assert.deepEqual(await ids({ environment: "indoor" }), [entry.id]);
  assert.deepEqual(await ids({ environment: "outdoor" }), []);
  entry = await library.saveDraft(owner, entry.id, { content, expectedUpdatedAt: entry.updatedAt });
  assert.deepEqual(entry.draftContent?.discoveryMetadata, outdoor);
  entry = await library.publish(owner, entry.id, {
    expectedUpdatedAt: entry.updatedAt,
    changeSummary: "공개 운영 조건 수정",
    publicContentConsent: true,
  });
  assert.deepEqual(entry.discoveryMetadata, outdoor);
  assert.deepEqual((await library.version(reader, entry.id, 1)).discoveryMetadata, indoor);
  assert.deepEqual((await library.version(reader, entry.id, 2)).discoveryMetadata, outdoor);
  entry = await library.update(owner, entry.id, { content, expectedUpdatedAt: entry.updatedAt });
  assert.deepEqual(entry.discoveryMetadata, outdoor);
  entry = await library.update(owner, entry.id, {
    content: { ...content, discoveryMetadata: null },
    expectedUpdatedAt: entry.updatedAt,
  });
  assert.equal(entry.discoveryMetadata, null);
  assert.deepEqual(await ids({ environment: "outdoor" }), []);
  assert.deepEqual((await library.version(reader, entry.id, 2)).discoveryMetadata, outdoor);
  const [afterSnapshot] = await db
    .select()
    .from(templateProvenance)
    .where(eq(templateProvenance.postId, hosted.postId));
  assert.deepEqual(afterSnapshot?.snapshot, beforeSnapshot?.snapshot);
  assert.deepEqual(afterSnapshot?.snapshot.discoveryMetadata, indoor);
});

test("legacy editions without discovery metadata remain missing and drafts stay private", async () => {
  const entry = await create();
  const [legacyVersion] = await db
    .select()
    .from(libraryVersions)
    .where(eq(libraryVersions.entryId, entry.id));
  assert.equal(Object.hasOwn(legacyVersion!.content, "discoveryMetadata"), false);
  assert.equal((await library.version(reader, entry.id, 1)).discoveryMetadata, null);
  assert.equal((await library.detail(reader, entry.id)).discoveryMetadata, null);
  const draft = await library.createDraft(owner, { ...content, discoveryMetadata: indoor });
  assert.deepEqual(await ids({ maxStaff: 0 }), []);
  assert.deepEqual(await ids({ maxStaff: 0, mine: true }, owner), [draft.id]);
  assert.deepEqual(await ids({ maxStaff: 0, mine: true }), []);
});

test("archive cursor keeps all filters and the viewer, pages timestamp ties without duplication", async () => {
  const inserted = await db
    .insert(libraryEntries)
    .values(
      Array.from({ length: 26 }, (_, i) => ({
        ...content,
        title: "조건 페이지 " + i,
        ownerId: owner,
        discoveryMetadata: indoor,
        createdAt: new Date("2020-01-01T00:00:00Z"),
      })),
    )
    .returning({ id: libraryEntries.id });
  const query = {
    players: 5,
    maxDurationMinutes: 60,
    price: "free",
    used: false,
    difficulty: "easy",
    environment: "indoor",
    maxStaff: 0,
    kind: "template",
    category: "mind-games",
    search: "조건 페이지",
    mine: false,
  } as const;
  const first = await library.list(reader, query);
  assert.equal(first.items.length, 24);
  assert.ok(first.nextCursor);
  const second = await library.list(reader, { ...query, cursor: first.nextCursor! });
  assert.equal(second.items.length, 2);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    [...first.items, ...second.items].map((item) => item.id).sort(),
    inserted.map((item) => item.id).sort(),
  );
  for (const changed of [
    { players: 4 },
    { maxDurationMinutes: 59 },
    { price: "paid" },
    { used: true },
    { difficulty: "advanced" },
    { environment: "outdoor" },
    { maxStaff: 1 },
    { kind: "rulebook" },
    { category: "travel" },
    { search: "조건" },
    { mine: true },
  ])
    await assert.rejects(
      library.list(reader, { ...query, ...changed, cursor: first.nextCursor! }),
      code("VALIDATION"),
    );
  for (const actor of [null, other])
    await assert.rejects(
      library.list(actor, { ...query, cursor: first.nextCursor! }),
      code("VALIDATION"),
    );
});

test("used filter counts only member-visible published operating cases with exact template provenance", async () => {
  const entry = await create(),
    visible = await completed(entry);
  await completed(entry, { mismatch: true });
  const legacy = await completed(entry, { legacy: true });
  assert.deepEqual(await ids({ used: true }), [entry.id]);
  const summary = (await library.list(reader, { used: true })).items[0]!;
  assert.equal(summary.visibleUseCases, 2);
  assert.equal(summary.recordedEvents, 0);
  assert.equal(summary.visibleUseCases, (await evidence.list(reader, entry.id)).total);
  assert.equal((await library.detail(null, entry.id)).visibleUseCases, 0);
  await assert.rejects(library.list(null, { used: true }), code("UNAUTHENTICATED"));
  await db
    .update(base.eventRecords)
    .set({ status: "withdrawn" })
    .where(eq(base.eventRecords.postId, visible));
  assert.equal((await library.list(reader, { used: true })).items[0]!.visibleUseCases, 1);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "record", targetId: legacy, reason: "운영 기록 숨김" });
  assert.deepEqual(await ids({ used: true }), []);
  assert.equal((await library.list(reader, {})).items[0]!.visibleUseCases, 0);
});

test("used discovery excludes sample and draft records and cannot attribute swapped template snapshots", async () => {
  const entry = await create(),
    another = await create({ title: "다른 추리 자료" }),
    visible = await completed(entry),
    sample = await completed(entry),
    unpublished = await completed(entry);
  await completed(entry, { snapshotEntryId: another.id });
  await db.update(base.posts).set({ sample: true }).where(eq(base.posts.id, sample));
  await db
    .update(base.eventRecords)
    .set({ status: "draft" })
    .where(eq(base.eventRecords.postId, unpublished));
  assert.deepEqual(await ids({ used: true }), [entry.id]);
  assert.equal((await library.detail(reader, entry.id)).visibleUseCases, 1);
  assert.equal((await library.detail(reader, another.id)).visibleUseCases, 0);
  assert.equal((await evidence.list(reader, entry.id)).total, 1);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: visible, reason: "행사 숨김" });
  assert.deepEqual(await ids({ used: true }), []);
});

test("used cases re-evaluate blocked and departed record owners without leaking their records through archive filters", async () => {
  const entry = await create();
  await completed(entry);
  await db
    .insert(memberBlocks)
    .values({ blockerId: reader, blockedId: other, displayLabel: "차단" });
  assert.deepEqual(await ids({ used: true }), []);
  assert.deepEqual(await ids(), [entry.id]);
  assert.equal((await evidence.list(reader, entry.id)).total, 0);
  await db.delete(memberBlocks);
  await db.insert(memberSafety).values({ userId: other, status: "closed" });
  assert.deepEqual(await ids({ used: true }), []);
  assert.equal((await library.detail(reader, entry.id)).visibleUseCases, 0);
  await db.delete(memberSafety);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "library", targetId: entry.id, reason: "자료 숨김" });
  assert.deepEqual(await ids(), []);
});

test("public metadata schema rejects invalid fields and DB guard stops malformed numeric metadata before discovery casts", async () => {
  for (const metadata of [
    { ...indoor, requiredStaff: -1 },
    { ...indoor, requiredStaff: 101 },
    { ...indoor, requiredStaff: 1.5 },
    { ...indoor, requiredStaff: "0" },
    { ...indoor, environment: "inside" },
    { ...indoor, secret: "private" },
  ])
    assert.equal(
      libraryInputSchema.safeParse({ ...content, discoveryMetadata: metadata }).success,
      false,
    );
  const entry = await create({ discoveryMetadata: indoor });
  for (const metadata of [
    { ...indoor, requiredStaff: "wrong" },
    { ...indoor, requiredStaff: 0.5 },
    { ...indoor, requiredStaff: 101 },
    { ...indoor, extra: "unexpected" },
  ]) {
    await assert.rejects(
      pg.query("update sliper.library_entries set discovery_metadata=$1::jsonb where id=$2", [
        JSON.stringify(metadata),
        entry.id,
      ]),
    );
    assert.deepEqual((await library.detail(reader, entry.id)).discoveryMetadata, indoor);
  }
});
