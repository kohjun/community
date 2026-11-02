import assert from "node:assert/strict";
import test from "node:test";
import { feedFilterKey } from "../src/lib/feed-query-key";
import { communityLocation } from "../src/domain/community-location";

const anchor = "2026-10-16T01:00:00.000Z";
test("SSR defaults and client defaults identify the same initial feed without a second load", () => {
  const server = communityLocation(new URLSearchParams());
  const client = { focus: "all", view: "home", sort: "latest", period: "today" } as const;
  assert.equal(feedFilterKey(server), feedFilterKey(client));
  assert.equal(feedFilterKey({ ...server, page: 999 }), feedFilterKey(client));
  assert.equal(
    feedFilterKey({ period: "today", sort: "latest", rankingAt: anchor }),
    feedFilterKey(client),
  );
});
test("popular window, review scope, event filters and owner-specific views cannot reuse a different feed", () => {
  const base = { sort: "popular", period: "today", rankingAt: anchor } as const;
  for (const query of [
    { ...base, rankingAt: "2026-10-16T02:00:00.000Z" },
    { ...base, period: "week" as const },
    { ...base, category: "party" as const },
    { ...base, kind: "후기" as const },
    { ...base, kind: "이야기" as const },
    { ...base, view: "bookmarks" as const },
    { ...base, focus: "interests" as const },
    { ...base, latitude: 37.5, longitude: 127, radiusKm: 1 },
  ])
    assert.notEqual(feedFilterKey(base), feedFilterKey(query));
  assert.notEqual(feedFilterKey({ kind: "후기" }), feedFilterKey({ kind: "이야기" }));
  assert.equal(
    feedFilterKey({ ...base, period: "all" }),
    feedFilterKey({ sort: "popular", period: "all" }),
  );
});
