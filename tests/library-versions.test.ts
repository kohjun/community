import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { libraryEntries, libraryVersions, templateProvenance } from "../src/db/library-schema";
import { contentRestrictions, memberBlocks, memberSafety } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import {
  libraryInputSchema,
  libraryPublishSchema,
  type LibraryDetail,
  type LibraryInput,
} from "../src/domain/library";
import { COEX_PLAYBOOK_EXAMPLE } from "../src/domain/event-plan-example";
import { libraryService } from "../src/server/library-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  service = libraryService(db as unknown as Database);
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
let owner: string, reader: string, buyer: string;
const input = libraryInputSchema.parse({
  kind: "template",
  categorySlug: "mind-games",
  title: "버전으로 보존하는 미션 게임",
  summary: "역할 카드와 시간 제한을 활용하는 추리 게임의 운영 자료입니다.",
  scenario: "VERSION-ONE-SECRET 각자 역할 카드를 받고 토론으로 미션의 정답을 찾아냅니다.",
  rules: "라운드 시작 전에 규칙을 설명하고 역할 카드를 다른 참가자에게 보여주지 않습니다.",
  hostGuide: "첫 라운드의 목적을 안내하고 종료 전에 참가자에게 남은 시간을 알려주세요.",
  materials: ["역할 카드", "타이머"],
  rounds: [{ name: "추리 라운드", seconds: 300 }],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  tags: ["추리"],
  priceKRW: 0,
  purchaseUrl: null,
  usageTerms: "출처를 표시하고 비상업 행사에서 활용할 수 있습니다.",
  allowDerivatives: false,
  allowCommercialUse: false,
});
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values ($1)", [id]);
  await db.insert(schema.profiles).values({ id, nickname, phoneNumber: "01012345678" });
  return id;
}
async function publish(entry: LibraryDetail, changeSummary = "진행 자료 최초 공개") {
  return service.publish(owner, entry.id, {
    expectedUpdatedAt: entry.updatedAt,
    changeSummary,
    publicContentConsent: true,
  });
}
async function released(content: LibraryInput = input) {
  return publish(await service.createDraft(owner, content));
}
async function revision(entry: LibraryDetail, content: LibraryInput) {
  return service.saveDraft(owner, entry.id, { content, expectedUpdatedAt: entry.updatedAt });
}
function hosting(amountKRW = 0) {
  const startsAt = new Date(Date.now() + 10 * 86400000);
  return {
    title: "버전을 검증하는 다음 행사",
    location: "서울 테스트 장소",
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3600000).toISOString(),
    amountKRW,
    capacity: 5,
    description: "운영 자료의 발행 버전을 고정해서 다음 행사를 개설하는 검사입니다.",
  };
}
before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  owner = await member("버전 작성자");
  reader = await member("파생 작성자");
  buyer = await member("자료 구매자");
});
after(() => pg.close());

test("publication requires an explicit content consent, meaningful change summary and valid revision", () => {
  const publication = {
    expectedUpdatedAt: new Date().toISOString(),
    changeSummary: "운영 방식 개선",
    publicContentConsent: true,
  };
  assert.equal(libraryPublishSchema.safeParse(publication).success, true);
  assert.equal(
    libraryPublishSchema.safeParse({ ...publication, publicContentConsent: false }).success,
    false,
  );
  assert.equal(
    libraryPublishSchema.safeParse({ ...publication, changeSummary: " " }).success,
    false,
  );
  assert.equal(
    libraryPublishSchema.safeParse({ ...publication, expectedUpdatedAt: "yesterday" }).success,
    false,
  );
  assert.equal(
    libraryInputSchema.safeParse({ ...input, sourceVersionId: randomUUID() }).success,
    false,
  );
});

