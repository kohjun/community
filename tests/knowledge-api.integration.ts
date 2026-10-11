import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { libraryEntries, libraryVersions } from "../src/db/library-schema";
import { COEX_PLAYBOOK_EXAMPLE } from "../src/domain/event-plan-example";
import type { ActionResult } from "../src/domain/contracts";
import type {
  LibraryDetail,
  LibraryPage,
  LibraryVersionDetail,
  LibraryVersionPage,
} from "../src/domain/library";
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
  throw new Error("Knowledge HTTP checks require the isolated local development database.");

const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account)
  throw new Error("The existing local test account must be prepared before HTTP checks.");
const ownerId = account.userId,
  ownerCookie = "sliper_test_session=" + createLocalTestSession(account, new URL(origin).host),
  guestCookie = "sliper_test_session=" + createLocalTestGuestSession(account, new URL(origin).host);

type ApiReply<T> = { status: number; result: ActionResult<T>; headers: Headers };

async function raw(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = ownerCookie,
  from = origin,
) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: from,
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store", method + " " + path);
  return {
    status: response.status,
    text: await response.text(),
    headers: response.headers,
  };
}

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = ownerCookie,
  from = origin,
): Promise<ApiReply<T>> {
  const response = await raw(path, method, body, cookie, from);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/, path);
  return {
    status: response.status,
    result: JSON.parse(response.text) as ActionResult<T>,
    headers: response.headers,
  };
}

function data<T>(response: ApiReply<T>): T {
  assert.equal(response.status, 200, JSON.stringify(response.result));
  if (!response.result.ok) throw new Error(response.result.error.message);
  return response.result.data;
}

function error<T>(response: ApiReply<T>, status: number, code: string) {
  assert.equal(response.status, status, JSON.stringify(response.result));
  assert.equal(response.result.ok, false);
  if (!response.result.ok) assert.equal(response.result.error.code, code);
}

const input = {
  eventPlan: COEX_PLAYBOOK_EXAMPLE.eventPlan,
  kind: "template",
  categorySlug: "mind-games",
  title: "api-knowledge-" + randomUUID(),
  summary: "실제 Next API에서 비공개 초안과 공개 발행 사이의 접근 경계를 확인하는 자료입니다.",
  scenario: "HTTP-PRIVATE-DRAFT 최초 비공개 초안에서만 사용하는 라운드 진행 설명입니다.",
  rules: "역할 카드를 다른 참가자에게 보여주지 않고 라운드별 시간을 지켜주세요.",
  hostGuide: "게임 순서와 안전 수칙을 설명하고 마지막에 참여자의 의견을 들어주세요.",
  materials: ["역할 카드", "타이머"],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  rounds: [{ name: "추리 라운드", seconds: 300 }],
  tags: ["검사"],
  priceKRW: 0,
  purchaseUrl: null,
  usageTerms: "작성자 출처를 표시하고 무료 행사에서 사용할 수 있습니다.",
  allowDerivatives: false,
  allowCommercialUse: false,
};

