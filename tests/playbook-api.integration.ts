import "dotenv/config";
import { installDevelopmentProfileFixture } from "./helpers/development-profile-fixture";
installDevelopmentProfileFixture();
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { posts } from "../src/db/schema";
import { libraryEntries } from "../src/db/library-schema";
import type { ActionResult } from "../src/domain/contracts";
import type { LibraryDetail, LibraryPage } from "../src/domain/library";
import type { EventOverview } from "../src/domain/participation";
import type { RefundView } from "../src/domain/refund";
import type { PlayerProfileView } from "../src/domain/player";
const origin = "http://127.0.0.1:3000",
  address = new URL(process.env.MIGRATION_DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev" ||
  process.env.APP_ORIGIN !== origin
)
  throw new Error("Feature API tests are isolated-local only.");
async function api<T>(path: string, method = "GET", body?: unknown, from = origin) {
  const response = await fetch(origin + path, {
    method,
    headers: { Origin: from, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, result: (await response.json()) as ActionResult<T> };
}
function data<T>(v: { status: number; result: ActionResult<T> }): T {
  assert.equal(v.status, 200, JSON.stringify(v.result));
  if (!v.result.ok) throw new Error(v.result.error.message);
  return v.result.data;
}
const input = {
  kind: "template",
  categorySlug: "party",
  title: `[HTTP 확인] ${randomUUID().slice(0, 8)}`,
  summary: "실제 로컬 HTTP를 통해 새로운 모임을 여는 통합검사 전용 자료입니다.",
  scenario: "별도의 역할을 맡아 함께 미션을 풀고 마지막 라운드에서 정답을 확인하는 게임입니다.",
  rules: "서로의 역할카드를 훔쳐보지 않고 라운드별로 규칙을 지킵니다.",
  materials: ["역할카드", "타이머"],
  hostGuide: "팀을 소개하고 게임의 순서와 준비물을 설명해주세요.",
  minPlayers: 1,
  maxPlayers: 8,
  durationMinutes: 60,
  rounds: [{ name: "첫 미션", seconds: 300 }],
  tags: ["테스트"],
  priceKRW: 0,
  purchaseUrl: null,
};
test("template HTTP CRUD, protected execution guide and scheduled refunds share actual PostgreSQL transactions", async () => {
  const connection = createDatabase(address.href, 1);
  let entryId: string | undefined, rulebookId: string | undefined, postId: string | undefined;
  try {
    assert.equal((await api("/api/library", "POST", input, "https://example.invalid")).status, 403);
    assert.equal(
      (await api("/api/library", "POST", { ...input, ownerId: randomUUID() })).status,
      400,
    );
    entryId = data(await api<{ id: string }>("/api/library", "POST", input)).id;
    rulebookId = data(
      await api<{ id: string }>("/api/library", "POST", {
        ...input,
        kind: "rulebook",
        title: input.title + " 룰북",
      }),
    ).id;
    const query = new URLSearchParams({ search: input.title });
    const all = data(await api<LibraryPage>(`/api/library?${query}`));
    assert.equal(all.items.length, 2);
    assert.deepEqual(
      new Set(all.items.map((entry) => entry.kind)),
      new Set(["rulebook", "template"]),
    );
    for (const kind of ["rulebook", "template"]) {
      const filtered = data(await api<LibraryPage>(`/api/library?${query}&kind=${kind}`));
      assert.equal(filtered.items.length, 1);
      assert.equal(filtered.items[0]?.kind, kind);
    }
    assert.equal((await api("/api/library?kind=all")).status, 400);
    for (const path of [
      "/archive",
      "/archive?kind=template",
      "/archive?kind=rulebook",
      `/archive/${entryId}`,
      `/archive/${rulebookId}`,
      `/archive/${entryId}/edit`,
      `/archive/${entryId}/host`,
    ]) {
      assert.equal((await fetch(origin + path)).status, 200, path);
    }
    for (const [legacy, canonical] of [
      ["/templates", "/archive?kind=template"],
      ["/templates/new", "/archive/new?kind=template"],
      [`/templates/${entryId}`, `/archive/${entryId}`],
      [`/templates/${entryId}/edit`, `/archive/${entryId}/edit`],
      [`/templates/${entryId}/host`, `/archive/${entryId}/host`],
    ] as const) {
      const redirected = await fetch(origin + legacy, { redirect: "manual" });
      assert.equal(redirected.status, 308, legacy);
      assert.equal(redirected.headers.get("location"), canonical, legacy);
    }
    const initial = data(await api<LibraryDetail>(`/api/library/${entryId}`));
    assert.ok(initial.payload?.scenario);
    data(
      await api(`/api/library/${entryId}`, "PUT", {
        content: { ...input, title: input.title + " 수정" },
        expectedUpdatedAt: initial.updatedAt,
      }),
    );
    assert.equal(
      (
        await api(`/api/library/${entryId}`, "PUT", {
          content: input,
          expectedUpdatedAt: initial.updatedAt,
        })
      ).status,
      409,
    );
    const file = await fetch(`${origin}/api/library/${entryId}/download`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-type") || "", /text\/markdown/);
    assert.ok((await file.text()).includes(input.scenario));
    const start = new Date(Date.now() + 4 * 86400000).toISOString();
    postId = data(
      await api<{ postId: string }>(`/api/library/${entryId}/host`, "POST", {
        title: "HTTP 전용 모임",
        location: "서울 테스트장소",
        startsAt: start,
        endsAt: new Date(Date.parse(start) + 3600000).toISOString(),
        amountKRW: 10001,
        capacity: 5,
        description: "이 모임은 새 기능을 검사한 뒤 테스트 데이터만 정리됩니다.",
      }),
    ).postId;
    const overview = data(await api<EventOverview>(`/api/participation/events/${postId}`));
    assert.equal(overview.config?.startsAt, start);
    assert.equal(overview.config?.refundPolicy, "sliper-v1");
    assert.ok(data(await api(`/api/library/${postId}/event-template`)));
    assert.equal((await fetch(`${origin}/archive/events/${postId}`)).status, 200);
    const legacyGuide = await fetch(`${origin}/templates/events/${postId}`, { redirect: "manual" });
    assert.equal(legacyGuide.status, 308);
    assert.equal(legacyGuide.headers.get("location"), `/archive/events/${postId}`);
    assert.equal(
      (
        await api(`/api/participation/events/${postId}/applications`, "POST", {
          consent: true,
        })
      ).status,
      400,
    );
    const app = data(
      await api<EventOverview>(`/api/participation/events/${postId}/applications`, "POST", {
        consent: true,
        refundConsent: true,
      }),
    ).application!;
    data(
      await api(`/api/participation/orders/${app.orderId}/simulate`, "POST", { status: "paid" }),
    );
    const requested = data(
      await api<RefundView>(`/api/participation/events/${postId}/refunds`, "POST", {
        applicationId: app.id,
        reason: "테스트 일정 변경",
      }),
    );
    const request = requested.requests[0]!;
    assert.equal(request.rate, 80);
    assert.equal(request.refundableKRW, 8000);
    data(
      await api(`/api/participation/refunds/${request.id}/resolve`, "PUT", {
        decision: "complete",
        externalRefundChecked: true,
        actualRefundKRW: 8000,
        reason: "테스트 외부 환불 확인",
      }),
    );
    assert.equal(
      data(await api<RefundView>(`/api/participation/events/${postId}/refunds`)).requests[0]
        ?.actualRefundKRW,
      8000,
    );
    assert.equal(
      (
        await api(`/api/players/events/${postId}/records`, "PUT", {
          applicationId: app.id,
          presence: "attended",
          outcome: "won",
          observedRole: "brain",
        })
      ).status,
      409,
    );
  } finally {
    if (postId) {
      await connection.db.execute(sql`delete from sliper.refund_requests where post_id=${postId}`);
      await connection.db.execute(
        sql`delete from sliper.payment_events where order_id in (select o.id from sliper.payment_orders o join sliper.event_applications a on a.id=o.application_id where a.post_id=${postId})`,
      );
      await connection.db.execute(
        sql`delete from sliper.payment_orders where application_id in (select id from sliper.event_applications where post_id=${postId})`,
      );
      await connection.db.delete(posts).where(eq(posts.id, postId));
    }
    if (entryId) await connection.db.delete(libraryEntries).where(eq(libraryEntries.id, entryId));
    if (rulebookId)
      await connection.db.delete(libraryEntries).where(eq(libraryEntries.id, rulebookId));
    await connection.close();
  }
});
test("player public HTTP profiles expose aggregate scores and guard self-owned preference writes", async () => {
  const me = data(await api<PlayerProfileView>("/api/players/me"));
  assert.ok(me.publicId);
  const original = {
    preferredRole: me.preferredRole,
    matchingVisible: me.matchingVisible,
    historyPublic: me.historyPublic,
  };
  try {
    assert.equal(
      (await api("/api/players/me", "PUT", { ...original, mannerTemperature: 99.9 })).status,
      400,
    );
    assert.equal(
      (await api("/api/players/me", "PUT", original, "https://example.invalid")).status,
      403,
    );
    const publicView = data(await api<PlayerProfileView>(`/api/players/${me.publicId}`));
    assert.equal("userId" in publicView, false);
    assert.equal("contact" in publicView, false);
    assert.equal(typeof publicView.summary.mannerTemperature, "number");
    for (const path of [
      "/",
      "/archive",
      "/templates",
      "/players",
      "/players?tab=crews",
      "/crews",
      "/mypage",
      "/login",
      "/management",
    ]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.ok(html.includes('href="/archive"'), path + " shared archive navigation");
      assert.equal(
        html.includes('href="/templates"'),
        false,
        path + " no duplicate template navigation",
      );
      const menu = html.match(/<nav\b[^>]*aria-label="주 메뉴"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
      assert.ok(menu, path + " shared navigation");
      assert.equal([...menu.matchAll(/href="\/players"/g)].length, 1, path + " single people menu");
      assert.ok(menu.includes("플레이어·크루"));
      assert.equal(menu.includes('href="/crews"'), false, path + " no duplicate crew menu");
    }
    const filteredPlayers = await fetch(
      origin + "/players?role=brain&region=" + encodeURIComponent("서울"),
    );
    assert.equal(filteredPlayers.status, 200);
    const filteredHtml = await filteredPlayers.text();
    assert.match(
      filteredHtml,
      /<option\b(?=[^>]*\bvalue="brain")(?=[^>]*\bselected(?:[=\s>]))[^>]*>/,
    );
    assert.match(filteredHtml, /<input\b(?=[^>]*\bvalue="서울")[^>]*>/);
  } finally {
    data(await api("/api/players/me", "PUT", original));
  }
});