test("a new draft is private and cannot be read, copied or hosted by another member", async () => {
  const draft = await service.createDraft(owner, input);
  assert.equal(draft.status, "draft");
  assert.equal(draft.publishedVersion, 0);
  assert.equal(draft.draftContent?.scenario, input.scenario);
  for (const actor of [null, reader]) {
    await assert.rejects(service.detail(actor, draft.id), code("NOT_FOUND"));
    assert.equal((await service.list(actor, {})).items.length, 0);
    await assert.rejects(service.versions(actor, draft.id, {}), code("NOT_FOUND"));
  }
  await assert.rejects(service.derive(reader, draft.id, {}), code("NOT_FOUND"));
  await assert.rejects(service.host(reader, draft.id, hosting()), code("NOT_FOUND"));
  await assert.rejects(
    service.saveDraft(reader, draft.id, { content: input, expectedUpdatedAt: draft.updatedAt }),
    code("NOT_FOUND"),
  );
  const changed = {
    ...input,
    title: "소유자가 수정한 비공개 초안",
    summary: "저장한 초안의 제목과 요약은 작성자에게 최신 편집 내용으로 표시합니다.",
    scenario:
      "PRIVATE-DRAFT-EDIT 소유자가 수정한 진행 순서와 준비 안내가 저장된 비공개 자료입니다.",
  };
  const saved = await revision(draft, changed);
  assert.equal(saved.title, changed.title);
  assert.equal(saved.summary, changed.summary);
  assert.equal(saved.payload?.scenario, changed.scenario);
  assert.deepEqual(saved.draftContent, changed);
  assert.equal(saved.publishedVersion, 0);
  assert.notEqual(saved.updatedAt, draft.updatedAt);
  await assert.rejects(
    service.saveDraft(owner, draft.id, { content: input, expectedUpdatedAt: draft.updatedAt }),
    code("CONFLICT"),
  );
  assert.equal((await db.select().from(libraryVersions)).length, 0);
});

test("editing a second draft keeps the first public revision visible until atomic publication", async () => {
  const first = await released();
  const next = {
    ...input,
    title: "두 번째 운영 자료",
    scenario: "VERSION-TWO-SECRET 첫 라운드의 시간을 늘리고 역할 카드의 배분을 개선합니다.",
  };
  const draft = await revision(first, next);
  const publicView = await service.detail(reader, first.id);
  assert.equal(publicView.publishedVersion, 1);
  assert.equal(publicView.title, input.title);
  assert.equal(publicView.payload?.scenario, input.scenario);
  assert.equal(publicView.draftContent, null);
  assert.equal(JSON.stringify(publicView).includes("VERSION-TWO-SECRET"), false);
  assert.equal((await service.detail(owner, first.id)).draftContent?.scenario, next.scenario);
  await assert.rejects(
    service.publish(owner, first.id, {
      expectedUpdatedAt: first.updatedAt,
      changeSummary: "예전 화면의 발행",
      publicContentConsent: true,
    }),
    code("CONFLICT"),
  );
  const second = await publish(draft, "첫 라운드의 시간과 역할 카드 배분 개선");
  assert.equal(second.publishedVersion, 2);
  assert.equal(second.title, next.title);
  assert.equal(second.payload?.scenario, next.scenario);
  assert.equal(second.draftContent, null);
  const old = await service.version(reader, first.id, 1);
  assert.equal(old.payload?.scenario, input.scenario);
  const history = await service.versions(reader, first.id, {});
  assert.deepEqual(
    history.items.map((item) => item.number),
    [2, 1],
  );
  assert.equal(history.items[0]?.changeSummary, "첫 라운드의 시간과 역할 카드 배분 개선");
  assert.equal(JSON.stringify(history).includes("VERSION-ONE-SECRET"), false);
  await assert.rejects(
    service.publish(owner, first.id, {
      expectedUpdatedAt: draft.updatedAt,
      changeSummary: "중복 발행 시도",
      publicContentConsent: true,
    }),
    code("CONFLICT"),
  );
  assert.equal((await db.select().from(libraryVersions)).length, 2);
  const [original] = await db.select().from(libraryVersions).where(eq(libraryVersions.number, 1));
  await assert.rejects(
    db.update(libraryVersions).set({ content: next }).where(eq(libraryVersions.id, original!.id)),
  );
  assert.equal((await service.version(reader, first.id, 1)).content?.scenario, input.scenario);
});