test("Next HTTP: private drafts, consent publication, revision conflicts, guest versions and CSRF share the real handlers", async () => {
  const connection = createDatabase(address.toString(), 1);
  let entryId = "",
    removedThroughApi = false;
  try {
    assert.equal(
      data(await api<{ authenticated: boolean }>("/api/auth/test/session")).authenticated,
      true,
    );
    assert.equal(
      data(
        await api<{ authenticated: boolean }>(
          "/api/auth/test/session",
          "GET",
          undefined,
          guestCookie,
        ),
      ).authenticated,
      false,
    );
    error(
      await api(
        "/api/library/drafts",
        "POST",
        input,
        ownerCookie,
        "https://untrusted.example.invalid",
      ),
      403,
      "FORBIDDEN",
    );
    error(await api("/api/library/drafts", "POST", input, guestCookie), 401, "UNAUTHENTICATED");
    error(
      await api(
        "/api/records/" + randomUUID() + "/template-draft",
        "POST",
        { expectedUpdatedAt: new Date().toISOString() },
        guestCookie,
      ),
      401,
      "UNAUTHENTICATED",
    );
    const created = data(await api<LibraryDetail>("/api/library/drafts", "POST", input));
    entryId = created.id;
    assert.equal(created.status, "draft");
    assert.equal(created.publishedVersion, 0);
    assert.equal(created.draftContent?.scenario, input.scenario);
    assert.deepEqual(created.draftContent?.eventPlan, input.eventPlan);
    assert.equal(created.sourceRecordPostId, null);
    assert.equal(created.sourceVersionId, null);
    const route = "/api/library/" + entryId;
    for (const path of [route, route + "/versions", route + "/versions/1", route + "/download"]) {
      const hidden = await api(path, "GET", undefined, guestCookie);
      error(hidden, 404, "NOT_FOUND");
      assert.equal(JSON.stringify(hidden.result).includes("HTTP-PRIVATE-DRAFT"), false);
    }
    const head = await raw(route, "HEAD", undefined, guestCookie);
    assert.equal(head.status, 404);
    assert.equal(head.text, "");
    assert.equal(data(await api<LibraryVersionPage>(route + "/versions")).total, 0);
    assert.equal(
      data(await api<LibraryPage>("/api/library?mine=true")).items.some(
        (item) => item.id === entryId,
      ),
      true,
    );
    const search = new URLSearchParams({ search: input.title });
    assert.equal(
      data(
        await api<LibraryPage>("/api/library?" + search, "GET", undefined, guestCookie),
      ).items.some((item) => item.id === entryId),
      false,
    );

    const changed = {
      ...input,
      title: input.title + " 수정",
      scenario: "HTTP-PUBLISHED-VERSION-ONE 최신 초안을 수정하여 공개하는 첫 번째 발행본입니다.",
    };
    const update = { content: changed, expectedUpdatedAt: created.updatedAt };
    // The legacy immediate-update route cannot turn a private draft into a publication.
    error(await api(route, "PUT", update), 409, "CONFLICT");
    assert.equal(data(await api<LibraryDetail>(route)).updatedAt, created.updatedAt);
    error(
      await api(route + "/draft", "PUT", update, ownerCookie, "https://untrusted.example.invalid"),
      403,
      "FORBIDDEN",
    );
    const saved = data(await api<LibraryDetail>(route + "/draft", "PUT", update));
    assert.equal(saved.title, changed.title);
    assert.equal(saved.draftContent?.scenario, changed.scenario);
    assert.equal(saved.publishedVersion, 0);
    assert.notEqual(saved.updatedAt, created.updatedAt);
    error(await api(route + "/draft", "PUT", update), 409, "CONFLICT");
    error(await api(route, "GET", undefined, guestCookie), 404, "NOT_FOUND");
    const publication = {
      expectedUpdatedAt: saved.updatedAt,
      changeSummary: "초안을 검토하고 첫 공개 운영 자료로 발행",
    };
    error(await api(route + "/publish", "POST", publication), 400, "VALIDATION");
    error(
      await api(route + "/publish", "POST", { ...publication, publicContentConsent: false }),
      400,
      "VALIDATION",
    );
    error(
      await api(route + "/publish", "POST", {
        ...publication,
        expectedUpdatedAt: created.updatedAt,
        publicContentConsent: true,
      }),
      409,
      "CONFLICT",
    );
    const published = data(
      await api<LibraryDetail>(route + "/publish", "POST", {
        ...publication,
        publicContentConsent: true,
      }),
    );
    assert.equal(published.status, "published");
    assert.equal(published.publishedVersion, 1);
    assert.equal(published.draftContent, null);
    const publicDetail = data(await api<LibraryDetail>(route, "GET", undefined, guestCookie));
    assert.equal(publicDetail.payload?.scenario, changed.scenario);
    assert.deepEqual(publicDetail.payload?.eventPlan, input.eventPlan);
    assert.equal(publicDetail.recordedPlayers, 0);
    assert.equal(publicDetail.draftContent, null);
    assert.equal(publicDetail.sourceRecordPostId, null);
    const version = data(
      await api<LibraryVersionDetail>(route + "/versions/1", "GET", undefined, guestCookie),
    );
    assert.equal(version.number, 1);
    assert.equal(version.payload?.scenario, changed.scenario);
    assert.deepEqual(version.payload?.eventPlan, input.eventPlan);
    assert.equal(version.sourceRecordPostId, null);
    const history = data(
      await api<LibraryVersionPage>(route + "/versions", "GET", undefined, guestCookie),
    );
    assert.equal(history.total, 1);
    assert.equal(history.items[0]?.id, version.id);
    assert.equal(JSON.stringify(history).includes(changed.scenario), false);
    for (const unsupported of ["0", "-1", "1.5", "not-a-version", "99999"])
      error(
        await api(route + "/versions/" + unsupported, "GET", undefined, guestCookie),
        404,
        "NOT_FOUND",
      );
    error(
      await api(route + "/versions?page=invalid", "GET", undefined, guestCookie),
      400,
      "VALIDATION",
    );
    const file = await raw(route + "/download", "GET", undefined, guestCookie);
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-type") ?? "", /text\/markdown/);
    assert.equal(file.text.includes(changed.scenario), true);
    assert.ok(file.text.includes("식재료 찾기"));
    assert.ok(file.text.includes("9,000원"));
    const page = await fetch(origin + "/archive/" + entryId, {
      headers: { Cookie: guestCookie },
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes("운영 가이드 목차"));
    assert.ok(html.includes("타임라인과 큐시트"));
    assert.ok(html.includes("식재료 찾기"));
    assert.equal(file.text.includes("HTTP-PRIVATE-DRAFT"), false);
    error(
      await api(route + "/publish", "POST", {
        ...publication,
        publicContentConsent: true,
      }),
      409,
      "CONFLICT",
    );
    data(await api(route, "DELETE"));
    removedThroughApi = true;
    error(await api(route, "GET", undefined, guestCookie), 404, "NOT_FOUND");
  } finally {
    try {
      if (entryId) {
        try {
          if (!removedThroughApi) data(await api("/api/library/" + entryId, "DELETE"));
        } finally {
          // The isolated-local guard and owner predicate restrict hard cleanup to this fixture.
          await connection.db
            .delete(libraryEntries)
            .where(and(eq(libraryEntries.id, entryId), eq(libraryEntries.ownerId, ownerId)));
          assert.equal(
            (
              await connection.db
                .select()
                .from(libraryEntries)
                .where(eq(libraryEntries.id, entryId))
            ).length,
            0,
          );
          assert.equal(
            (
              await connection.db
                .select()
                .from(libraryVersions)
                .where(eq(libraryVersions.entryId, entryId))
            ).length,
            0,
          );
        }
      }
    } finally {
      await connection.close();
    }
  }
});
