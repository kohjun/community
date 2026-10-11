import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import {
  librarySuggestions,
  libraryVersions,
  libraryAccessRequests,
} from "../src/db/library-schema";
import { contentRestrictions, memberBlocks, memberSafety } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { libraryInputSchema, type LibraryDetail } from "../src/domain/library";
import {
  suggestionInputSchema,
  suggestionDecisionSchema,
} from "../src/domain/library-collaboration";
import { libraryService } from "../src/server/library-service";
import { libraryCollaborationService } from "../src/server/library-collaboration-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
const library = libraryService(connection),
  service = libraryCollaborationService(connection);
let owner: string, reader: string, other: string, entry: LibraryDetail;
const input = libraryInputSchema.parse({
  kind: "rulebook",
  categorySlug: "knowledge",
  title: "협업으로 개선하는 추리 룰북",
  summary: "운영 경험을 반영하고 원본 버전을 보존하는 검증용 룰북입니다.",
  scenario:
    "PRIVATE-BASE-SCENARIO 역할을 정하고 참가자들이 서로 협력해 단서를 찾아내는 게임입니다.",
  rules: "원본 규칙입니다. 참가자는 자기 역할 카드를 다른 사람에게 보여줄 수 없습니다.",
  hostGuide: "진행자는 시간을 알려주고 각 팀의 토론이 끝나면 단서를 함께 공개합니다.",
  materials: ["역할 카드"],
  rounds: [{ name: "추리", seconds: 300 }],
  tags: ["추리"],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  priceKRW: 0,
  purchaseUrl: null,
});
const proposal = {
  version: 1,
  field: "rules" as const,
  replacement:
    "PRIVATE-PROPOSED-RULE 팀별 단서를 순서대로 공개하고 모든 참가자에게 같은 시간을 줍니다.",
  reason: "실제 진행에서 참가자별 시간 차이가 발생해 동일한 시간 규칙을 제안합니다.",
  consent: true as const,
};
const code = (c: string) => (e: unknown) => e instanceof AppError && e.code === c;
async function member(name: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(schema.profiles).values({ id, nickname: name });
  return id;
}
async function approve(id: string, at: string, libraryAt = entry.updatedAt) {
  return service.decide(owner, entry.id, id, {
    decision: "approve",
    expectedUpdatedAt: at,
    expectedLibraryUpdatedAt: libraryAt,
    note: "동일한 시간 규칙으로 개선",
    publicContentConsent: true,
  });
}
async function post(
  author = reader,
  category: "knowledge" | "lab" | "party" = "knowledge",
  anonymous = false,
) {
  const [p] = await db
    .insert(schema.posts)
    .values({
      authorId: author,
      categorySlug: category,
      kind: "이야기",
      title: "규칙 개선을 위한 연구 이야기",
      bodyMarkdown: "PRIVATE-POST-BODY 행사 운영 내용을 분석한 이야기입니다.",
      isAnonymous: anonymous,
    })
    .returning();
  return p!;
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  owner = await member("룰북 작성자");
  reader = await member("개선 제안자");
  other = await member("다른 회원");
  entry = await library.create(owner, input);
});
after(() => pg.close());
test("strict proposal schemas protect price, rights, source identity and publication consent", () => {
  assert.equal(suggestionInputSchema.safeParse({ ...proposal, priceKRW: 0 }).success, false);
  assert.equal(
    suggestionInputSchema.safeParse({ ...proposal, field: "usageTerms" }).success,
    false,
  );
  assert.equal(suggestionInputSchema.safeParse({ ...proposal, consent: false }).success, false);
  assert.equal(
    suggestionDecisionSchema.safeParse({
      decision: "approve",
      note: "승인합니다",
      expectedUpdatedAt: new Date().toISOString(),
    }).success,
    false,
  );
});
test("proposals are private and immutable until author approval appends the exact edition", async () => {
  const s = await service.propose(reader, entry.id, proposal);
  assert.equal((await library.detail(reader, entry.id)).payload!.rules, input.rules);
  assert.equal((await service.list(other, entry.id)).total, 0);
  await assert.rejects(service.detail(other, entry.id, s.id), code("NOT_FOUND"));
  const listed = JSON.stringify(await service.list(owner, entry.id));
  assert.equal(listed.includes(proposal.replacement), false);
  assert.equal(listed.includes(proposal.reason), false);
  assert.equal(listed.includes(reader), false);
  const decided = await approve(s.id, s.updatedAt);
  assert.equal(decided.items[0]!.status, "approved");
  const v1 = await library.version(owner, entry.id, 1),
    v2 = await library.version(owner, entry.id, 2);
  assert.equal(v1.content!.rules, input.rules);
  assert.equal(v2.content!.rules, proposal.replacement);
  assert.equal(v2.content!.scenario, input.scenario);
  assert.equal(v2.content!.priceKRW, input.priceKRW);
  assert.equal((await service.detail(reader, entry.id, s.id)).publishedVersion, 2);
  await assert.rejects(approve(s.id, s.updatedAt), code("CONFLICT"));
  assert.equal((await library.versions(owner, entry.id)).total, 2);
});
test("membership, both-way blocks and moderation apply to proposal APIs", async () => {
  await assert.rejects(service.list(null, entry.id), code("UNAUTHENTICATED"));
  await assert.rejects(service.propose(randomUUID(), entry.id, proposal), code("FORBIDDEN"));
  await db
    .insert(memberBlocks)
    .values({ blockerId: owner, blockedId: reader, displayLabel: "차단" });
  await assert.rejects(service.propose(reader, entry.id, proposal), code("NOT_FOUND"));
  await db.delete(memberBlocks);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "library", targetId: entry.id, reason: "자료 검토" });
  await assert.rejects(service.list(reader, entry.id), code("NOT_FOUND"));
  await db.delete(contentRestrictions);
  await db.insert(memberSafety).values({ userId: owner, status: "closed" });
  await assert.rejects(service.list(reader, entry.id), code("NOT_FOUND"));
});
test("duplicate proposals, invalid short fields and self-proposals cannot alter the source", async () => {
  await assert.rejects(service.propose(owner, entry.id, proposal), code("VALIDATION"));
  await assert.rejects(
    service.propose(reader, entry.id, { ...proposal, field: "summary", replacement: "짧음" }),
  );
  await service.propose(reader, entry.id, proposal);
  await assert.rejects(service.propose(reader, entry.id, proposal), code("CONFLICT"));
  assert.equal((await library.detail(owner, entry.id)).publishedVersion, 1);
});
test("only the author rejects and only the proposer withdraws; neither creates an edition", async () => {
  const s = await service.propose(reader, entry.id, proposal);
  await assert.rejects(
    service.decide(reader, entry.id, s.id, {
      decision: "reject",
      expectedUpdatedAt: s.updatedAt,
      note: "반려 시도",
    }),
    code("FORBIDDEN"),
  );
  await assert.rejects(
    service.decide(owner, entry.id, s.id, {
      decision: "withdraw",
      expectedUpdatedAt: s.updatedAt,
      note: "철회 시도",
    }),
    code("FORBIDDEN"),
  );
  await service.decide(reader, entry.id, s.id, {
    decision: "withdraw",
    expectedUpdatedAt: s.updatedAt,
    note: "제안 철회",
  });
  const again = await service.propose(reader, entry.id, proposal);
  await service.decide(owner, entry.id, again.id, {
    decision: "reject",
    expectedUpdatedAt: again.updatedAt,
    note: "현재 운영 방식 유지",
  });
  assert.equal((await library.versions(owner, entry.id)).total, 1);
});
test("drafts, stale bases and mismatched revisions prevent overwrite and keep pending proposals", async () => {
  const s = await service.propose(reader, entry.id, proposal);
  const staleAt = new Date(0).toISOString();
  await assert.rejects(approve(s.id, staleAt), code("CONFLICT"));
  await assert.rejects(approve(s.id, s.updatedAt, staleAt), code("CONFLICT"));
  assert.equal((await library.detail(owner, entry.id)).draftContent, null);
  assert.equal((await library.versions(owner, entry.id)).total, 1);
  const draft = await library.saveDraft(owner, entry.id, {
    content: { ...input, scenario: input.scenario + " 다른 초안" },
    expectedUpdatedAt: entry.updatedAt,
  });
  await assert.rejects(approve(s.id, s.updatedAt, draft.updatedAt), code("CONFLICT"));
  const published = await library.publish(owner, entry.id, {
    expectedUpdatedAt: draft.updatedAt,
    changeSummary: "별도 변경 발행",
    publicContentConsent: true,
  });
  await assert.rejects(approve(s.id, s.updatedAt, published.updatedAt), code("CONFLICT"));
  assert.equal((await service.detail(reader, entry.id, s.id)).stale, true);
  assert.equal((await service.list(owner, entry.id)).items[0]!.status, "pending");
  assert.equal((await library.version(owner, entry.id, 2)).content!.rules, input.rules);
});
test("paid version entitlement is enforced after revocation without trapping proposal withdrawal", async () => {
  entry = await library.create(owner, {
    ...input,
    priceKRW: 1000,
    purchaseUrl: "https://example.invalid/buy",
  });
  await assert.rejects(service.propose(reader, entry.id, proposal), code("FORBIDDEN"));
  await db.insert(libraryAccessRequests).values({
    entryId: entry.id,
    userId: reader,
    externalReference: "TEST-PAID-ACCESS",
    amountKRW: 1000,
    status: "approved",
  });
  const s = await service.propose(reader, entry.id, proposal);
  await db.update(libraryAccessRequests).set({ status: "revoked" });
  await assert.rejects(service.detail(reader, entry.id, s.id), code("FORBIDDEN"));
  assert.equal((await service.list(reader, entry.id)).canPropose, false);
  const response = await service.decide(reader, entry.id, s.id, {
    decision: "withdraw",
    expectedUpdatedAt: s.updatedAt,
    note: "제안 철회",
  });
  assert.equal(response.items[0]!.status, "withdrawn");
});
test("knowledge and research links retain an exact version, protect anonymous identity and do not grant paid access", async () => {
  const p = await post(reader, "lab", true);
  await service.link(reader, entry.id, { postId: p.id, version: 1 });
  await service.link(reader, entry.id, { postId: p.id, version: 1 });
  const page = await service.list(other, entry.id);
  assert.equal(page.discussions.length, 1);
  assert.equal(page.discussions[0]!.author, "익명");
  assert.equal(JSON.stringify(page).includes(reader), false);
  assert.equal((await service.postLinks(other, p.id))[0]!.version, 1);
  await assert.rejects(
    service.link(other, entry.id, { postId: p.id, version: 1 }),
    code("FORBIDDEN"),
  );
  const unrelated = await post(reader, "party");
  await assert.rejects(
    service.link(reader, entry.id, { postId: unrelated.id, version: 1 }),
    code("NOT_FOUND"),
  );
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: p.id, reason: "이야기 숨김" });
  assert.equal((await service.list(owner, entry.id)).discussions.length, 0);
  await assert.rejects(service.postLinks(other, p.id), code("NOT_FOUND"));
  await db.delete(contentRestrictions);
  await service.link(owner, entry.id, { postId: p.id, version: 1 }, true);
  assert.equal((await service.postLinks(other, p.id)).length, 0);
  await db.update(schema.posts).set({ authorId: null }).where(eq(schema.posts.id, p.id));
  await assert.rejects(
    service.link(owner, entry.id, { postId: p.id, version: 1 }),
    code("NOT_FOUND"),
  );
  await assert.rejects(service.postLinks(other, p.id), code("NOT_FOUND"));
});
test("database guards freeze submitted text, prevent forged approval and protect browser roles", async () => {
  const s = await service.propose(reader, entry.id, proposal);
  await assert.rejects(
    db
      .update(librarySuggestions)
      .set({ replacement: "바꾼 제안입니다" })
      .where(eq(librarySuggestions.id, s.id)),
  );
  await assert.rejects(
    db
      .update(librarySuggestions)
      .set({
        status: "approved",
        decidedBy: reader,
        decidedAt: new Date(),
        publishedVersionId: (await db.select().from(libraryVersions))[0]!.id,
      })
      .where(eq(librarySuggestions.id, s.id)),
  );
  for (const role of ["anon", "authenticated"]) {
    await pg.exec(`set role ${role}`);
    try {
      await assert.rejects(pg.query("select * from sliper.library_suggestions"));
      await assert.rejects(pg.query("select * from sliper.library_discussion_links"));
    } finally {
      await pg.exec("reset role");
    }
  }
  assert.equal((await db.select().from(librarySuggestions))[0]!.status, "pending");
});
test("proposal pagination is bounded and detail access selects the requested proposal only", async () => {
  for (let i = 0; i < 21; i++) {
    const user = await member("제안자" + i);
    await service.propose(user, entry.id, { ...proposal, reason: proposal.reason + i });
  }
  const first = await service.list(owner, entry.id),
    second = await service.list(owner, entry.id, { page: 2 });
  assert.equal(first.total, 21);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 1);
  assert.equal(first.pageCount, 2);
  const all = new Set([...first.items, ...second.items].map((s) => s.id));
  assert.equal(all.size, 21);
  assert.equal(
    (await service.detail(owner, entry.id, second.items[0]!.id)).id,
    second.items[0]!.id,
  );
});
