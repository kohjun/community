import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { ActionResult } from "../src/domain/contracts";
import type { SearchPage } from "../src/domain/search";
const origin = "http://127.0.0.1:3000";
const url = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw new Error("Search API checks require the isolated local development database.");
async function api(path: string, method = "GET") {
  const response = await fetch(origin + path, {
    method,
    headers: { Cookie: "sliper_test_session=invalid" },
    signal: AbortSignal.timeout(60000),
  });
  return response;
}
async function result(path: string): Promise<SearchPage> {
  const response = await api(path);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  const envelope = (await response.json()) as ActionResult<SearchPage>;
  assert.ok(envelope.ok, "Search API returned an error.");
  return envelope.data;
}
test("unified search API validates bounded filters, literal patterns and cache policy", async () => {
  for (const path of [
    "/api/search?q=%00",
    "/api/search?type=private",
    "/api/search?category=unknown",
    "/api/search?page=51",
    "/api/search?page=0",
    "/api/search?q=a&q=b",
    "/api/search?unknown=1",
    "/api/search?q=" + "x".repeat(101),
  ])
    assert.equal((await api(path)).status, 400);
  const empty = await result("/api/search");
  assert.equal(empty.total, 0);
  assert.equal(empty.items.length, 0);
  const literal = await result("/api/search?q=" + encodeURIComponent("%' OR true --"));
  assert.equal(literal.total, 0);
  const head = await api("/api/search", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});
test("unified search HTTP returns all four kinds, private-safe snippets and direct pages", async () => {
  const db = postgres(url.toString(), { prepare: false, max: 1 });
  const owner = randomUUID(),
    keyword = "검색검사" + randomUUID(),
    postIds: string[] = [],
    entryIds: string[] = [];
  try {
    await db`insert into auth.users(id) values(${owner}::uuid)`;
    await db`insert into sliper.profiles(id,nickname) values(${owner}::uuid,'검색검사작성자')`;
    for (const kind of ["이야기", "모집"]) {
      const [record] = await db`
        insert into sliper.posts(author_id,category_slug,kind,title,body_markdown,is_anonymous,sample)
        values(${owner}::uuid,'party',${kind},${keyword + " " + kind},'본문 앞 문장과 영상 후 문장.',true,true)
        returning id`;
      postIds.push(String(record!.id));
    }
    for (const kind of ["rulebook", "template"]) {
      const [record] = await db`
        insert into sliper.library_entries(owner_id,kind,category_slug,title,summary,scenario,rules,host_guide,
          materials,rounds,tags,min_players,max_players,duration_minutes,price_krw,purchase_url,sample)
        values(${owner}::uuid,${kind},'party',${keyword + " " + kind},
          '함께 즐기는 모임의 공개 소개입니다.',
          ${"개인시나리오" + keyword + "를 구매 후에 읽을 수 있는 자료입니다."},
          '공개되지 않는 규칙 내용을 안내합니다.',
          '공개되지 않는 진행자 멘트 내용입니다.',
          ARRAY['비공개 준비물'], '[{"name":"첫 미션","seconds":300}]'::jsonb,
          ARRAY['실내'],4,12,60,10000,'https://example.com/purchase',true)
        returning id`;
      entryIds.push(String(record!.id));
    }
    const all = await result("/api/search?q=" + encodeURIComponent(keyword));
    assert.equal(all.total, 4);
    assert.deepEqual(all.counts, {
      all: 4,
      story: 1,
      recruitment: 1,
      rulebook: 1,
      template: 1,
      record: 0,
    });
    assert.equal(JSON.stringify(all).includes(owner), false);
    assert.equal(JSON.stringify(all).includes("개인시나리오"), false);
    assert.equal(all.items.filter((item) => item.author === "익명").length, 2);
    const privateMatch = await result(
      "/api/search?q=" + encodeURIComponent("개인시나리오" + keyword),
    );
    assert.equal(privateMatch.total, 0);
    const rules = await result("/api/search?q=" + encodeURIComponent(keyword) + "&type=rulebook");
    assert.equal(rules.total, 1);
    const page = await api("/search?q=" + encodeURIComponent(keyword));
    assert.equal(page.status, 200);
    assert.match(await page.text(), /unified-search-results/);
    for (const item of all.items) {
      assert.ok(/^\/(posts|archive|templates)\/[a-f0-9-]+$/.test(item.href));
    }
  } finally {
    if (entryIds.length)
      await db`delete from sliper.library_entries where id=any(${entryIds}::uuid[])`;
    if (postIds.length) await db`delete from sliper.posts where id=any(${postIds}::uuid[])`;
    await db`delete from auth.users where id=${owner}::uuid`;
    await db.end();
  }
});