test("a free current edition cannot unlock the paid payload of an earlier edition", async () => {
  const paid = {
    ...input,
    priceKRW: 15000,
    purchaseUrl: "https://example.com/paid-v1",
    allowDerivatives: true,
  };
  const first = await released(paid);
  const second = await publish(
    await revision(first, {
      ...input,
      scenario: "FREE-VERSION-TWO 공개된 무료 라운드 운영 방법과 준비물을 소개합니다.",
      allowDerivatives: true,
    }),
    "별도의 무료 운영판 공개",
  );
  assert.equal(
    (await service.detail(reader, second.id)).payload?.scenario.includes("FREE-VERSION-TWO"),
    true,
  );
  for (const actor of [null, reader, buyer]) {
    const historical = await service.version(actor, second.id, 1);
    assert.equal(historical.content, null);
    assert.equal(historical.payload, null);
    assert.equal(historical.canDerive, false);
    assert.equal(JSON.stringify(historical).includes("VERSION-ONE-SECRET"), false);
  }
  assert.equal((await service.version(owner, second.id, 1)).payload?.scenario, paid.scenario);
  await assert.rejects(service.derive(reader, second.id, { version: 1 }), code("FORBIDDEN"));
  assert.ok((await service.derive(reader, second.id, { version: 2 })).draftContent);
});

test("derivative permission is read from the chosen publication and lineage survives later source edits", async () => {
  const first = await released();
  await assert.rejects(service.derive(reader, first.id, { version: 1 }), code("FORBIDDEN"));
  const secondContent = {
    ...input,
    allowDerivatives: true,
    scenario: "SHARED-VERSION-TWO 파생 작업을 허용하는 두 번째 발행본의 진행 시나리오입니다.",
  };
  const second = await publish(
    await revision(first, secondContent),
    "파생 자료 이용 허용 및 미션 개선",
  );
  await assert.rejects(service.derive(reader, first.id, { version: 1 }), code("FORBIDDEN"));
  const source = await service.version(reader, second.id, 2);
  const derived = await service.derive(reader, second.id, { version: 2 });
  assert.equal(derived.status, "draft");
  assert.equal(derived.sourceVersionId, source.id);
  assert.equal(derived.draftContent?.scenario, secondContent.scenario);
  await assert.rejects(service.detail(owner, derived.id), code("NOT_FOUND"));
  const third = await publish(
    await revision(second, {
      ...input,
      scenario: "VERSION-THREE 다시 개선한 규칙과 시간을 적용한 세 번째 발행본입니다.",
    }),
    "미션 분량과 시간 조정",
  );
  assert.equal(third.publishedVersion, 3);
  const stable = await service.detail(reader, derived.id);
  assert.equal(stable.sourceVersionId, source.id);
  assert.equal(stable.draftContent?.scenario, secondContent.scenario);
  assert.equal((await service.version(reader, second.id, 2)).allowDerivatives, true);
});

test("a paid source requires its own approval for derivation and revocation removes that permission", async () => {
  const entry = await released({
    ...input,
    allowDerivatives: true,
    priceKRW: 15000,
    purchaseUrl: "https://example.com/purchase",
  });
  await assert.rejects(service.derive(buyer, entry.id, {}), code("FORBIDDEN"));
  await service.requestAccess(buyer, entry.id, {
    externalReference: "VERSION-PAID-ONE",
    note: "구매 확인",
    consent: true,
  });
  const [person] = await db
    .select({ publicId: schema.profiles.publicId })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, buyer));
  await service.decideAccess(owner, entry.id, {
    userPublicId: person!.publicId,
    decision: "approve",
    paymentChecked: true,
    note: "외부 구매 확인",
  });
  assert.equal((await service.version(buyer, entry.id, 1)).canDerive, true);
  const draft = await service.derive(buyer, entry.id, {});
  assert.equal(draft.sourceVersionId, (await service.version(owner, entry.id, 1)).id);
  await service.decideAccess(owner, entry.id, {
    userPublicId: person!.publicId,
    decision: "revoke",
    paymentChecked: false,
    note: "외부 환불 완료",
  });
  assert.equal((await service.version(buyer, entry.id, 1)).payload, null);
  await assert.rejects(service.derive(buyer, entry.id, {}), code("FORBIDDEN"));
  await assert.rejects(
    service.publish(buyer, draft.id, {
      expectedUpdatedAt: draft.updatedAt,
      changeSummary: "구매 권한 회수 이후 발행 시도",
      publicContentConsent: true,
    }),
    code("FORBIDDEN"),
  );
  assert.equal((await service.versions(buyer, draft.id, {})).total, 0);
});

