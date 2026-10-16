import "dotenv/config";
import { installDevelopmentProfileFixture } from "./helpers/development-profile-fixture";
installDevelopmentProfileFixture();
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
const origin = "http://127.0.0.1:3000";
const address = new URL(process.env.MIGRATION_DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev" ||
  process.env.APP_ORIGIN !== origin
)
  throw new Error("Only the isolated local development database is allowed.");
async function api(path: string, method = "GET", body?: unknown, guest = false) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(guest ? { Cookie: "sliper_test_session=invalid" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  return { status: response.status, result, headers: response.headers };
}
async function ok(path: string, method = "GET", body?: unknown, guest = false) {
  const result = await api(path, method, body, guest);
  assert.equal(result.status, 200, path);
  assert.equal(result.result.ok, true, path);
  return result.result.data;
}
test("topic and archive HTTP discovery share strict queries, current source ACL and safe rendered summaries", async () => {
  const db = postgres(address.href, { max: 1, prepare: false });
  const entryIds: string[] = [],
    postIds: string[] = [];
  const marker = "discovery-http-" + randomUUID().slice(0, 8);
  const privateMarker = "PROTECTED-GUIDE-" + randomUUID();
  const content = {
    kind: "template",
    categorySlug: "mind-games",
    title: marker + " 준비 자료",
    summary: "실제 HTTP 탐색과 주제별 연결을 검증하는 명시적 태그가 있는 진행 자료입니다.",
    scenario: privateMarker + " 진행자는 참가자에게 비공개 역할 카드를 나눠줍니다.",
    rules: "정해진 토론 순서를 지키고 상대방의 역할 카드를 열어보지 않습니다.",
    materials: ["역할카드", "타이머"],
    hostGuide: "첫 라운드의 순서와 규칙을 설명한 뒤 게임을 진행해주세요.",
    minPlayers: 4,
    maxPlayers: 8,
    durationMinutes: 60,
    rounds: [{ name: "추리", seconds: 300 }],
    tags: ["추리게임", "마피아"],
    priceKRW: 0,
    purchaseUrl: null,
    discoveryMetadata: { preparationDifficulty: "easy", environment: "indoor", requiredStaff: 0 },
  };
  try {
    const free = await ok("/api/library", "POST", content);
    entryIds.push(free.id);
    const paid = await ok("/api/library", "POST", {
      ...content,
      kind: "rulebook",
      title: marker + " 유료 자료",
      priceKRW: 12000,
      purchaseUrl: "https://example.invalid/purchase",
      discoveryMetadata: null,
    });
    entryIds.push(paid.id);
    const query = new URLSearchParams({
      search: marker,
      players: "8",
      maxDurationMinutes: "60",
      price: "free",
      difficulty: "easy",
      environment: "indoor",
      maxStaff: "0",
    });
    const filtered = await ok("/api/library?" + query, "GET", undefined, true);
    assert.deepEqual(
      filtered.items.map((row: { id: string }) => row.id),
      [free.id],
    );
    assert.equal(filtered.items[0].discoveryMetadata.requiredStaff, 0);
    assert.equal(JSON.stringify(filtered).includes(privateMarker), false);
    assert.equal(
      (await ok("/api/library?search=" + marker + "&price=paid", "GET", undefined, true)).items[0]
        .id,
      paid.id,
    );
    assert.equal((await api("/api/library?used=true", "GET", undefined, true)).status, 401);
    for (const invalid of [
      "players=0",
      "maxDurationMinutes=4",
      "maxStaff=101",
      "players=8&players=9",
      "unexpected=1",
      "used=yes",
    ])
      assert.equal((await api("/api/library?" + invalid)).status, 400, invalid);
    const storyInput = {
      categorySlug: "mind-games",
      kind: "이야기",
      title: marker + " 관련 이야기",
      bodyMarkdown: "이 주제에서 재미있었던 추리 방식과 운영 경험을 이야기합니다.",
      tags: ["# 추리게임", "마피아"],
      isAnonymous: false,
      discussionType: "tip",
    };
    const story = await ok("/api/community/posts", "POST", storyInput);
    postIds.push(story.id);
    const untagged = await ok("/api/community/posts", "POST", {
      ...storyInput,
      title: marker + " 마피아 제목만 있는 글",
      tags: [],
    });
    postIds.push(untagged.id);
    const spoiler = await ok("/api/community/posts", "POST", {
      ...storyInput,
      title: marker + " 비밀 결말",
      bodyMarkdown: privateMarker,
      spoiler: true,
      spoilerTitle: "시청 후 읽는 이야기",
      spoilerSummary: "내용에는 결말이 포함되어 있어요.",
    });
    postIds.push(spoiler.id);
    const starts = new Date(Date.now() + 10 * 86400000);
    const hosted = await ok(`/api/library/${free.id}/host`, "POST", {
      title: marker + " 함께하는 추리",
      location: "서울 테스트 장소",
      startsAt: starts.toISOString(),
      endsAt: new Date(starts.getTime() + 60 * 60000).toISOString(),
      amountKRW: 0,
      capacity: 8,
      applicationUrl: null,
      description: "서로의 생각을 읽고 함께 게임을 즐기는 HTTP 검사 전용 행사입니다.",
    });
    postIds.push(hosted.postId);
    const catalog = await ok("/api/topics", "GET", undefined, true);
    assert.equal(catalog.topics.length, 3);
    const topicResponse = await api("/api/topics/mystery", "GET", undefined, true);
    assert.equal(topicResponse.status, 200);
    assert.match(topicResponse.headers.get("cache-control") ?? "", /no-store/);
    const topic = topicResponse.result.data;
    assert.equal(
      topic.stories.items.some((row: { id: string }) => row.id === story.id),
      true,
    );
    assert.equal(
      topic.stories.items.some(
        (row: { id: string }) => row.id === untagged.id || row.id === spoiler.id,
      ),
      false,
    );
    assert.equal(
      topic.recruitment.items.some((row: { id: string }) => row.id === hosted.postId),
      true,
    );
    assert.equal(
      topic.library.items.filter((row: { id: string }) => entryIds.includes(row.id)).length,
      2,
    );
    assert.equal(JSON.stringify(topic).includes(privateMarker), false);
    assert.equal(
      (await ok("/api/topics/mystery?focus=interests", "GET", undefined, true)).interestFeed,
      "login",
    );
    for (const invalid of ["storiesPage=0", "focus=all&focus=interests", "unexpected=1"])
      assert.equal((await api("/api/topics/mystery?" + invalid)).status, 400, invalid);
    assert.equal((await api("/api/topics/unknown")).status, 404);
    await db`update sliper.library_entries set status='draft' where id=${paid.id}::uuid`;
    assert.equal(
      (await ok("/api/topics/mystery", "GET", undefined, true)).library.items.some(
        (row: { id: string }) => row.id === paid.id,
      ),
      false,
    );
    for (const page of [
      "/topics",
      "/topics/mystery",
      "/topics/mission-race",
      "/topics/social-party",
      "/archive?" + query,
    ]) {
      const response = await fetch(origin + page, { signal: AbortSignal.timeout(60000) });
      assert.equal(response.status, 200, page);
      const html = await response.text();
      assert.equal(html.includes(privateMarker), false, page);
      assert.ok(html.includes('href="/topics"'), page + " shared topic navigation");
    }

    // Test real SSR entry points rather than only the URL helpers: paid summaries expose
    // public topic relationships, while draft and spoiler detail pages never advertise them.
    for (const path of ["/archive/" + free.id, "/posts/" + story.id]) {
      const response = await fetch(origin + path, { signal: AbortSignal.timeout(60000) });
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.ok(html.includes('aria-label="관련 주제"'), path);
      assert.ok(html.includes('href="/topics/mystery"'), path);
    }
    for (const path of ["/archive/" + paid.id, "/posts/" + spoiler.id]) {
      const response = await fetch(origin + path, { signal: AbortSignal.timeout(60000) });
      assert.equal(response.status, 200, path);
      assert.equal((await response.text()).includes('aria-label="관련 주제"'), false, path);
    }
    const newTemplateResponse = await fetch(
      origin + "/archive/new?kind=template&topic=mission-race",
      { signal: AbortSignal.timeout(60000) },
    );
    assert.equal(newTemplateResponse.status, 200);
    const newTemplateHtml = await newTemplateResponse.text();
    assert.ok(newTemplateHtml.includes('value="미션레이스"'));
    assert.ok(newTemplateHtml.includes('value="race" selected=""'));
    assert.ok(newTemplateHtml.includes("연결될 주제: 미션 레이스"));
    const guestCreateResponse = await fetch(
      origin + "/archive/new?kind=template&topic=mission-race",
      {
        headers: { Cookie: "sliper_test_session=invalid" },
        redirect: "manual",
        signal: AbortSignal.timeout(60000),
      },
    );
    assert.equal(guestCreateResponse.status, 307);
    assert.equal(
      new URL(guestCreateResponse.headers.get("location")!, origin).searchParams.get("returnTo"),
      "/archive/new?kind=template&topic=mission-race",
    );
    const guestStoryResponse = await fetch(
      origin +
        "/stories?category=race&kind=" +
        encodeURIComponent("모집") +
        "&composeTopic=mission-race",
      {
        headers: { Cookie: "sliper_test_session=invalid" },
        redirect: "manual",
        signal: AbortSignal.timeout(60000),
      },
    );
    assert.equal(guestStoryResponse.status, 307);
    const storyReturn = new URL(
      new URL(guestStoryResponse.headers.get("location")!, origin).searchParams.get("returnTo")!,
      origin,
    );
    assert.equal(storyReturn.pathname, "/stories");
    assert.equal(storyReturn.searchParams.get("composeTopic"), "mission-race");
    assert.equal(storyReturn.searchParams.get("kind"), "모집");
    const invalidPage = await fetch(origin + "/archive?players=0");
    assert.equal(invalidPage.status, 200);
    assert.ok((await invalidPage.text()).includes("검색 조건을 확인할 수 없어"));
  } finally {
    for (const id of postIds) await db`delete from sliper.posts where id=${id}::uuid`;
    for (const id of entryIds) await db`delete from sliper.library_entries where id=${id}::uuid`;
    await db.end();
  }
});
