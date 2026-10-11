import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  libraryEntries,
  libraryAccessRequests,
  templateProvenance,
} from "../src/db/library-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { libraryInputSchema, libraryListSchema, templateHostSchema } from "../src/domain/library";
import { libraryService } from "../src/server/library-service";
import { AppError } from "../src/server/errors";
import { playerService } from "../src/server/player-service";
import { eventOperationsService } from "../src/server/event-operations-service";
import { eventLifecycleService } from "../src/server/event-lifecycle-service";
import { contentRestrictions, memberBlocks, memberSafety } from "../src/db/safety-schema";
const pg = new PGlite(),
  db = drizzle(pg, { schema }),
  service = libraryService(db as unknown as Database);
const code = (expected: string) => (e: unknown) => e instanceof AppError && e.code === expected;
let owner: string, buyer: string, outsider: string;
const input = {
  kind: "template" as const,
  categorySlug: "mind-games" as const,
  title: "블라인드 미션 룰북",
  summary: "서로의 정체를 추리하고 마지막 미션에서 정답을 확인하는 실내 게임입니다.",
  scenario: "비공개 시나리오: 각자 역할 카드를 받아 협상과 추리로 팀의 비밀을 찾아냅니다.",
  rules: "비공개 규칙: 상대 역할 카드를 훔쳐볼 수 없고 정해진 라운드 안에 토론합니다.",
  materials: ["비공개 역할 카드 8장", "필기구"],
  hostGuide: "비공개 멘트: 첫 번째 미션이 시작됩니다. 서로의 이야기에서 단서를 찾아보세요.",
  minPlayers: 4,
  maxPlayers: 12,
  durationMinutes: 90,
  rounds: [{ name: "첫 미션", seconds: 300 }],
  tags: ["추리", "실내"],
  priceKRW: 0,
  purchaseUrl: null,
  allowCommercialUse: true,
};
const paid = { ...input, priceKRW: 10000, purchaseUrl: "https://example.com/buy" };
const claim = { externalReference: "PURCHASE-ONE", note: "구매를 완료했어요.", consent: true };
function hosting() {
  const start = new Date(Date.now() + 10 * 86400000);
  return {
    title: "친구들과 추리 게임",
    location: "서울 테스트 모임 장소",
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 90 * 60000).toISOString(),
    amountKRW: 15000,
    capacity: 8,
    applicationUrl: "https://example.com/apply",
    description: "우리끼리 즐기는 추리 파티입니다. 준비물과 자세한 안내는 공지방에서 안내할게요.",
  };
}
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(schema.profiles).values({
    id,
    nickname,
    phoneNumber: "01012345678",
    profileCompletedAt: new Date(),
    onboardingConsentAt: new Date(),
  });
  return id;
}
async function publicId(id: string) {
  const [p] = await db
    .select({ publicId: schema.profiles.publicId })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, id));
  return p!.publicId;
}
async function update(actor: string, id: string, content: unknown) {
  const revision = await service.detail(owner, id);
  return service.update(actor, id, { content, expectedUpdatedAt: revision.updatedAt });
}
before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("원저작자");
  buyer = await member("예비호스트");
  outsider = await member("다른유저");
});
after(() => pg.close());
test("library validation rejects forged ownership, verification, prices, unsafe links and invalid round settings", () => {
  assert.equal(libraryInputSchema.safeParse({ ...input, ownerId: owner }).success, false);
  assert.equal(libraryInputSchema.safeParse({ ...input, verified: true }).success, false);
  assert.equal(libraryInputSchema.safeParse({ ...paid, purchaseUrl: null }).success, false);
  assert.equal(
    libraryInputSchema.safeParse({ ...paid, purchaseUrl: "javascript:alert(1)" }).success,
    false,
  );
  assert.equal(
    libraryInputSchema.safeParse({ ...input, rounds: [{ name: "라운드", seconds: 0 }] }).success,
    false,
  );
  assert.equal(
    libraryInputSchema.safeParse({ ...input, minPlayers: 20, maxPlayers: 12 }).success,
    false,
  );
  assert.equal(
    templateHostSchema.safeParse({ ...hosting(), startsAt: "2026-12-10T12:00:00" }).success,
    false,
  );
  assert.equal(
    templateHostSchema.safeParse({ ...hosting(), endsAt: "2000-01-01T00:00:00Z" }).success,
    false,
  );
});
test("free archive CRUD keeps ownership server-side and allows guest download without exposing auth subjects", async () => {
  await assert.rejects(service.create(null, input), code("UNAUTHENTICATED"));
  const entry = await service.create(owner, { ...input, kind: "rulebook" });
  const guest = await service.detail(null, entry.id),
    list = await service.list(null, { kind: "rulebook" });
  assert.equal(guest.payload?.scenario, input.scenario);
  assert.equal(guest.canHost, false);
  assert.equal(guest.recordedEvents, 0);
  assert.equal(list.items.length, 1);
  assert.equal(JSON.stringify(list).includes(owner), false);
  assert.equal(JSON.stringify(list).includes(input.scenario), false);
  assert.match((await service.download(null, entry.id)).markdown, /비공개 역할 카드/);
  await assert.rejects(
    update(outsider, entry.id, { ...input, kind: "rulebook" }),
    code("FORBIDDEN"),
  );
  const revised = await update(owner, entry.id, {
    ...input,
    kind: "rulebook",
    title: "수정한 룰북",
  });
  assert.equal(revised.title, "수정한 룰북");
  await assert.rejects(service.remove(outsider, entry.id), code("FORBIDDEN"));
  await service.remove(owner, entry.id);
  await assert.rejects(service.detail(null, entry.id), code("NOT_FOUND"));
});
test("paid payload and download are inaccessible until owner checks an external purchase; approval is isolated per member", async () => {
  const entry = await service.create(owner, paid),
    guest = await service.detail(null, entry.id);
  assert.equal(guest.payload, null);
  assert.equal(JSON.stringify(guest).includes(input.scenario), false);
  assert.equal(guest.purchaseUrl, paid.purchaseUrl);
  await assert.rejects(service.download(buyer, entry.id), code("FORBIDDEN"));
  await assert.rejects(service.host(buyer, entry.id, hosting()), code("FORBIDDEN"));
  await assert.rejects(service.requestAccess(buyer, entry.id, { ...claim, amountKRW: 0 }));
  await service.requestAccess(buyer, entry.id, claim);
  const pending = await service.detail(buyer, entry.id);
  assert.equal(pending.myAccess?.status, "pending");
  assert.equal(pending.payload, null);
  await assert.rejects(service.accessRequests(outsider, entry.id), code("FORBIDDEN"));
  const requests = await service.accessRequests(owner, entry.id);
  assert.equal(requests.items[0]?.userPublicId, await publicId(buyer));
  assert.equal(JSON.stringify(requests).includes(buyer), false);
  const approval = {
    userPublicId: await publicId(buyer),
    decision: "approve",
    paymentChecked: true,
    note: "외부 구매 확인",
  };
  await assert.rejects(
    service.decideAccess(owner, entry.id, { ...approval, paymentChecked: false }),
  );
  await assert.rejects(service.decideAccess(outsider, entry.id, approval), code("FORBIDDEN"));
  await service.decideAccess(owner, entry.id, approval);
  assert.equal((await service.detail(buyer, entry.id)).payload?.scenario, input.scenario);
  assert.equal((await service.detail(outsider, entry.id)).payload, null);
  assert.match((await service.download(buyer, entry.id)).markdown, /진행자 가이드/);
  await assert.rejects(update(owner, entry.id, { ...paid, priceKRW: 5000 }), code("CONFLICT"));
  await assert.rejects(service.remove(owner, entry.id), code("CONFLICT"));
  await service.decideAccess(owner, entry.id, {
    userPublicId: await publicId(buyer),
    decision: "revoke",
    paymentChecked: false,
    note: "외부 플랫폼 환불 완료",
  });
  assert.equal((await service.detail(buyer, entry.id)).payload, null);
  await assert.rejects(service.download(buyer, entry.id), code("FORBIDDEN"));
});
test("duplicate external purchase references cannot unlock several members; rejecting requests leaves no entitlement", async () => {
  const entry = await service.create(owner, paid);
  await service.requestAccess(buyer, entry.id, claim);
  await assert.rejects(service.requestAccess(outsider, entry.id, claim), code("CONFLICT"));
  assert.equal((await db.select().from(libraryAccessRequests)).length, 1);
  await service.decideAccess(owner, entry.id, {
    userPublicId: await publicId(buyer),
    decision: "reject",
    paymentChecked: false,
    note: "구매 번호 확인이 필요해요.",
  });
  assert.equal((await service.detail(buyer, entry.id)).myAccess?.status, "rejected");
  assert.equal((await service.detail(buyer, entry.id)).payload, null);
  await service.requestAccess(buyer, entry.id, {
    ...claim,
    externalReference: "PURCHASE-CORRECTED",
  });
  assert.equal((await service.detail(buyer, entry.id)).myAccess?.status, "pending");
});
test("template hosting atomically creates recruitment/settings/private guide; public recruitment cannot leak paid content", async () => {
  const entry = await service.create(owner, paid);
  await service.requestAccess(buyer, entry.id, claim);
  await service.decideAccess(owner, entry.id, {
    userPublicId: await publicId(buyer),
    decision: "approve",
    paymentChecked: true,
    note: "",
  });
  await assert.rejects(
    service.host(buyer, entry.id, { ...hosting(), capacity: 1 }),
    code("VALIDATION"),
  );
  assert.equal((await db.select().from(schema.posts)).length, 0);
  const result = await service.host(buyer, entry.id, hosting());
  const [post] = await db.select().from(schema.posts).where(eq(schema.posts.id, result.postId));
  const [settings] = await db
    .select()
    .from(schema.eventSettings)
    .where(eq(schema.eventSettings.postId, result.postId));
  assert.equal(post?.authorId, buyer);
  assert.equal(post?.kind, "모집");
  assert.equal(settings?.amountKRW, 15000);
  assert.equal(settings?.capacity, 8);
  assert.equal(settings?.refundPolicy, "sliper-v1");
  assert.ok(settings?.startsAt);
  assert.ok(settings?.endsAt);
  assert.equal(post?.bodyMarkdown.includes(input.scenario), false);
  assert.equal(post?.bodyMarkdown.includes(input.hostGuide), false);
  assert.equal(post?.bodyMarkdown.includes("원저작자"), true);
  await assert.rejects(service.eventTemplate(outsider, result.postId), code("FORBIDDEN"));
  const guide = await service.eventTemplate(buyer, result.postId);
  assert.equal(guide?.scenario, input.scenario);
  assert.equal(guide?.authorPublicId, await publicId(owner));
  assert.equal(JSON.stringify(guide).includes(owner), false);
  const edited = {
    ...paid,
    scenario: "수정된 새 시나리오입니다. 기존 행사의 규칙은 변하지 않아야 합니다.",
  };
  await update(owner, entry.id, edited);
  assert.equal((await service.eventTemplate(buyer, result.postId))?.scenario, input.scenario);
  await db.insert(schema.roomManagers).values({ postId: result.postId, userId: outsider });
  assert.equal((await service.eventTemplate(outsider, result.postId))?.scenario, input.scenario);
});
test("free template deletion preserves hosted event attribution and the original execution snapshot", async () => {
  const entry = await service.create(owner, input);
  const { postId } = await service.host(buyer, entry.id, hosting());
  await service.remove(owner, entry.id);
  assert.equal((await service.eventTemplate(buyer, postId))?.title, input.title);
  assert.equal((await db.select().from(templateProvenance)).length, 1);
  assert.equal((await db.select().from(libraryEntries))[0]?.status, "deleted");
});
test("unified archive accepts omitted kind and rejects unsupported list filters", () => {
  assert.equal(libraryListSchema.parse({}).kind, undefined);
  assert.equal(libraryListSchema.parse({ kind: "rulebook" }).kind, "rulebook");
  assert.equal(libraryListSchema.parse({ kind: "template" }).kind, "template");
  assert.equal(libraryListSchema.safeParse({ kind: "all" }).success, false);
  assert.equal(libraryListSchema.safeParse({ kind: "video" }).success, false);
});

