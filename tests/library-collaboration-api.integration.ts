import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { profiles, posts } from "../src/db/schema";
import {
  libraryEntries,
  librarySuggestions,
  libraryDiscussionLinks,
  libraryAccessRequests,
} from "../src/db/library-schema";
import type { LibraryDetail, LibraryVersionDetail } from "../src/domain/library";
import type {
  SuggestionDetail,
  LibraryCollaborationPage,
} from "../src/domain/library-collaboration";
import type { ActionResult } from "../src/domain/contracts";
import { libraryService } from "../src/server/library-service";
import { libraryCollaborationService } from "../src/server/library-collaboration-service";
import {
  loadLocalTestAccount,
  createLocalTestSession,
  createLocalTestGuestSession,
} from "../src/server/local-test-auth";
const origin = "http://127.0.0.1:3000",
  url = new URL(process.env.DATABASE_URL ?? "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw Error("Isolated local DB and origin required");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account) throw Error("Prepared local test member required");
const actor = account.userId,
  cookie = "sliper_test_session=" + createLocalTestSession(account, new URL(origin).host),
  guest = "sliper_test_session=" + createLocalTestGuestSession(account, new URL(origin).host);
async function raw<T>(
  path: string,
  method = "GET",
  body?: unknown,
  session = cookie,
  from = origin,
) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      Cookie: session,
      Origin: from,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  return { status: r.status, result: (await r.json()) as ActionResult<T> };
}
function data<T>(r: Awaited<ReturnType<typeof raw<T>>>) {
  assert.equal(r.status, 200);
  if (!r.result.ok) throw Error(r.result.error.message);
  return r.result.data;
}
const content = {
  kind: "rulebook" as const,
  categorySlug: "knowledge" as const,
  title: "http-collaboration-" + randomUUID(),
  summary: "실제 HTTP에서 수정 제안과 승인 및 자료 토론의 접근 권한을 확인하는 자료입니다.",
  scenario: "PRIVATE-SCENARIO 참가자는 역할을 정하고 단서를 찾아 협력하여 문제를 해결합니다.",
  rules: "PRIVATE-BASE-RULES 참가자는 각 라운드에서 모두 동일한 시간을 제공받습니다.",
  hostGuide: "진행자는 각 라운드를 시작하기 전에 규칙을 안내하고 남은 시간을 알려줍니다.",
  materials: ["역할 카드"],
  rounds: [{ name: "추리", seconds: 300 }],
  tags: ["검사"],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  priceKRW: 0,
  purchaseUrl: null,
};
test("HTTP collaboration supports member proposals, author approval, exact discussion links and paid privacy", async () => {
  const connection = createDatabase(url.toString(), 1),
    db = connection.db,
    library = libraryService(db),
    collab = libraryCollaborationService(db);
  const ids: string[] = [];
  let peer = "",
    postId = "";
  try {
    peer = randomUUID();
    await db.execute(sql`insert into auth.users(id) values(${peer}::uuid)`);
    await db.insert(profiles).values({ id: peer, nickname: "HTTP 개선 작성자" });
    const first = await library.create(peer, content);
    ids.push(first.id);
    const path = `/api/library/${first.id}/collaboration`;
    assert.equal((await raw(path, "GET", undefined, guest)).status, 401);
    const input = {
      version: 1,
      field: "rules",
      replacement: "PRIVATE-HTTP-PROPOSAL 모든 팀이 각자 두 개의 단서를 확인한 뒤 토론합니다.",
      reason: "운영 경험에서 참가자들이 단서를 충분히 이해하지 못해 개선을 제안합니다.",
      consent: true,
    };
    const s = data(await raw<SuggestionDetail>(path, "POST", input));
    assert.equal(s.status, "pending");
    assert.equal((await raw(path, "POST", input)).status, 409);
    assert.equal((await raw(path, "POST", input, cookie, "https://example.invalid")).status, 403);
    assert.equal((await raw(path, "POST", { ...input, field: "priceKRW" })).status, 400);
    assert.equal((await raw(path + "?page=1&page=2")).status, 400);
    assert.equal((await raw(path + "?ownerId=" + peer)).status, 400);
    const page = data(await raw<LibraryCollaborationPage>(path));
    assert.equal(page.total, 1);
    assert.equal(JSON.stringify(page).includes(input.replacement), false);
    assert.equal(
      (await raw(`/api/library/${first.id}/suggestions/${s.id}`, "GET", undefined, guest)).status,
      401,
    );
    const paid = await library.create(actor, {
      ...content,
      priceKRW: 1000,
      purchaseUrl: "https://example.invalid/collaboration-buy",
    });
    ids.push(paid.id);
    await db.insert(libraryAccessRequests).values({
      entryId: paid.id,
      userId: peer,
      externalReference: "HTTP-COLLAB-ACCESS",
      amountKRW: 1000,
      status: "approved",
    });
    const proposed = await collab.propose(peer, paid.id, input),
      decision = `/api/library/${paid.id}/suggestions/${proposed.id}`;
    assert.equal(
      (
        await raw(decision, "POST", {
          decision: "approve",
          expectedUpdatedAt: proposed.updatedAt,
          note: "공개 동의 미확인",
        })
      ).status,
      400,
    );
    const approved = data(
      await raw<LibraryCollaborationPage>(decision, "POST", {
        decision: "approve",
        expectedUpdatedAt: proposed.updatedAt,
        expectedLibraryUpdatedAt: paid.updatedAt,
        note: "공정한 단서 배부로 개선",
        publicContentConsent: true,
      }),
    );
    assert.equal(approved.items[0]!.status, "approved");
    const current = data(await raw<LibraryDetail>(`/api/library/${paid.id}`));
    assert.equal(current.publishedVersion, 2);
    assert.equal(current.priceKRW, 1000);
    assert.equal(current.payload!.rules, input.replacement);
    const old = data(await raw<LibraryVersionDetail>(`/api/library/${paid.id}/versions/1`));
    assert.equal(old.payload!.rules, content.rules);
    const hidden = data(
      await raw<LibraryVersionDetail>(
        `/api/library/${paid.id}/versions/2`,
        "GET",
        undefined,
        guest,
      ),
    );
    assert.equal(hidden.payload, null);
    assert.equal(hidden.content, null);
    const [post] = await db
      .insert(posts)
      .values({
        authorId: actor,
        kind: "이야기",
        categorySlug: "lab",
        title: "http-linked-research-" + randomUUID(),
        bodyMarkdown: "운영 내용과 규칙의 연결을 확인하는 연구 이야기입니다.",
      })
      .returning();
    postId = post!.id;
    data(await raw(`/api/library/${paid.id}/discussions`, "POST", { postId, version: 2 }));
    const links = data(
      await raw<Array<{ id: string; version: number }>>(`/api/posts/${postId}/library-links`),
    );
    assert.equal(links[0]!.id, paid.id);
    assert.equal(links[0]!.version, 2);
    assert.equal(
      (await raw(`/api/posts/${postId}/library-links`, "GET", undefined, guest)).status,
      401,
    );
    const head = await fetch(origin + `/api/library/${paid.id}/collaboration`, {
      method: "HEAD",
      headers: { Cookie: cookie },
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    if (ids.length) {
      await db.delete(librarySuggestions).where(inArray(librarySuggestions.entryId, ids));
      await db.delete(libraryDiscussionLinks).where(inArray(libraryDiscussionLinks.entryId, ids));
      await db.delete(libraryAccessRequests).where(inArray(libraryAccessRequests.entryId, ids));
      await db.delete(libraryEntries).where(inArray(libraryEntries.id, ids));
    }
    if (postId) await db.delete(posts).where(eq(posts.id, postId));
    if (peer) await db.execute(sql`delete from auth.users where id=${peer}::uuid`);
    await connection.close();
  }
});