test("event creation respects commercial conditions and freezes the exact released version", async () => {
  const first = await released();
  await assert.rejects(service.host(reader, first.id, hosting(15000)), code("FORBIDDEN"));
  const eventOne = await service.host(reader, first.id, hosting());
  const sourceOne = await service.version(owner, first.id, 1);
  const guideOne = await service.eventTemplate(reader, eventOne.postId);
  assert.equal(guideOne?.versionId, sourceOne.id);
  assert.equal(guideOne?.versionNumber, 1);
  assert.equal(guideOne?.usageTerms, input.usageTerms);
  const secondContent = {
    ...input,
    allowCommercialUse: true,
    scenario: "PAID-EVENT-VERSION-TWO 유료로 운영할 수 있도록 조건과 시나리오를 개선합니다.",
  };
  const second = await publish(await revision(first, secondContent), "유료 행사 운영 조건 추가");
  const eventTwo = await service.host(reader, second.id, hosting(15000));
  const guideTwo = await service.eventTemplate(reader, eventTwo.postId);
  assert.equal(guideTwo?.versionId, (await service.version(owner, first.id, 2)).id);
  assert.equal(guideTwo?.versionNumber, 2);
  assert.equal(guideTwo?.scenario, secondContent.scenario);
  assert.equal((await service.eventTemplate(reader, eventOne.postId))?.scenario, input.scenario);
  assert.equal((await service.eventTemplate(reader, eventOne.postId))?.versionId, sourceOne.id);
  await assert.rejects(service.eventTemplate(buyer, eventOne.postId), code("FORBIDDEN"));
});

test("legacy execution guides retain their original snapshots without guessing a release version", async () => {
  const entry = await released();
  const [event] = await db
    .insert(schema.posts)
    .values({
      authorId: reader,
      kind: "모집",
      categorySlug: "mind-games",
      title: "기존 실행 자료",
      bodyMarkdown: "버전 도입 전에 실행했던 자료 스냅샷을 보존하는 행사입니다.",
    })
    .returning();
  const snapshot = {
    ...input,
    category: input.categorySlug,
    sourceId: entry.id,
    author: "이전 자료 작성자",
    authorPublicId: null,
    scenario: "LEGACY-EXECUTION 원래 행사에서 사용한 구버전 자료의 진행 시나리오입니다.",
  };
  await db.insert(templateProvenance).values({ postId: event!.id, entryId: entry.id, snapshot });
  const legacy = await service.eventTemplate(reader, event!.id);
  assert.equal(legacy?.scenario, snapshot.scenario);
  assert.equal(legacy?.versionId ?? null, null);
  assert.equal(legacy?.versionNumber ?? null, null);
  assert.equal(
    (await db.select().from(templateProvenance).where(eq(templateProvenance.postId, event!.id)))[0]
      ?.versionId,
    null,
  );
});

test("moderation hides every version, download, derivative and event-creation path", async () => {
  const entry = await released({ ...input, allowDerivatives: true });
  await db
    .insert(contentRestrictions)
    .values({ targetType: "library", targetId: entry.id, hidden: true, reason: "운영 검토" });
  for (const actor of [null, reader, owner]) {
    await assert.rejects(service.detail(actor, entry.id), code("NOT_FOUND"));
    await assert.rejects(service.version(actor, entry.id, 1), code("NOT_FOUND"));
    await assert.rejects(service.versions(actor, entry.id, {}), code("NOT_FOUND"));
    await assert.rejects(service.download(actor, entry.id), code("NOT_FOUND"));
  }
  assert.equal((await service.list(reader, {})).items.length, 0);
  await assert.rejects(service.derive(reader, entry.id, {}), code("NOT_FOUND"));
  await assert.rejects(service.host(reader, entry.id, hosting()), code("NOT_FOUND"));
});