test("unified archive applies type, category, search and member ownership filters to both kinds", async () => {
  const entries = [
    {
      ownerId: owner,
      kind: "rulebook" as const,
      categorySlug: "party" as const,
      title: "공유 파티 규칙",
    },
    {
      ownerId: owner,
      kind: "template" as const,
      categorySlug: "party" as const,
      title: "공유 파티 운영",
    },
    {
      ownerId: owner,
      kind: "template" as const,
      categorySlug: "mind-games" as const,
      title: "공유 추리 운영",
    },
    {
      ownerId: buyer,
      kind: "rulebook" as const,
      categorySlug: "party" as const,
      title: "공유 외부 규칙",
    },
    {
      ownerId: owner,
      kind: "template" as const,
      categorySlug: "party" as const,
      title: "다른 자료",
    },
  ];
  await db.insert(libraryEntries).values(entries.map((entry) => ({ ...input, ...entry })));
  const shared = await service.list(null, { search: "공유" });
  assert.equal(shared.items.length, 4);
  assert.deepEqual(
    new Set(shared.items.map((item) => item.kind)),
    new Set(["rulebook", "template"]),
  );
  for (const kind of ["rulebook", "template"] as const) {
    const filtered = await service.list(null, { search: "공유", kind });
    assert.equal(filtered.items.length, 2);
    assert.ok(filtered.items.every((item) => item.kind === kind));
  }
  const party = await service.list(null, { search: "공유", category: "party" });
  assert.equal(party.items.length, 3);
  assert.ok(party.items.every((item) => item.category === "party"));
  assert.deepEqual(
    (
      await service.list(owner, { search: "공유", category: "party", kind: "template", mine: true })
    ).items.map((item) => item.title),
    ["공유 파티 운영"],
  );
  assert.equal((await service.list(owner, { search: "공유", mine: true })).items.length, 3);
  const other = await service.list(buyer, { search: "공유", mine: true });
  assert.deepEqual(
    other.items.map((item) => item.title),
    ["공유 외부 규칙"],
  );
  assert.ok(other.items.every((item) => item.isMine));
  await assert.rejects(service.list(null, { mine: true }), code("UNAUTHENTICATED"));
});

