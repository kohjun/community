import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { posts, eventSettings, eventRecords } from "../src/db/schema";
import { libraryEntries, libraryVersions, templateProvenance } from "../src/db/library-schema";
import { eventCredits, eventRecordLinks } from "../src/db/records-schema";
import { eventResults } from "../src/db/player-schema";
import { eventChanges, eventLifecycle } from "../src/db/event-lifecycle-schema";
import { contentRestrictions } from "../src/db/safety-schema";
import type { ActionResult } from "../src/domain/contracts";
import type { AftercarePage } from "../src/domain/event-aftercare";
import type { LibraryDetail, TemplateSnapshot } from "../src/domain/library";
import type { RecordDetail } from "../src/domain/records";
import type { PostDocument } from "../src/domain/post-document";
import {
  createLocalTestGuestSession,
  createLocalTestSession,
  loadLocalTestAccount,
} from "../src/server/local-test-auth";

const origin = "http://127.0.0.1:3000",
  address = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  !["postgres:", "postgresql:"].includes(address.protocol) ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev"
)
  throw new Error("Aftercare HTTP checks require the isolated local development database.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account)
  throw new Error("The existing local test account must be prepared before aftercare HTTP checks.");
const ownerId = account.userId,
  ownerCookie = "sliper_test_session=" + createLocalTestSession(account, new URL(origin).host),
  guestCookie = "sliper_test_session=" + createLocalTestGuestSession(account, new URL(origin).host);

type ApiReply<T> = { status: number; result: ActionResult<T> };
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = ownerCookie,
): Promise<ApiReply<T>> {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store", path);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/, path);
  return { status: response.status, result: (await response.json()) as ActionResult<T> };
}
function data<T>(reply: ApiReply<T>): T {
  assert.equal(reply.status, 200, "The aftercare fixture request must succeed.");
  assert.ok(reply.result.ok, "The aftercare fixture handler returned an error.");
  return reply.result.data;
}
function error(reply: ApiReply<unknown>, status: number, code: string) {
  assert.equal(reply.status, status);
  assert.equal(reply.result.ok, false);
  if (!reply.result.ok) assert.equal(reply.result.error.code, code);
}
async function page(path: string, cookie = ownerCookie, manual = false) {
  const response = await fetch(origin + path, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(60000),
    ...(manual ? { redirect: "manual" as const } : {}),
  });
  return {
    status: response.status,
    html: await response.text(),
    location: response.headers.get("location"),
  };
}
const sourceInput = {
  kind: "template",
  categorySlug: "mind-games",
  title: "aftercare-api-" + randomUUID(),
  summary: "완료 확인부터 회고와 다음 행사까지 이어지는 통합 검사용 자료입니다.",
  scenario:
    "HTTP-AFTERCARE-PRIVATE-GUIDE-V1 역할 카드를 확인하고 단서를 모으는 첫 운영 가이드입니다.",
  rules: "다른 참가자의 카드를 훔쳐보지 않고 주어진 시간과 이동 규칙을 지켜주세요.",
  hostGuide: "라운드 시작과 종료를 안내하고 마지막에 참가자의 의견을 들어주세요.",
  materials: ["역할 카드"],
  minPlayers: 1,
  maxPlayers: 8,
  durationMinutes: 60,
  rounds: [{ name: "첫 라운드", seconds: 300 }],
  tags: ["추리"],
  priceKRW: 0,
  purchaseUrl: null,
  usageTerms: "출처를 표시하고 무료 행사에서 활용해주세요.",
  allowDerivatives: false,
  allowCommercialUse: false,
};
const recapDocument: PostDocument = {
  version: 1,
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "HTTP-AFTERCARE-PRIVATE-RECAP 다음 행사에서 개선할 현장 진행 과정을 기록합니다.",
        },
      ],
    },
  ],
};

