import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
import * as base from "../src/db/schema";
import * as recordsSchema from "../src/db/records-schema";
import { memberSafety, contentRestrictions, memberBlocks } from "../src/db/safety-schema";
import { eventLifecycleService } from "../src/server/event-lifecycle-service";
import { eventAdmissions, verifiedEventReviews } from "../src/db/event-operations-schema";
import { eventResults } from "../src/db/player-schema";
import { libraryEntries } from "../src/db/library-schema";
import type { Database } from "../src/db/connection";
import type { PostDocument } from "../src/domain/post-document";
import { CATEGORIES } from "../src/domain/categories";
import { searchService } from "../src/server/search-service";
import { assertRecordMediaAccess } from "../src/server/record-policy";
import { createRecordTemplateService } from "../src/server/record-template-service";
import { libraryService } from "../src/server/library-service";
import { visibleRecordSource } from "../src/server/record-policy";
import { recordService } from "../src/server/record-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg, { schema: { ...base, ...recordsSchema } }),
  connection = db as unknown as Database,
  service = recordService(connection);
let owner: string, alice: string, bob: string, manager: string, outsider: string, postId: string;
const content: PostDocument = {
  version: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "직접 진행한 추리 행사에서 얻은 현장 경험을 자세히 기록합니다." },
      ],
    },
  ],
};
const input = {
  purpose: "참가자와 함께 새로운 추리 경험을 만드는 행사입니다.",
  execution: "팀별 추리 미션을 세 단계로 진행하고 마지막 토론을 했어요.",
  highlights: "협력적인 분위기였습니다.",
  improvements: "다음에는 안내 시간을 더 확보하겠습니다.",
  bodyDocument: content,
  relatedPostIds: [] as string[],
  libraryIds: [] as string[],
};
const code = (value: string) => (error: unknown) =>
  error instanceof AppError && error.code === value;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({ id, nickname, phoneNumber: "01012345678" });
  return id;
}
async function event(options: { sample?: boolean; completed?: boolean; record?: boolean } = {}) {
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      kind: "모집",
      categorySlug: "party",
      title: "추리 모임의 남는 기록",
      bodyMarkdown: "기록 서비스 검증용 모집글입니다.",
      sample: options.sample ?? false,
    })
    .returning();
  const id = post!.id,
    ended = new Date("2020-01-01T03:00:00Z");
  await db.insert(base.eventSettings).values({
    postId: id,
    amountKRW: 0,
    capacity: 20,
    open: true,
    startsAt: new Date("2020-01-01T01:00:00Z"),
    endsAt: ended,
    completedAt: options.completed === false ? null : ended,
    completedBy: options.completed === false ? null : owner,
  });
  if (options.record !== false) {
    const [host] = await db.select().from(base.profiles).where(eq(base.profiles.id, owner));
    await db.insert(base.eventRecords).values({
      postId: id,
      ownerId: owner,
      completedAt: ended,
      snapshot: {
        title: post!.title,
        category: "party",
        location: "서울의 행사 공간",
        startsAt: "2020-01-01T01:00:00Z",
        endsAt: ended.toISOString(),
        hostPublicId: host!.publicId,
        hostNickname: host!.nickname,
        template: null,
      },
    });
  }
  return id;
}
async function current(id = postId) {
  return service.detail(owner, id);
}
async function save(id = postId, extra: Partial<typeof input> = {}) {
  return service.save(owner, id, {
    ...input,
    ...extra,
    expectedUpdatedAt: (await current(id)).updatedAt,
  });
}
async function publish(id = postId) {
  const draft = await save(id);
  return service.publish(owner, id, { expectedUpdatedAt: draft.updatedAt, published: true });
}
async function attend(user = alice, qr = true, presence: "attended" | "no_show" = "attended") {
  const [application] = await db
    .insert(base.eventApplications)
    .values({
      postId,
      userId: user,
      attendeeName: "비공개 실명",
      contact: "secret-phone-test",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
      expiresAt: new Date("2020-01-01T04:00:00Z"),
    })
    .returning();
  if (qr)
    await db.insert(eventAdmissions).values({
      applicationId: application!.id,
      postId,
      userId: user,
      checkedBy: owner,
      checkedAt: new Date("2020-01-01T02:00:00Z"),
    });
  await db
    .insert(eventResults)
    .values({ applicationId: application!.id, postId, userId: user, recorderId: owner, presence });
  return application!.id;
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
  owner = await member("주최자");
  alice = await member("참가자");
  bob = await member("다른 참가자");
  manager = await member("담당자");
  outsider = await member("탐색 회원");
  postId = await event();
  await db.insert(base.roomManagers).values({ postId, userId: manager });
});
after(() => pg.close());
test("all record data requires an active authenticated member", async () => {
  await assert.rejects(service.list(null), code("UNAUTHENTICATED"));
  await assert.rejects(service.detail(null, postId), code("UNAUTHENTICATED"));
  await assert.rejects(service.list(randomUUID()), code("FORBIDDEN"));
  await db.insert(memberSafety).values({ userId: owner, status: "closed" });
  await assert.rejects(service.detail(owner, postId), code("FORBIDDEN"));
});
test("draft is visible to host and appointed manager while only host may edit", async () => {
  assert.equal((await current()).status, "draft");
  const preview = await service.detail(manager, postId);
  assert.equal(preview.canEdit, false);
  assert.equal(preview.canManage, true);
  await assert.rejects(service.detail(outsider, postId), code("NOT_FOUND"));
  await assert.rejects(
    service.save(manager, postId, { ...input, expectedUpdatedAt: preview.updatedAt }),
    code("FORBIDDEN"),
  );
  assert.equal((await service.list(owner)).items.length, 0);
  assert.equal((await service.list(owner, { mine: "1" })).items.length, 1);
});
test("member publication and withdrawal keep draft private and guard stale edits", async () => {
  const original = await current(),
    saved = await save();
  await assert.rejects(
    service.save(owner, postId, { ...input, expectedUpdatedAt: original.updatedAt }),
    code("CONFLICT"),
  );
  const shown = await service.publish(owner, postId, {
    expectedUpdatedAt: saved.updatedAt,
    published: true,
  });
  assert.equal(shown.status, "published");
  assert.equal((await service.list(outsider)).items.length, 1);
  assert.match((await service.detail(outsider, postId)).bodyMarkdown, /현장 경험/);
  await assert.rejects(
    service.save(outsider, postId, { ...input, expectedUpdatedAt: shown.updatedAt }),
    code("FORBIDDEN"),
  );
  const hidden = await service.publish(owner, postId, {
    expectedUpdatedAt: shown.updatedAt,
    published: false,
  });
  assert.equal(hidden.status, "withdrawn");
  assert.equal((await service.list(outsider)).items.length, 0);
  await assert.rejects(service.detail(outsider, postId), code("NOT_FOUND"));
});
test("publishing requires useful intent execution and recap; a live record cannot be erased in place", async () => {
  const initial = await current();
  await assert.rejects(
    service.publish(owner, postId, { expectedUpdatedAt: initial.updatedAt, published: true }),
    code("VALIDATION"),
  );
  const shown = await publish();
  await assert.rejects(
    service.save(owner, postId, {
      ...input,
      purpose: "",
      bodyDocument: null,
      expectedUpdatedAt: shown.updatedAt,
    }),
    code("VALIDATION"),
  );
  assert.equal((await current()).status, "published");
});
test("attendance counts QR and manager evidence separately and never counts bare applications", async () => {
  await attend(alice, true);
  await attend(bob, false);
  await db.insert(base.eventApplications).values({
    postId,
    userId: outsider,
    attendeeName: "비공개",
    contact: "secret",
    amountKRW: 0,
    status: "confirmed",
    confirmedAt: new Date("2020-01-01T00:00:00Z"),
    expiresAt: new Date("2020-01-01T04:00:00Z"),
  });
  const view = await current();
  assert.equal(view.attended, 2);
  assert.equal(view.qrAttended, 1);
  assert.equal(view.managerAttended, 1);
  const serialized = JSON.stringify(view);
  for (const privateValue of ["secret-phone-test", "비공개 실명", alice, bob, owner])
    assert.equal(serialized.includes(privateValue), false);
});
test("rating average includes visible verified review sample and excludes hidden or deleted reviews", async () => {
  const first = await attend(alice, true),
    second = await attend(bob, true);
  const ids: string[] = [];
  for (const [applicationId, userId, rating] of [
    [first, alice, 5],
    [second, bob, 3],
  ] as const) {
    const [review] = await db
      .insert(base.posts)
      .values({
        authorId: userId,
        kind: "후기",
        categorySlug: "party",
        title: "참가 인증 후기",
        bodyMarkdown: "함께한 경험을 기록하는 실제 참가 후기입니다.",
      })
      .returning();
    ids.push(review!.id);
    await db.insert(verifiedEventReviews).values({
      reviewPostId: review!.id,
      eventPostId: postId,
      applicationId,
      userId,
      hostId: owner,
      eventTitle: "추리 행사",
      rating,
    });
  }
  let view = await current();
  assert.equal(view.reviewCount, 2);
  assert.equal(view.averageRating, 4);
  assert.equal(view.reviews.length, 2);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: ids[0]!, hidden: true, reason: "검토 중" });
  view = await current();
  assert.equal(view.reviewCount, 1);
  assert.equal(view.averageRating, 3);
  assert.equal(view.reviews.length, 1);
  await db.update(base.posts).set({ status: "deleted" }).where(eq(base.posts.id, ids[1]!));
  view = await current();
  assert.equal(view.reviewCount, 0);
  assert.equal(view.averageRating, null);
});
test("hidden record source and mutual host blocks remove records from all views", async () => {
  await publish();
  await db
    .insert(contentRestrictions)
    .values({ targetType: "record", targetId: postId, hidden: true, reason: "기록 검토" });
  await assert.rejects(service.detail(owner, postId), code("NOT_FOUND"));
  assert.equal((await service.list(outsider)).items.length, 0);
  await db.delete(contentRestrictions);
  await db
    .insert(memberBlocks)
    .values({ blockerId: owner, blockedId: outsider, displayLabel: "차단" });
  await assert.rejects(service.detail(outsider, postId), code("NOT_FOUND"));
  assert.equal((await service.list(outsider)).items.length, 0);
});
test("elapsed open=false does not prove completion and sample or cancelled events are absent", async () => {
  const legacy = await event({ completed: false });
  await db
    .update(base.eventSettings)
    .set({ open: false })
    .where(eq(base.eventSettings.postId, legacy));
  await assert.rejects(service.detail(owner, legacy), code("NOT_FOUND"));
  const noRecord = await event({ record: false });
  await assert.rejects(service.detail(owner, noRecord), code("NOT_FOUND"));
  const sample = await event({ sample: true });
  await assert.rejects(service.detail(owner, sample), code("NOT_FOUND"));
  const cancelled = await event({ completed: false });
  await db
    .update(base.eventSettings)
    .set({ startsAt: new Date("2099-01-01T01:00:00Z"), endsAt: new Date("2099-01-01T03:00:00Z") })
    .where(eq(base.eventSettings.postId, cancelled));
  await eventLifecycleService(connection).change(owner, cancelled, {
    kind: "cancel",
    reason: "행사 취소 확인",
    expectedRevision: 0,
    confirmed: true,
  });
  await assert.rejects(service.detail(owner, cancelled), code("NOT_FOUND"));
});
test("record snapshot remains independent of later recruitment edits", async () => {
  const draft = await save();
  await db
    .update(base.posts)
    .set({ title: "이후에 바뀐 모집 제목", location: "새로운 장소" })
    .where(eq(base.posts.id, postId));
  const view = await current();
  assert.equal(view.title, draft.title);
  assert.equal(view.location, "서울의 행사 공간");
  await assert.rejects(
    db
      .update(base.eventRecords)
      .set({ snapshot: { ...view.snapshot, title: "위조 제목" } })
      .where(eq(base.eventRecords.postId, postId)),
  );
});
test("related posts and paid library entries expose links only and are visibility filtered", async () => {
  const [post] = await db
    .insert(base.posts)
    .values({
      authorId: alice,
      kind: "이야기",
      categorySlug: "party",
      title: "참고할 이야기",
      bodyMarkdown: "별도 이야기 본문",
    })
    .returning();
  const [entry] = await db
    .insert(libraryEntries)
    .values({
      ownerId: alice,
      kind: "rulebook",
      categorySlug: "party",
      title: "유료 룰북 자료",
      summary: "실제 행사 진행을 위한 유료 자료입니다.",
      scenario: "secret-paid-scenario-only-entitled-users",
      rules: "진행 규칙을 충분히 길게 기재합니다.",
      hostGuide: "주최자를 위한 진행 안내입니다.",
      materials: [],
      rounds: [{ name: "첫 라운드", seconds: 60 }],
      tags: [],
      minPlayers: 2,
      maxPlayers: 10,
      durationMinutes: 60,
      priceKRW: 1000,
      purchaseUrl: "https://example.com/buy",
    })
    .returning();
  const view = await save(postId, { relatedPostIds: [post!.id], libraryIds: [entry!.id] });
  assert.equal(view.links.length, 2);
  assert.equal(view.links.find((link) => link.id === entry!.id)?.href, "/archive/" + entry!.id);
  assert.equal(JSON.stringify(view).includes("secret-paid-scenario"), false);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: post!.id, hidden: true, reason: "검토 중" });
  assert.equal((await current()).links.length, 1);
  assert.equal((await service.list(owner, { mine: "1", libraryId: entry!.id })).items.length, 1);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "library", targetId: entry!.id, hidden: true, reason: "자료 검토" });
  assert.equal((await current()).links.length, 0);
  await assert.rejects(service.list(owner, { mine: "1", libraryId: entry!.id }), code("NOT_FOUND"));
  await assert.rejects(save(postId, { relatedPostIds: [post!.id] }), code("NOT_FOUND"));
  await assert.rejects(save(postId, { libraryIds: [entry!.id, entry!.id] }), code("VALIDATION"));
});
test("recap media binds exclusively and cannot borrow recruitment or another uploader assets", async () => {
  const ownId = randomUUID(),
    otherId = randomUUID();
  for (const [id, uploaderId] of [
    [ownId, owner],
    [otherId, alice],
  ] as const) {
    await db.insert(base.mediaAssets).values({
      id,
      uploaderId,
      objectKey: id + ".webp",
      contentType: "image/webp",
      byteSize: 40,
      status: "ready",
    });
  }
  const doc: PostDocument = {
    version: 1,
    type: "doc",
    content: [...content.content, { type: "image", attrs: { assetId: ownId, alt: "현장 사진" } }],
  };
  const view = await save(postId, { bodyDocument: doc });
  assert.equal(view.images[0]?.id, ownId);
  const [asset] = await db.select().from(base.mediaAssets).where(eq(base.mediaAssets.id, ownId));
  assert.equal(asset?.recordPostId, postId);
  assert.equal(asset?.postId, null);
  const foreignDoc: PostDocument = {
    version: 1,
    type: "doc",
    content: [{ type: "image", attrs: { assetId: otherId, alt: "타인 사진" } }],
  };
  await assert.rejects(save(postId, { bodyDocument: foreignDoc }), code("FORBIDDEN"));
  assert.equal((await current()).images[0]?.id, ownId);
  const cleared = await save(postId, { bodyDocument: content });
  assert.equal(cleared.images.length, 0);
});
test("records list uses twenty item pages and literal query and category filters", async () => {
  for (let index = 0; index < 21; index++) await publish(index === 0 ? postId : await event());
  const first = await service.list(outsider),
    second = await service.list(outsider, { page: 2 });
  assert.equal(first.items.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 1);
  assert.equal(second.hasMore, false);
  assert.equal((await service.list(outsider, { category: "sports" })).items.length, 0);
  assert.equal((await service.list(outsider, { q: "%" })).items.length, 0);
  assert.equal((await service.list(outsider, { q: "추리" })).items.length, 20);
});

