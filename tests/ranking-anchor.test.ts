import assert from "node:assert/strict";
import test from "node:test";
import { adoptServerRankingAnchor } from "../src/lib/ranking-anchor";
import { communityLocation, communityLocationUrl } from "../src/domain/community-location";

const anchor = "2026-10-16T01:00:00.000Z";
test("fresh popular requests take the server response anchor regardless of a fast or slow device clock", (context) => {
  for (const delta of [-60000, 60000]) {
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(anchor) + delta });
    const query = { sort: "popular", period: "today", category: "party" } as const;
    const adopted = adoptServerRankingAnchor(query, anchor);
    assert.equal(Object.hasOwn(query, "rankingAt"), false);
    assert.deepEqual(adopted, { ...query, rankingAt: anchor });
    assert.equal(adoptServerRankingAnchor(adopted!, "2026-10-16T01:02:00.000Z"), null);
    context.mock.timers.reset();
  }
});
test("only a fresh period ranking adopts an anchor; existing windows and non-ranking feeds do not change", () => {
  assert.equal(adoptServerRankingAnchor({ sort: "latest", period: "today" }, anchor), null);
  assert.equal(adoptServerRankingAnchor({ sort: "popular", period: "all" }, anchor), null);
  assert.equal(
    adoptServerRankingAnchor({ sort: "popular", period: "week", rankingAt: anchor }, anchor),
    null,
  );
  assert.equal(adoptServerRankingAnchor({ sort: "popular", period: "week" }, undefined), null);
  assert.equal(adoptServerRankingAnchor({ sort: "popular", period: "week" }, "invalid"), null);
});
test("history restoration preserves server anchors and page positions even on a slow device", () => {
  const query = { sort: "popular", period: "week", rankingAt: anchor } as const;
  const url = communityLocationUrl("https://sliper.example/stories#feed", query, 3);
  const params = new URL(url, "https://sliper.example").searchParams;
  const restored = communityLocation(params, true, Number.POSITIVE_INFINITY);
  assert.equal(restored.rankingAt, anchor);
  assert.equal(restored.page, 3);
  assert.equal(restored.period, "week");
  assert.equal(adoptServerRankingAnchor(restored, "2026-10-16T01:05:00.000Z"), null);
  // Server-side parsing still rejects anchors beyond its own time.
  assert.equal(communityLocation(params, true, Date.parse(anchor) - 60000).rankingAt, undefined);
});