test("mutual member blocks apply to version details, copies and new events", async () => {
  const entry = await released({ ...input, allowDerivatives: true });
  for (const [blockerId, blockedId] of [
    [reader, owner],
    [owner, reader],
  ]) {
    await db
      .insert(memberBlocks)
      .values({ blockerId: blockerId!, blockedId: blockedId!, displayLabel: "검증" });
    await assert.rejects(service.version(reader, entry.id, 1), code("NOT_FOUND"));
    await assert.rejects(service.versions(reader, entry.id, {}), code("NOT_FOUND"));
    await assert.rejects(service.derive(reader, entry.id, {}), code("NOT_FOUND"));
    await assert.rejects(service.host(reader, entry.id, hosting()), code("NOT_FOUND"));
    assert.equal((await service.list(reader, {})).items.length, 0);
    await db.delete(memberBlocks);
  }
});

test("closed authors disappear and restricted actors cannot publish or copy stored private content", async () => {
  const entry = await released({ ...input, allowDerivatives: true });
  await db.insert(memberSafety).values({ userId: owner, status: "closed", reason: "탈퇴" });
  for (const actor of [null, reader]) {
    await assert.rejects(service.version(actor, entry.id, 1), code("NOT_FOUND"));
    await assert.rejects(service.detail(actor, entry.id), code("NOT_FOUND"));
    assert.equal((await service.list(actor, {})).items.length, 0);
  }
  await assert.rejects(service.createDraft(owner, input), code("FORBIDDEN"));
  await db.delete(memberSafety).where(eq(memberSafety.userId, owner));
  await db.insert(memberSafety).values({ userId: reader, status: "closed", reason: "탈퇴" });
  await assert.rejects(service.derive(reader, entry.id, {}), code("FORBIDDEN"));
  await assert.rejects(service.host(reader, entry.id, hosting()), code("FORBIDDEN"));
});

test("hosting a legacy published entry freezes an explicit baseline version without altering content", async () => {
  const [legacy] = await db
    .insert(libraryEntries)
    .values({ ...input, ownerId: owner, status: "published", publishedVersion: 0 })
    .returning();
  const entryId = legacy!.id;
  assert.equal((await service.versions(owner, entryId, {})).total, 0);
  const event = await service.host(reader, entryId, hosting());
  const baseline = await service.version(owner, entryId, 1);
  const guide = await service.eventTemplate(reader, event.postId);
  assert.equal(baseline.legacy, true);
  assert.deepEqual(baseline.content, input);
  assert.equal(guide?.versionId, baseline.id);
  assert.equal(guide?.versionNumber, 1);
  assert.equal(guide?.scenario, input.scenario);
  assert.equal((await service.detail(reader, entryId)).publishedVersion, 1);
  const repeated = await service.host(reader, entryId, hosting());
  assert.equal((await service.eventTemplate(reader, repeated.postId))?.versionId, baseline.id);
  assert.equal((await service.versions(owner, entryId, {})).total, 1);
});

test("the first edit of a legacy entry preserves its original baseline before publishing version two", async () => {
  const [legacy] = await db
    .insert(libraryEntries)
    .values({ ...input, ownerId: owner, status: "published", publishedVersion: 0 })
    .returning();
  const original = await service.detail(owner, legacy!.id);
  const revised = {
    ...input,
    title: "기존 자료의 개선판",
    scenario: "LEGACY-EDIT-VERSION-TWO 기존 발행 자료를 보존하면서 새롭게 개선한 운영 방법입니다.",
  };
  const draft = await revision(original, revised);
  assert.equal((await service.detail(reader, original.id)).payload?.scenario, input.scenario);
  const updated = await publish(draft, "버전 도입 이후 첫 운영 자료 개선");
  assert.equal(updated.publishedVersion, 2);
  assert.equal(updated.payload?.scenario, revised.scenario);
  const baseline = await service.version(reader, original.id, 1);
  assert.equal(baseline.legacy, true);
  assert.deepEqual(baseline.content, input);
  assert.equal((await service.version(reader, original.id, 2)).legacy, false);
  assert.equal((await service.versions(reader, original.id, {})).total, 2);
});