test("first recap publication notifies actual attendees once; member-only search and media use the record policy", async () => {
  await attend(alice, true);
  await attend(bob, false);
  const shown = await publish();
  const notifications = await db.execute(
    sql`select recipient_id from sliper.inbox_items where kind='records' and post_id=${postId}::uuid`,
  );
  assert.equal(notifications.rows.length, 2);
  const search = searchService(connection);
  assert.equal((await search.search(null, { q: shown.title, type: "record" })).total, 0);
  assert.equal((await search.search(outsider, { q: shown.title, type: "record" })).total, 1);
  await assertRecordMediaAccess(connection, postId, outsider);
  await assert.rejects(assertRecordMediaAccess(connection, postId, null), code("UNAUTHENTICATED"));
  const withdrawn = await service.publish(owner, postId, {
    expectedUpdatedAt: shown.updatedAt,
    published: false,
  });
  await assert.rejects(assertRecordMediaAccess(connection, postId, outsider), code("NOT_FOUND"));
  await service.publish(owner, postId, { expectedUpdatedAt: withdrawn.updatedAt, published: true });
  const again = await db.execute(
    sql`select recipient_id from sliper.inbox_items where kind='records' and post_id=${postId}::uuid`,
  );
  assert.equal(again.rows.length, 2);
});

