import "dotenv/config";
import { installDevelopmentProfileFixture } from "./helpers/development-profile-fixture";
installDevelopmentProfileFixture();
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { posts } from "../src/db/schema";
import type { ActionResult } from "../src/domain/contracts";
import type { CommunitySnapshot } from "../src/domain/community";
import type { EventOverview } from "../src/domain/participation";

const origin = "http://127.0.0.1:3000",
  address = new URL(process.env.MIGRATION_DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev" ||
  process.env.APP_ORIGIN !== origin
)
  throw new Error("Lightning API tests are isolated-local only.");
async function api<T>(path: string, method = "GET", body?: unknown, from = origin) {
  const response = await fetch(origin + path, {
    method,
    headers: { Origin: from, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, result: (await response.json()) as ActionResult<T> };
}
function data<T>(value: { status: number; result: ActionResult<T> }): T {
  assert.equal(value.status, 200, JSON.stringify(value.result));
  if (!value.result.ok) throw new Error(value.result.error.message);
  return value.result.data;
}
test("lightning HTTP creation validates its scope, persists coordinates and enrolls free attendees into the announcement room", async () => {
  const connection = createDatabase(address.href, 1);
  let postId: string | undefined;
  const startsAt = new Date(Date.now() + 2 * 3600000).toISOString();
  const input = {
    categorySlug: "mind-games",
    activityCategory: "games",
    activityTags: ["방탈출", "보드게임"],
    title: `[HTTP 번개] ${randomUUID().slice(0, 8)}`,
    description: "실제 HTTP와 PostgreSQL에서 무료 번개 신청과 위치 검색을 검사하는 모임입니다.",
    location: "서울숲 테스트 행사장",
    venue: { latitude: 37.5445, longitude: 127.0374 },
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
    capacity: 4,
    priceKRW: 0,
    applicationUrl: null,
  };
  try {
    assert.equal(
      (await api("/api/lightning", "POST", input, "https://example.invalid")).status,
      403,
    );
    for (const invalid of [
      { ...input, ownerId: randomUUID() },
      { ...input, categorySlug: "knowledge" },
      { ...input, activityCategory: "unknown-category" },
      { ...input, activityTags: ["중복", "중복"] },
      { ...input, activityTags: ["1", "2", "3", "4", "5", "6"] },
      { ...input, activityTags: [""] },
      { ...input, capacity: 13 },
      { ...input, priceKRW: 1000 },
      { ...input, applicationUrl: "javascript:alert(1)" },
      { ...input, applicationUrl: "https://user:password@example.invalid/apply" },
      { ...input, applicationUrl: "https://example.invalid/has space" },
      { ...input, priceKRW: 10000001, applicationUrl: "https://example.invalid/apply" },
      { ...input, venue: { latitude: 100, longitude: 127 } },
      {
        ...input,
        startsAt: new Date(Date.now() - 86400000).toISOString(),
        endsAt: new Date(Date.now() - 86400000 + 3600000).toISOString(),
      },
      {
        ...input,
        startsAt: new Date(Date.now() + 8 * 86400000).toISOString(),
        endsAt: new Date(Date.now() + 8 * 86400000 + 3600000).toISOString(),
      },
    ]) {
      assert.equal((await api("/api/lightning", "POST", invalid)).status, 400);
    }
    const created = data(
      await api<{ postId: string; applicationUrl: string; managementUrl: string }>(
        "/api/lightning",
        "POST",
        input,
      ),
    );
    postId = created.postId;
    assert.equal(created.applicationUrl, `/events/${postId}`);
    assert.equal(created.managementUrl, `/management/events/${postId}`);
    const overview = data(await api<EventOverview>(`/api/participation/events/${postId}`));
    assert.equal(overview.isOwner, true);
    assert.equal(overview.externalUrl, null);
    assert.equal(overview.config?.amountKRW, 0);
    assert.equal(overview.config?.capacity, 4);
    assert.equal(overview.config?.startsAt, startsAt);
    const feed = data(
      await api<CommunitySnapshot>("/api/community?eventOnly=true&meetupType=lightning"),
    );
    const post = feed.posts.find((item) => item.id === postId);
    assert.ok(post);
    assert.equal(post.meetupType, "lightning");
    assert.equal(post.activityCategory, "games");
    assert.deepEqual(post.tags, ["방탈출", "보드게임"]);
    const categorized = data(
      await api<CommunitySnapshot>(
        "/api/community?meetupType=lightning&activityCategory=games&tag=" +
          encodeURIComponent("방탈출"),
      ),
    );
    assert.ok(categorized.posts.some((item) => item.id === postId));
    const searchedTag = data(
      await api<CommunitySnapshot>(
        "/api/community?meetupType=lightning&activityCategory=games&search=" +
          encodeURIComponent("보드게임"),
      ),
    );
    assert.ok(searchedTag.posts.some((item) => item.id === postId));
    const otherActivity = data(
      await api<CommunitySnapshot>("/api/community?meetupType=lightning&activityCategory=culture"),
    );
    assert.ok(!otherActivity.posts.some((item) => item.id === postId));
    assert.equal((await api("/api/community?activityCategory=games")).status, 400);
    assert.equal(
      (await api("/api/community?meetupType=lightning&activityCategory=invalid")).status,
      400,
    );
    assert.equal(post.venueLatitude, input.venue.latitude);
    assert.equal(post.venueLongitude, input.venue.longitude);
    const query = `eventOnly=true&meetupType=lightning&sort=nearest&latitude=${input.venue.latitude}&longitude=${input.venue.longitude}&radiusKm=1`;
    const near = data(await api<CommunitySnapshot>(`/api/community?${query}`));
    assert.ok(near.posts.some((item) => item.id === postId && item.distanceKm === 0));
    const far = data(
      await api<CommunitySnapshot>(
        "/api/community?eventOnly=true&meetupType=lightning&sort=nearest&latitude=35.1796&longitude=129.0756&radiusKm=1",
      ),
    );
    assert.ok(!far.posts.some((item) => item.id === postId));
    const applied = data(
      await api<EventOverview>(`/api/participation/events/${postId}/applications`, "POST", {
        consent: true,
        note: "테스트 완료 후 이 fixture만 정리합니다.",
      }),
    );
    assert.equal(applied.application?.status, "confirmed");
    assert.equal(applied.application?.amountKRW, 0);
    assert.equal(applied.application?.orderId, null);
    const memberships = await connection.db.execute<{ post_id: string }>(
      sql`select post_id from sliper.room_members where post_id=${postId} and application_id=${applied.application!.id} and revoked_at is null`,
    );
    assert.equal(memberships.length, 1);
    const page = await fetch(
      `${origin}/lightning?activityCategory=games&tag=${encodeURIComponent("방탈출")}`,
    );
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /지금.*같이 놀 사람/);
    assert.match(html, /어떤 활동을 찾나요/);
    assert.ok(html.includes(input.title));
    assert.match(html, /게임·방탈출/);
  } finally {
    if (postId) {
      await connection.db.execute(
        sql`delete from sliper.activity_events where source_key=${`post:${postId}`}`,
      );
      await connection.db.delete(posts).where(eq(posts.id, postId));
    }
    await connection.close();
  }
});

test("external lightning HTTP uses real platform amounts, confirmation and owner approval before invitation", async () => {
  const connection = createDatabase(address.href, 1);
  const fixtureIds: string[] = [];
  try {
    for (const priceKRW of [0, 12000]) {
      const startsAt = new Date(Date.now() + 2 * 3600000).toISOString();
      const created = data(
        await api<{ postId: string; applicationUrl: string; externalUrl: string }>(
          "/api/lightning",
          "POST",
          {
            categorySlug: "party",
            activityCategory: "games",
            title: "[HTTP 외부 번개] " + randomUUID().slice(0, 8),
            description: "외부 신청 번호와 결제 금액 확인 후 공지방에 초대되는 번개입니다.",
            location: "외부 번개 테스트 장소",
            venue: { latitude: 37.5, longitude: 127 },
            startsAt,
            endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
            capacity: 2,
            priceKRW,
            applicationUrl: " HTTPS://EXAMPLE.INVALID/lightning ",
          },
        ),
      );
      const postId = created.postId;
      fixtureIds.push(postId);
      assert.equal(created.applicationUrl, "/events/" + postId);
      assert.equal(created.externalUrl, "https://example.invalid/lightning");
      const before = data(await api<EventOverview>("/api/participation/events/" + postId));
      assert.equal(before.externalUrl, created.externalUrl);
      assert.equal(before.config?.amountKRW, priceKRW);
      assert.equal(before.application, null);
      assert.equal(
        (
          await api("/api/participation/events/" + postId + "/applications", "POST", {
            consent: true,
          })
        ).status,
        409,
      );
      const page = await fetch(origin + "/events/" + postId);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.ok(html.includes("외부 플랫폼에서 신청하기"));
      assert.ok(html.includes(created.externalUrl));
      const claimed = data(
        await api<EventOverview>(
          "/api/participation/events/" + postId + "/external-confirmation",
          "POST",
          { consent: true, refundConsent: true, externalReference: "EXT-HTTP-" + randomUUID() },
        ),
      );
      assert.equal(claimed.application!.source, "external");
      assert.equal(claimed.application!.status, "pending_approval");
      assert.equal(claimed.application!.amountKRW, priceKRW);
      const memberCount = async () => {
        const [count] = await connection.db.execute<{ count: number }>(
          sql`select count(*)::int as count from sliper.room_members where post_id=${postId} and revoked_at is null`,
        );
        return count!.count;
      };
      assert.equal(await memberCount(), 0);
      data(
        await api(
          "/api/participation/applications/" + claimed.application!.id + "/decision",
          "POST",
          { decision: "approve", paymentChecked: true },
        ),
      );
      const confirmed = data(await api<EventOverview>("/api/participation/events/" + postId));
      assert.equal(confirmed.application!.status, "confirmed");
      assert.equal(confirmed.application!.orderId, null);
      assert.equal(await memberCount(), 1);
    }
  } finally {
    for (const postId of fixtureIds) {
      await connection.db.execute(
        sql`delete from sliper.external_receipts where post_id=${postId}`,
      );
      await connection.db.execute(
        sql`delete from sliper.activity_events where source_key=${"post:" + postId}`,
      );
      await connection.db.delete(posts).where(eq(posts.id, postId));
    }
    await connection.close();
  }
});