test("structured plans survive draft publication, past versions, derivatives and frozen event guides", async () => {
  const eventPlan = structuredClone(COEX_PLAYBOOK_EXAMPLE.eventPlan!);
  const content = { ...input, allowDerivatives: true, eventPlan };
  const draft = await service.createDraft(owner, content);
  assert.deepEqual(draft.draftContent?.eventPlan, eventPlan);
  await assert.rejects(service.detail(reader, draft.id), code("NOT_FOUND"));
  const first = await publish(draft);
  assert.deepEqual((await service.detail(reader, first.id)).payload?.eventPlan, eventPlan);
  assert.equal(first.recordedPlayers, 0);
  assert.equal(first.recordedEvents, 0);
  const event = await service.host(reader, first.id, hosting());
  assert.deepEqual((await service.eventTemplate(reader, event.postId))?.eventPlan, eventPlan);
  const changed = structuredClone(content);
  changed.eventPlan.missions[0]!.rules =
    "V2-MISSION 규칙이 바뀐 뒤에도 기존 발행판과 실제 행사 가이드는 보존됩니다.";
  changed.eventPlan.budget[0]!.amountKRW = 8000;
  const secondDraft = await revision(first, changed);
  assert.deepEqual((await service.detail(reader, first.id)).payload?.eventPlan, eventPlan);
  const second = await publish(secondDraft, "첫 미션과 소품 예산 조정");
  assert.deepEqual(second.payload?.eventPlan, changed.eventPlan);
  assert.deepEqual((await service.version(reader, first.id, 1)).payload?.eventPlan, eventPlan);
  assert.deepEqual((await service.eventTemplate(reader, event.postId))?.eventPlan, eventPlan);
  const derived = await service.derive(reader, first.id, { version: 1 });
  assert.deepEqual(derived.draftContent?.eventPlan, eventPlan);
  const cleared = await publish(
    await revision(second, { ...content, eventPlan: null }),
    "구조화 항목 제거",
  );
  assert.equal(cleared.payload?.eventPlan ?? null, null);
  assert.deepEqual(
    (await service.version(reader, first.id, 2)).payload?.eventPlan,
    changed.eventPlan,
  );
  assert.deepEqual((await service.eventTemplate(reader, event.postId))?.eventPlan, eventPlan);
});

test("paid structured missions and budgets obey purchase approval and never leak through list metadata", async () => {
  const eventPlan = structuredClone(COEX_PLAYBOOK_EXAMPLE.eventPlan!);
  eventPlan.planningIntent = "PAID-PLAN-SECRET 비공개 유료 운영 계획의 기획 의도입니다.";
  const entry = await released({
    ...input,
    eventPlan,
    priceKRW: 12000,
    purchaseUrl: "https://example.com/plan",
  });
  for (const actor of [null, reader, buyer]) {
    const detail = await service.detail(actor, entry.id);
    assert.equal(detail.payload, null);
    assert.equal(detail.draftContent, null);
    assert.equal((await service.version(actor, entry.id, 1)).payload, null);
    const exposed = JSON.stringify([
      detail,
      await service.list(actor, {}),
      await service.versions(actor, entry.id, {}),
    ]);
    assert.equal(exposed.includes("PAID-PLAN-SECRET"), false);
    assert.equal(exposed.includes("eventPlan"), false);
    await assert.rejects(service.download(actor, entry.id), code("FORBIDDEN"));
  }
  await service.requestAccess(buyer, entry.id, {
    externalReference: "PLAN-PURCHASE",
    note: "자료 구매",
    consent: true,
  });
  const [person] = await db
    .select({ publicId: schema.profiles.publicId })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, buyer));
  await service.decideAccess(owner, entry.id, {
    userPublicId: person!.publicId,
    decision: "approve",
    paymentChecked: true,
    note: "구매 확인",
  });
  assert.deepEqual((await service.detail(buyer, entry.id)).payload?.eventPlan, eventPlan);
  assert.deepEqual((await service.version(buyer, entry.id, 1)).payload?.eventPlan, eventPlan);
  const file = await service.download(buyer, entry.id);
  assert.ok(JSON.stringify(file).includes("PAID-PLAN-SECRET"));
  assert.ok(JSON.stringify(file).includes("9,000원"));
  await service.decideAccess(owner, entry.id, {
    userPublicId: person!.publicId,
    decision: "revoke",
    paymentChecked: false,
    note: "환불 완료",
  });
  assert.equal((await service.detail(buyer, entry.id)).payload, null);
  await assert.rejects(service.download(buyer, entry.id), code("FORBIDDEN"));
});
