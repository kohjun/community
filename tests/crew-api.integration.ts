import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createLocalTestSession, loadLocalTestAccount } from "../src/server/local-test-auth";
import type { ActionResult } from "../src/domain/contracts";
import type { CrewDetail, CrewPage, CrewJoinRequest } from "../src/domain/crew";
const origin = "http://127.0.0.1:3000";
const url = new URL(process.env.DATABASE_URL ?? "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw Error("Crew HTTP checks require the isolated development database.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account) throw Error("Prepare the existing local test account first.");
const memberCookie = "sliper_test_session=" + createLocalTestSession(account, "127.0.0.1:3000");
const guestCookie = "sliper_test_session=invalid";
async function api<T>(path: string, method = "GET", body?: unknown, cookie = "", from = origin) {
  const response = await fetch(origin + "/api/crews" + path, {
    method,
    headers: {
      Origin: from,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  return {
    status: response.status,
    headers: response.headers,
    result: method === "HEAD" ? null : ((await response.json()) as ActionResult<T>),
  };
}
function data<T>(reply: { status: number; result: ActionResult<T> | null }): T {
  assert.equal(reply.status, 200);
  assert.ok(reply.result?.ok, "Crew API failed.");
  return reply.result.data;
}
async function pageHtml(path: string, cookie = guestCookie) {
  const response = await fetch(origin + path, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.status, 200, path);
  return response.text();
}
function navigation(html: string, label: string) {
  const result = html.match(
    new RegExp('<nav\\b[^>]*aria-label="' + label + '"[^>]*>([\\s\\S]*?)</nav>'),
  );
  assert.ok(result, "Missing navigation: " + label);
  return [...result[1]!.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((link) => ({
    attributes: link[1]!,
    text: link[2]!,
  }));
}
function assertPeopleSelection(html: string, activeTab?: "players" | "crews") {
  const main = navigation(html, "주 메뉴");
  const people = main.filter((link) => /\bhref="\/players"/.test(link.attributes));
  assert.equal(people.length, 1, "One people menu");
  assert.equal(people[0]!.text, "플레이어·크루");
  assert.match(people[0]!.attributes, /aria-current="page"/);
  assert.equal(
    main.some((link) => /\bhref="\/crews"/.test(link.attributes)),
    false,
  );
  if (activeTab) {
    const tabs = navigation(html, "플레이어·크루 탐색");
    assert.equal(tabs.length, 2);
    const selected = tabs.filter((link) => /aria-current="page"/.test(link.attributes));
    assert.equal(selected.length, 1);
    assert.equal(
      selected[0]!.text.replace(/<[^>]*>/g, "").trim(),
      activeTab === "crews" ? "크루 찾기" : "플레이어 찾기",
    );
  }
}
test("crew HTTP approval, private queues, delegated roles, revocation and archive enforce the current actor", async () => {
  const db = postgres(url.toString(), { prepare: false, max: 1 }),
    name = "크루 HTTP " + randomUUID();
  let crewId: string | null = null;
  try {
    const input = {
      name: name.slice(0, 40),
      description: "각자의 재능으로 좋은 예능 이벤트를 함께 만드는 테스트 크루입니다.",
      category: "party",
      region: "서울",
      capacity: 2,
      recruiting: true,
    };
    assert.equal((await api("", "POST", input, guestCookie)).status, 401);
    assert.equal((await api("", "POST", input, "", "https://foreign.example")).status, 403);
    const created = data(await api<CrewDetail>("", "POST", input));
    crewId = created.id;
    assert.equal(created.myRole, "owner");
    const owner = await db`select owner_id from sliper.crews where id=${crewId}::uuid`;
    const publicView = data(await api<CrewDetail>("/" + crewId, "GET", undefined, guestCookie));
    assert.equal(publicView.myRole, null);
    assert.equal(publicView.requests, null);
    assert.equal(JSON.stringify(publicView).includes(String(owner[0]!.owner_id)), false);
    assert.equal(JSON.stringify(publicView).includes(account.userId), false);
    const playerGuest = await pageHtml("/players");
    assertPeopleSelection(playerGuest, "players");
    assert.match(playerGuest, /로그인/);
    assert.equal(
      [...playerGuest.matchAll(/href="\/players\/[a-f0-9-]{36}"/g)].length,
      0,
      "Guest HTML contains no individual player profile links",
    );
    assert.equal(playerGuest.includes(String(owner[0]!.owner_id)), false);
    assert.equal(playerGuest.includes(account.userId), false);
    const playerApi = await fetch(origin + "/api/players", { headers: { Cookie: guestCookie } });
    assert.equal(playerApi.status, 401);
    assert.match(playerApi.headers.get("cache-control") ?? "", /private.*no-store/);
    const denied = (await playerApi.json()) as ActionResult<unknown>;
    assert.equal(denied.ok, false);
    assert.equal(Object.hasOwn(denied, "data"), false);
    const filters = new URLSearchParams({
      tab: "crews",
      q: input.name,
      category: "party",
      mine: "0",
      page: "1",
    });
    const crewGuest = await pageHtml("/players?" + filters);
    assertPeopleSelection(crewGuest, "crews");
    assert.ok(
      crewGuest.includes('href="/crews/' + crewId + '"'),
      "Public filtered crew appears in server HTML",
    );
    assert.ok(crewGuest.includes(input.name));
    assert.equal(crewGuest.includes(String(owner[0]!.owner_id)), false);
    const otherTopic = new URLSearchParams(filters);
    otherTopic.set("category", "travel");
    assert.equal(
      (await pageHtml("/players?" + otherTopic)).includes('href="/crews/' + crewId + '"'),
      false,
    );
    filters.set("mine", "1");
    assert.ok(
      (await pageHtml("/players?" + filters)).includes('href="/crews/' + crewId + '"'),
      "Guest mine flag preserves public crew policy",
    );
    const memberOwnCrews = await pageHtml("/players?" + filters, memberCookie);
    assertPeopleSelection(memberOwnCrews, "crews");
    assert.equal(
      memberOwnCrews.includes('href="/crews/' + crewId + '"'),
      false,
      "Authenticated mine filter excludes another member's crew",
    );
    assert.ok(
      (await pageHtml("/players?" + filters, "")).includes('href="/crews/' + crewId + '"'),
      "Owner mine filter includes their crew",
    );
    const legacyFilters = new URLSearchParams({
      q: input.name,
      category: "party",
      mine: "1",
      page: "2",
    });
    const redirected = await fetch(origin + "/crews?" + legacyFilters, {
      redirect: "manual",
      headers: { Cookie: guestCookie },
    });
    assert.equal(redirected.status, 308);
    const target = new URL(redirected.headers.get("location")!, origin);
    assert.equal(target.pathname, "/players");
    assert.equal(target.searchParams.get("tab"), "crews");
    for (const [key, value] of legacyFilters)
      assert.equal(target.searchParams.get(key), value, key);
    const crewDetail = await pageHtml("/crews/" + crewId);
    assertPeopleSelection(crewDetail);
    assert.ok(crewDetail.includes(input.name));
    assert.equal(
      (await api("/" + crewId + "/requests", "GET", undefined, memberCookie)).status,
      403,
    );
    assert.equal(
      (
        await api(
          "/" + crewId + "/join",
          "POST",
          { message: "함께 진행하고 싶습니다." },
          memberCookie,
        )
      ).status,
      400,
    );
    data(
      await api(
        "/" + crewId + "/join",
        "POST",
        { message: "함께 진행하고 싶습니다.", publicNameConsent: true },
        memberCookie,
      ),
    );
    const queue = data(await api<CrewPage<CrewJoinRequest>>("/" + crewId + "/requests"));
    assert.equal(queue.items.length, 1);
    data(
      await api("/" + crewId + "/requests/decision", "POST", {
        requestId: queue.items[0]!.id,
        approve: true,
      }),
    );
    const joined = data(await api<CrewDetail>("/" + crewId, "GET", undefined, memberCookie));
    assert.equal(joined.myRole, "member");
    assert.equal(joined.memberCount, 2);
    assert.equal(joined.requests, null);
    assert.equal(
      (await api("/" + crewId + "/announcements", "POST", { body: "일반 멤버 공지" }, memberCookie))
        .status,
      403,
    );
    assert.equal((await api("/" + crewId + "/leave", "POST", {})).status, 409);
    const member = joined.members.find((item) => item.role === "member")!;
    data(
      await api("/" + crewId + "/members/role", "POST", {
        memberPublicId: member.publicId,
        role: "manager",
      }),
    );
    assert.equal(
      (await api("/" + crewId + "/requests", "GET", undefined, memberCookie)).status,
      200,
    );
    assert.equal(
      (
        await api(
          "/" + crewId + "/members/role",
          "POST",
          { memberPublicId: member.publicId, role: "member" },
          memberCookie,
        )
      ).status,
      403,
    );
    data(
      await api(
        "/" + crewId + "/announcements",
        "POST",
        { body: "담당 운영진의 **공지**입니다." },
        memberCookie,
      ),
    );
    data(await api("/" + crewId + "/members/remove", "POST", { memberPublicId: member.publicId }));
    assert.equal(
      (await api("/" + crewId + "/requests", "GET", undefined, memberCookie)).status,
      403,
    );
    assert.equal(
      (
        await api(
          "/" + crewId + "/announcements",
          "POST",
          { body: "권한이 취소된 운영진 공지" },
          memberCookie,
        )
      ).status,
      403,
    );
    const before = data(await api<CrewDetail>("/" + crewId));
    const changed = data(
      await api<CrewDetail>("/" + crewId, "PATCH", {
        ...input,
        region: "경기",
        expectedUpdatedAt: before.updatedAt,
      }),
    );
    assert.equal(changed.region, "경기");
    assert.equal(
      (
        await api("/" + crewId, "PATCH", {
          ...input,
          region: "부산",
          expectedUpdatedAt: before.updatedAt,
        })
      ).status,
      409,
    );
    data(await api("/" + crewId + "/archive", "POST", {}));
    assert.equal(data(await api<CrewDetail>("/" + crewId)).archived, true);
    assert.equal(
      (
        await api(
          "/" + crewId + "/join",
          "POST",
          { message: "다시 신청합니다.", publicNameConsent: true },
          memberCookie,
        )
      ).status,
      409,
    );
    const page = await fetch(origin + "/crews/" + crewId, {
      headers: { Cookie: guestCookie },
      signal: AbortSignal.timeout(60000),
    });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /크루/);
    const head = await api("", "HEAD", undefined, guestCookie);
    assert.equal(head.status, 200);
    assert.match(head.headers.get("cache-control") ?? "", /private.*no-store/);
  } finally {
    if (crewId) await db`delete from sliper.crews where id=${crewId}::uuid`;
    await db.end();
  }
});