test("recap conversion is a private idempotent host draft and excludes its rich document and attendees", async () => {
  const secretDoc: PostDocument = {
    version: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "MEMBER-ONLY-RECAP https://youtu.be/member-only-media" }],
      },
    ],
  };
  const record = await save(postId, { bodyDocument: secretDoc });
  await attend();
  const converter = createRecordTemplateService(connection),
    library = libraryService(connection);
  const draft = await converter.createDraft(owner, postId, { expectedUpdatedAt: record.updatedAt });
  const again = await converter.createDraft(owner, postId, { expectedUpdatedAt: record.updatedAt });
  assert.equal(again.id, draft.id);
  await assert.rejects(
    library.update(owner, draft.id, {
      content: draft.draftContent,
      expectedUpdatedAt: draft.updatedAt,
    }),
    code("CONFLICT"),
  );
  assert.equal(draft.status, "draft");
  assert.equal(draft.publishedVersion, 0);
  assert.equal(draft.sourceRecordPostId, postId);
  assert.equal(draft.sourceVersionId, null);
  assert.match(draft.draftContent!.scenario, /팀별 추리 미션/);
  const serialized = JSON.stringify(draft);
  for (const value of ["MEMBER-ONLY-RECAP", "member-only-media", "secret-phone-test", alice])
    assert.equal(serialized.includes(value), false);
  await assert.rejects(library.detail(null, draft.id), code("NOT_FOUND"));
  await assert.rejects(library.detail(outsider, draft.id), code("NOT_FOUND"));
  assert.equal((await library.list(null, { kind: "template" })).items.length, 0);
  assert.equal((await library.list(owner, { kind: "template", mine: true })).items.length, 1);
  assert.equal((await current()).updatedAt, record.updatedAt);
});