test("mixed pagination returns each entry once and refuses cursors from another archive filter", async () => {
  const start = Date.UTC(2026, 0, 1);
  await db.insert(libraryEntries).values(
    Array.from({ length: 54 }, (_, index) => ({
      ...input,
      kind: index % 2 ? ("template" as const) : ("rulebook" as const),
      title: `자료 ${index}`,
      ownerId: owner,
      createdAt: new Date(start + index * 1000),
    })),
  );
  const first = await service.list(null, {});
  const second = await service.list(null, { cursor: first.nextCursor! });
  const third = await service.list(null, { cursor: second.nextCursor! });
  assert.deepEqual([first.items.length, second.items.length, third.items.length], [24, 24, 6]);
  assert.equal(first.items[0]?.title, "자료 53");
  assert.equal(first.items[1]?.title, "자료 52");
  assert.equal(
    new Set([...first.items, ...second.items, ...third.items].map((item) => item.id)).size,
    54,
  );
  assert.equal(third.nextCursor, null);
  const typed = await service.list(null, { kind: "template" });
  const typedNext = await service.list(null, { kind: "template", cursor: typed.nextCursor! });
  assert.deepEqual([typed.items.length, typedNext.items.length], [24, 3]);
  assert.equal(new Set([...typed.items, ...typedNext.items].map((item) => item.id)).size, 27);
  assert.ok([...typed.items, ...typedNext.items].every((item) => item.kind === "template"));
  for (const filter of [
    { kind: "rulebook" },
    { kind: "template" },
    { search: "다른검색" },
    { category: "party" },
    { mine: true },
  ]) {
    await assert.rejects(
      service.list(owner, { ...filter, cursor: first.nextCursor! }),
      code("VALIDATION"),
    );
  }
  await assert.rejects(service.list(null, { cursor: typed.nextCursor! }), code("VALIDATION"));
  await assert.rejects(
    service.list(null, { kind: "rulebook", cursor: typed.nextCursor! }),
    code("VALIDATION"),
  );
});