test("Next HTTP: completion → reflection publication → template reuse and rehosting stay private and preserve the original event guide", async () => {
  const connection = createDatabase(address.href, 1),
    fixturePosts: string[] = [],
    fixtureLibraries: string[] = [];
  let mainId = "";
  async function seedEvent(
    label: string,
    source?: LibraryDetail,
    state?: "sample" | "hidden" | "cancelled",
  ) {
    const postId = randomUUID(),
      now = Date.now();
    fixturePosts.push(postId);
    await connection.db.transaction(async (tx) => {
      await tx.insert(posts).values({
        id: postId,
        authorId: ownerId,
        kind: "모집",
        categorySlug: "mind-games",
        title: "aftercare-" + label + "-" + randomUUID(),
        bodyMarkdown: "HTTP-AFTERCARE-PRIVATE-APPLICATION-BODY",
        location: "서울 테스트 장소",
        sample: state === "sample",
      });
      await tx.insert(eventSettings).values({
        postId,
        amountKRW: 0,
        capacity: 5,
        open: true,
        startsAt: new Date(now - 3630000),
        endsAt: new Date(now - 30000),
      });
      if (source) {
        const [version] = await tx
          .select()
          .from(libraryVersions)
          .where(
            and(
              eq(libraryVersions.entryId, source.id),
              eq(libraryVersions.number, source.publishedVersion),
            ),
          );
        assert.ok(version);
        const snapshot: TemplateSnapshot = {
          ...source.payload!,
          title: source.title,
          summary: source.summary,
          category: source.category,
          author: source.author,
          authorPublicId: source.authorPublicId,
          minPlayers: source.minPlayers,
          maxPlayers: source.maxPlayers,
          durationMinutes: source.durationMinutes,
          sourceId: source.id,
          versionId: version.id,
          versionNumber: version.number,
          usageTerms: source.usageTerms,
          allowDerivatives: false,
          allowCommercialUse: false,
        };
        await tx
          .insert(templateProvenance)
          .values({ postId, entryId: source.id, versionId: version.id, snapshot });
      }
      if (state === "hidden")
        await tx
          .insert(contentRestrictions)
          .values({ targetType: "post", targetId: postId, reason: "검사용 숨긴 행사" });
      if (state === "cancelled") {
        const futureStart = new Date(now + 86400000),
          futureEnd = new Date(now + 90000000);
        await tx
          .update(eventSettings)
          .set({ startsAt: futureStart, endsAt: futureEnd, open: false })
          .where(eq(eventSettings.postId, postId));
        await tx.insert(eventChanges).values({
          postId,
          kind: "cancel",
          revision: 1,
          reason: "통합검사를 위한 취소 행사",
          beforeStartsAt: futureStart,
          beforeEndsAt: futureEnd,
          createdBy: ownerId,
        });
        await tx.insert(eventLifecycle).values({
          postId,
          revision: 1,
          cancelledAt: new Date(),
          cancellationReason: "통합검사를 위한 취소 행사",
        });
      }
    });
    return postId;
  }
  async function taskFor(postId: string) {
    for (let current = 1; current <= 25; current++) {
      const result = data(
        await api<AftercarePage>("/api/event-aftercare?scope=hosting&view=all&page=" + current),
      );
      const found = result.items.find((item) => item.postId === postId && item.role === "host");
      if (found) return found;
      if (!result.hasMore) break;
    }
    assert.fail("The fixture's own hosting task must be visible in the bounded aftercare list.");
  }
  async function stateDigest() {
    const snapshot = await connection.db.transaction(async (tx) => ({
      settings: await tx
        .select()
        .from(eventSettings)
        .where(inArray(eventSettings.postId, fixturePosts))
        .orderBy(eventSettings.postId),
      records: await tx
        .select()
        .from(eventRecords)
        .where(inArray(eventRecords.postId, fixturePosts))
        .orderBy(eventRecords.postId),
      provenance: await tx
        .select()
        .from(templateProvenance)
        .where(inArray(templateProvenance.postId, fixturePosts))
        .orderBy(templateProvenance.postId),
      credits: await tx
        .select()
        .from(eventCredits)
        .where(inArray(eventCredits.postId, fixturePosts))
        .orderBy(eventCredits.id),
      results: await tx
        .select()
        .from(eventResults)
        .where(inArray(eventResults.postId, fixturePosts))
        .orderBy(eventResults.applicationId),
    }));
    return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  }
  try {
    assert.equal(
      data(await api<{ authenticated: boolean }>("/api/auth/test/session")).authenticated,
      true,
    );
    error(await api("/api/event-aftercare", "GET", undefined, guestCookie), 401, "UNAUTHENTICATED");
    for (const query of [
      "scope=unknown",
      "view=unread",
      "page=0",
      "page=1001",
      "page=1&page=2",
      "scope=hosting&scope=all",
      "unknown=true",
    ]) {
      const reply = await api("/api/event-aftercare?" + query);
      assert.equal(reply.status, 400, query);
      error(reply, 400, "VALIDATION");
    }
    let source = data(await api<LibraryDetail>("/api/library", "POST", sourceInput));
    fixtureLibraries.push(source.id);
    mainId = await seedEvent("main", source);
    const excluded: string[] = [];
    for (const state of ["sample", "hidden", "cancelled"] as const)
      excluded.push(await seedEvent(state, undefined, state));
    const initial = await taskFor(mainId);
    assert.equal(initial.id, "hosting:" + mainId);
    assert.equal(initial.stage, "completion");
    assert.equal(initial.pending, true);
    assert.ok(
      initial.actions.some(
        (action) => action.href === "/management/events/" + mainId + "#event-completion",
      ),
    );
    const beforeReads = await stateDigest();
    for (const scope of ["all", "hosting", "participation", "credits"]) {
      const result = data(
        await api<AftercarePage>("/api/event-aftercare?scope=" + scope + "&view=all&page=1"),
      );
      assert.equal(result.page, 1);
      assert.ok(result.total >= 0);
      assert.ok(result.pendingTotal >= 0);
      assert.ok(result.items.length <= 20);
      assert.equal(
        result.items.some((item) => excluded.includes(item.postId)),
        false,
      );
      assert.equal(JSON.stringify(result).includes("HTTP-AFTERCARE-PRIVATE-"), false);
      for (const item of result.items)
        for (const forbidden of [
          "snapshot",
          "bodyDocument",
          "bodyMarkdown",
          "contact",
          "attendeeName",
          "applicationId",
        ])
          assert.equal(Object.hasOwn(item, forbidden), false);
    }
    assert.equal(
      await stateDigest(),
      beforeReads,
      "GET aftercare must not finalize attendance or create record drafts.",
    );
    assert.equal(
      (await connection.db.select().from(eventRecords).where(eq(eventRecords.postId, mainId)))
        .length,
      0,
    );
    for (const path of ["/management", "/mypage"]) {
      const rendered = await page(path);
      assert.equal(rendered.status, 200, path);
      assert.ok(
        rendered.html.includes(initial.title),
        "The member dashboard must include its pending event follow-up summary.",
      );
    }
    const eventApi = "/api/participation/events/" + mainId;
    data(await api(eventApi + "/finalize", "POST", {}));
    const firstRecord = data(await api<RecordDetail>("/api/records/" + mainId));
    assert.equal(firstRecord.status, "draft");
    data(await api(eventApi + "/finalize", "POST", {}));
    assert.equal(
      data(await api<RecordDetail>("/api/records/" + mainId)).completedAt,
      firstRecord.completedAt,
    );
    const reflection = await taskFor(mainId);
    assert.equal(reflection.stage, "reflection");
    assert.equal(reflection.pending, true);
    assert.ok(reflection.actions.some((action) => action.href === "/records/" + mainId + "/edit"));
    const saved = data(
      await api<RecordDetail>("/api/records/" + mainId, "PATCH", {
        expectedUpdatedAt: firstRecord.updatedAt,
        purpose: "처음 참가한 사람도 함께 즐기는 협력형 미션을 기획했습니다.",
        execution: "참가자를 팀으로 나누고 단서를 모으는 라운드를 순서대로 진행했습니다.",
        highlights: "모든 참가자가 돌아가며 의견을 나누었습니다.",
        improvements: "다음에는 시작 안내 시간을 늘리겠습니다.",
        bodyDocument: recapDocument,
        relatedPostIds: [],
        libraryIds: [source.id],
      }),
    );
    const published = data(
      await api<RecordDetail>("/api/records/" + mainId + "/publish", "POST", {
        expectedUpdatedAt: saved.updatedAt,
        published: true,
      }),
    );
    assert.equal(published.status, "published");
    const ready = await taskFor(mainId);
    assert.equal(ready.stage, "ready");
    assert.equal(ready.pending, false);
    assert.ok(ready.actions.some((action) => action.href === "/records/" + mainId));
    const afterReads = await stateDigest();
    data(await api<AftercarePage>("/api/event-aftercare?scope=hosting&view=pending"));
    assert.equal(await stateDigest(), afterReads);
    error(
      await api("/api/records/" + mainId, "GET", undefined, guestCookie),
      401,
      "UNAUTHENTICATED",
    );
    const draft = data(
      await api<LibraryDetail>("/api/records/" + mainId + "/template-draft", "POST", {
        expectedUpdatedAt: published.updatedAt,
      }),
    );
    fixtureLibraries.push(draft.id);
    assert.equal(draft.sourceRecordPostId, mainId);
    assert.equal(draft.status, "draft");
    const derived = data(
      await api<LibraryDetail>("/api/library/" + draft.id + "/publish", "POST", {
        expectedUpdatedAt: draft.updatedAt,
        changeSummary: "회고에서 운영 조건을 검토하고 자료로 발행",
        publicContentConsent: true,
      }),
    );
    assert.equal(derived.status, "published");
    const convertedReuse = await page("/archive/" + derived.id + "/host?fromRecord=" + mainId);
    assert.equal(
      convertedReuse.status,
      200,
      "A published template created from this record can reuse its own source record.",
    );
    const reusePath = "/archive/" + source.id + "/host?fromRecord=" + mainId;
    const reuse = await page(reusePath);
    assert.equal(reuse.status, 200);
    assert.ok(reuse.html.includes("지난 행사를 바탕으로 다음 모임 준비"));
    assert.ok(reuse.html.includes("개설 조건을 다시 확인했어요."));
    for (const name of ["startsAt", "endsAt"]) {
      const input = [...reuse.html.matchAll(/<input\b[^>]*>/g)]
        .map((match) => match[0])
        .find((tag) => tag.includes('name="' + name + '"'));
      assert.ok(input, "The rehosting form requires a new schedule field.");
      assert.equal(
        /\bvalue="[^"]+"/.test(input),
        false,
        "An old schedule must never become the new event schedule.",
      );
    }
    const guestReuse = await page(reusePath, guestCookie, true);
    assert.ok([303, 307, 308].includes(guestReuse.status));
    const target = new URL(guestReuse.location!, origin);
    assert.equal(target.pathname, "/login");
    assert.equal(target.searchParams.get("returnTo"), reusePath);
    assert.equal((await page("/archive/" + source.id + "/host?fromRecord=invalid")).status, 404);
    const unrelated = await seedEvent("unrelated");
    data(await api("/api/participation/events/" + unrelated + "/finalize", "POST", {}));
    assert.equal(
      (await page("/archive/" + source.id + "/host?fromRecord=" + unrelated)).status,
      404,
    );
    const frozen = data(await api<TemplateSnapshot>("/api/library/" + mainId + "/event-template"));
    source = data(
      await api<LibraryDetail>("/api/library/" + source.id, "PUT", {
        content: {
          ...sourceInput,
          scenario: "HTTP-AFTERCARE-PRIVATE-GUIDE-V2 다음 진행을 위해 개선한 새로운 가이드입니다.",
        },
        expectedUpdatedAt: source.updatedAt,
      }),
    );
    error(
      await api("/api/library/" + source.id + "/host", "POST", {
        title: "일정이 지난 재개최 검사",
        location: "서울 테스트 장소",
        startsAt: "2020-01-01T01:00:00Z",
        endsAt: "2020-01-01T02:00:00Z",
        amountKRW: 0,
        capacity: 5,
        description: "지난 행사 일정을 그대로 복사하면 재개최할 수 없어야 합니다.",
      }),
      400,
      "VALIDATION",
    );
    const newStart = new Date(Date.now() + 10 * 86400000),
      next = data(
        await api<{ postId: string }>("/api/library/" + source.id + "/host", "POST", {
          title: "aftercare-rehost-" + randomUUID(),
          location: "새 서울 행사장",
          startsAt: newStart.toISOString(),
          endsAt: new Date(newStart.getTime() + 3600000).toISOString(),
          amountKRW: 0,
          capacity: 5,
          description: "일정과 참가 조건을 다시 확인해 새롭게 여는 후속 행사입니다.",
        }),
      );
    fixturePosts.push(next.postId);
    assert.notEqual(next.postId, mainId);
    const nextGuide = data(
      await api<TemplateSnapshot>("/api/library/" + next.postId + "/event-template"),
    );
    assert.equal(nextGuide.versionNumber, 2);
    assert.ok(nextGuide.scenario.includes("GUIDE-V2"));
    assert.deepEqual(
      data(await api<TemplateSnapshot>("/api/library/" + mainId + "/event-template")),
      frozen,
    );
  } finally {
    try {
      await connection.db.transaction(async (tx) => {
        const owned = fixturePosts.length
          ? await tx
              .select({ id: posts.id })
              .from(posts)
              .where(and(inArray(posts.id, fixturePosts), eq(posts.authorId, ownerId)))
          : [];
        const ids = owned.map((post) => post.id);
        if (ids.length) {
          await tx.delete(eventRecordLinks).where(inArray(eventRecordLinks.recordPostId, ids));
          await tx.delete(templateProvenance).where(inArray(templateProvenance.postId, ids));
          await tx
            .delete(contentRestrictions)
            .where(
              and(
                inArray(contentRestrictions.targetId, ids),
                eq(contentRestrictions.targetType, "post"),
              ),
            );
        }
        if (fixtureLibraries.length)
          await tx
            .delete(libraryEntries)
            .where(
              and(
                inArray(libraryEntries.id, fixtureLibraries),
                eq(libraryEntries.ownerId, ownerId),
              ),
            );
        if (ids.length) await tx.delete(eventChanges).where(inArray(eventChanges.postId, ids));
        if (ids.length) await tx.delete(eventRecords).where(inArray(eventRecords.postId, ids));
        if (ids.length)
          await tx.delete(posts).where(and(inArray(posts.id, ids), eq(posts.authorId, ownerId)));
      });
    } finally {
      await connection.close();
    }
  }
});