test("only the record host may convert and incomplete or stale reflections cannot be copied", async () => {
  const converter = createRecordTemplateService(connection),
    initial = await current();
  await assert.rejects(
    converter.createDraft(null, postId, { expectedUpdatedAt: initial.updatedAt }),
    code("UNAUTHENTICATED"),
  );
  await assert.rejects(
    converter.createDraft(owner, postId, { expectedUpdatedAt: initial.updatedAt }),
    code("VALIDATION"),
  );
  const record = await save();
  await assert.rejects(
    converter.createDraft(manager, postId, { expectedUpdatedAt: record.updatedAt }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    converter.createDraft(outsider, postId, { expectedUpdatedAt: record.updatedAt }),
    code("NOT_FOUND"),
  );
  await assert.rejects(
    converter.createDraft(owner, postId, { expectedUpdatedAt: initial.updatedAt }),
    code("CONFLICT"),
  );
  await db
    .insert(contentRestrictions)
    .values({ targetType: "record", targetId: postId, hidden: true, reason: "출처 검토" });
  await assert.rejects(
    converter.createDraft(owner, postId, { expectedUpdatedAt: record.updatedAt }),
    code("NOT_FOUND"),
  );
});

test("a published recap-derived template never grants access to its member-only source", async () => {
  const record = await save(),
    library = libraryService(connection);
  const draft = await createRecordTemplateService(connection).createDraft(owner, postId, {
    expectedUpdatedAt: record.updatedAt,
  });
  const released = await library.publish(owner, draft.id, {
    expectedUpdatedAt: draft.updatedAt,
    changeSummary: "내 운영 회고를 템플릿으로 공개",
    publicContentConsent: true,
  });
  assert.equal((await library.detail(null, released.id)).sourceRecordPostId, null);
  assert.equal((await library.version(null, released.id, 1)).sourceRecordPostId, null);
  assert.equal((await library.detail(outsider, released.id)).sourceRecordPostId, null);
  assert.equal(await visibleRecordSource(connection, manager, postId), postId);
  const shown = await service.publish(owner, postId, {
    expectedUpdatedAt: record.updatedAt,
    published: true,
  });
  assert.equal((await library.detail(outsider, released.id)).sourceRecordPostId, postId);
  assert.equal((await library.version(outsider, released.id, 1)).sourceRecordPostId, postId);
  assert.ok((await current()).links.some((link) => link.id === released.id));
  await db.insert(memberSafety).values({ userId: outsider, status: "closed" });
  assert.equal(await visibleRecordSource(connection, outsider, postId), null);
  await assert.rejects(library.detail(outsider, released.id), code("FORBIDDEN"));
  await service.publish(owner, postId, { expectedUpdatedAt: shown.updatedAt, published: false });
  assert.equal((await library.detail(alice, released.id)).sourceRecordPostId, null);
});

test("record material origin is immutable and hidden origins cannot be newly published", async () => {
  const record = await save(),
    library = libraryService(connection);
  const draft = await createRecordTemplateService(connection).createDraft(owner, postId, {
    expectedUpdatedAt: record.updatedAt,
  });
  await assert.rejects(
    db
      .update(libraryEntries)
      .set({ sourceRecordPostId: null })
      .where(eq(libraryEntries.id, draft.id)),
  );
  await db
    .insert(contentRestrictions)
    .values({ targetType: "record", targetId: postId, hidden: true, reason: "출처 검토" });
  await assert.rejects(
    library.publish(owner, draft.id, {
      expectedUpdatedAt: draft.updatedAt,
      changeSummary: "새 운영 자료 공개",
      publicContentConsent: true,
    }),
    code("FORBIDDEN"),
  );
});