test("stale library edits cannot overwrite a newer revision", async () => {
  const entry = await service.create(owner, input);
  await service.update(owner, entry.id, {
    content: { ...input, title: "새로운 첫 수정" },
    expectedUpdatedAt: entry.updatedAt,
  });
  await assert.rejects(
    service.update(owner, entry.id, {
      content: { ...input, title: "예전 화면에서 저장" },
      expectedUpdatedAt: entry.updatedAt,
    }),
    code("CONFLICT"),
  );
  assert.equal((await service.detail(null, entry.id)).title, "새로운 첫 수정");
});

test("recorded play badges require completion and exclude unavailable events consistently", async () => {
  const entry = await service.create(owner, input),
    players = playerService(db as unknown as Database),
    operations = eventOperationsService(db as unknown as Database);
  async function finished(
    sample: boolean,
    presence: "attended" | "no_show",
    confirmCompletion = true,
  ) {
    const { postId } = await service.host(outsider, entry.id, {
      ...hosting(),
      amountKRW: 0,
      applicationUrl: null,
    });
    if (sample)
      await db.update(schema.posts).set({ sample: true }).where(eq(schema.posts.id, postId));
    await db
      .update(schema.eventSettings)
      .set({ startsAt: new Date("2020-01-01T01:00:00Z"), endsAt: new Date("2020-01-01T03:00:00Z") })
      .where(eq(schema.eventSettings.postId, postId));
    const [application] = await db
      .insert(schema.eventApplications)
      .values({
        postId,
        userId: buyer,
        attendeeName: "테스트 참가자",
        contact: "demo@example.invalid",
        amountKRW: 0,
        status: "confirmed",
        confirmedAt: new Date("2020-01-01T00:30:00Z"),
        expiresAt: new Date("2020-01-01T04:00:00Z"),
      })
      .returning({ id: schema.eventApplications.id });
    await players.recordResult(outsider, postId, {
      applicationId: application!.id,
      presence,
      outcome: "participated",
      observedRole: null,
    });
    if (confirmCompletion) {
      if (sample) {
        // Production finalization excludes demo records; only this fixture sets completion.
        await db
          .update(schema.eventSettings)
          .set({ completedAt: new Date(), completedBy: outsider })
          .where(eq(schema.eventSettings.postId, postId));
      } else await operations.finalize(outsider, postId);
    }
    return postId;
  }
  async function badges(actor: string | null, events: number, players: number) {
    const view = await service.detail(actor, entry.id),
      list = await service.list(actor, { kind: "template" });
    assert.equal(view.recordedEvents, events);
    assert.equal(view.recordedPlayers, players);
    assert.equal(list.items[0]?.recordedEvents, events);
    assert.equal(list.items[0]?.recordedPlayers, players);
  }
  const completed = await finished(false, "attended", false);
  await badges(null, 0, 0);
  await operations.finalize(outsider, completed);
  await operations.finalize(outsider, completed);
  await badges(null, 1, 1);
  await finished(true, "attended");
  await finished(false, "no_show");
  await badges(null, 1, 1);

  const cancelled = await service.host(outsider, entry.id, {
    ...hosting(),
    amountKRW: 0,
    applicationUrl: null,
  });
  await eventLifecycleService(db as unknown as Database).change(outsider, cancelled.postId, {
    kind: "cancel",
    expectedRevision: 0,
    confirmed: true,
    reason: "집계 제외 취소 행사",
  });
  await assert.rejects(operations.finalize(outsider, cancelled.postId), code("CONFLICT"));
  await badges(null, 1, 1);

  for (const targetType of ["post", "record"] as const) {
    await db.insert(contentRestrictions).values({
      targetType,
      targetId: completed,
      hidden: true,
      reason: "집계 제외 운영 검토",
    });
    await badges(null, 0, 0);
    await db.delete(contentRestrictions).where(eq(contentRestrictions.targetId, completed));
    await badges(null, 1, 1);
  }
  await assert.rejects(
    db.update(schema.posts).set({ status: "deleted" }).where(eq(schema.posts.id, completed)),
  );
  await badges(null, 1, 1);

  for (const [blockerId, blockedId] of [
    [owner, outsider],
    [outsider, owner],
  ]) {
    await db.insert(memberBlocks).values({
      blockerId: blockerId!,
      blockedId: blockedId!,
      displayLabel: "행사 주최자",
    });
    await badges(owner, 0, 0);
    await badges(null, 1, 1);
    await db.delete(memberBlocks);
  }
  await db.insert(memberSafety).values({ userId: outsider, status: "closed", reason: "탈퇴" });
  await badges(null, 0, 0);
});

test("downloads carry released versions, usage conditions and visible origin links", async () => {
  const content = {
      ...input,
      usageTerms: "출처를 표시하고 명시된 이용 범위 안에서 사용해주세요.",
      allowDerivatives: true,
      allowCommercialUse: false,
    },
    original = await service.create(owner, content),
    file = await service.download(null, original.id);
  assert.match(file.markdown, /자료 상태: v1/);
  assert.ok(file.markdown.includes(`/archive/${original.id}?version=1`));
  assert.ok(file.markdown.includes(content.usageTerms));
  assert.match(file.markdown, /파생 자료 제작: 허용/);
  assert.match(file.markdown, /상업적 이용: 허용하지 않음/);
  assert.equal(file.markdown.includes("원본 행사 기록"), false);

  const derived = await service.derive(buyer, original.id, {}),
    derivedFile = await service.download(buyer, derived.id);
  assert.match(derivedFile.markdown, /자료 상태: 초안 \(비공개\)/);
  assert.ok(derivedFile.markdown.includes(`파생 원본: [${original.title} · v1]`));
  assert.ok(derivedFile.markdown.includes(`/archive/${original.id}?version=1`));
  await assert.rejects(service.download(owner, derived.id), code("NOT_FOUND"));

  const privateDraft = await service.createDraft(owner, content),
    privateFile = await service.download(owner, privateDraft.id);
  assert.match(privateFile.markdown, /자료 상태: 초안 \(비공개\)/);
  assert.equal(privateFile.markdown.includes("현재 발행본"), false);
  await assert.rejects(service.download(null, privateDraft.id), code("NOT_FOUND"));

  await db.insert(contentRestrictions).values({
    targetType: "library",
    targetId: original.id,
    hidden: true,
    reason: "원본 출처 운영 검토",
  });
  const hiddenSource = await service.download(buyer, derived.id);
  assert.equal(hiddenSource.markdown.includes("파생 원본"), false);
  assert.equal(hiddenSource.markdown.includes(original.id), false);
});
