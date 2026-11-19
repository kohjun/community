import { test } from "node:test";
import assert from "node:assert/strict";
import { homeRecruitments } from "../src/domain/home-discovery";
import type { CommunityPost } from "../src/domain/community";
const post = (patch: Partial<CommunityPost>) =>
  ({
    id: "one",
    kind: "모집",
    sample: false,
    eventAvailable: false,
    likes: 0,
    createdAt: "2026-01-01",
    ...patch,
  }) as CommunityPost;
test("home recruitment preserves existing editorial samples, prioritizes real open events and removes duplicates", () => {
  const sample = post({ id: "sample", sample: true, featured: true, likes: 999 }),
    active = post({ id: "active", eventAvailable: true, likes: 1 }),
    story = post({ id: "story", kind: "이야기" });
  const { event: result } = homeRecruitments([active], [sample, active, story]);
  assert.deepEqual(
    result.map((p) => p.id),
    ["active", "sample"],
  );
  assert.equal(result[1]!.sample, true);
  assert.equal(result[1]!.eventAvailable, false);
});

test("home recruitment limits each meetup type independently and excludes crews and closed events", () => {
  const active = post({ id: "active", eventAvailable: true });
  const closed = post({ id: "closed", likes: 200 });
  const cancelled = post({ id: "cancelled", eventAvailable: true, eventCancelledAt: "2026-01-01" });
  const crew = post({ id: "crew", category: "crew", eventAvailable: true });
  const lightning = post({ id: "lightning", meetupType: "lightning", eventAvailable: true });
  const samples = Array.from({ length: 12 }, (_, index) =>
    post({ id: `sample-${index}`, sample: true }),
  );
  const result = homeRecruitments(
    [active, crew],
    [samples[0]!, closed, cancelled],
    [active, ...samples, lightning],
  );

  assert.equal(result.event.length, 12);
  assert.equal(result.event[0]?.id, active.id);
  assert.equal(new Set(result.event.map(({ id }) => id)).size, 12);
  assert.ok(result.event.slice(1).every(({ sample }) => sample));
  assert.deepEqual(result.lightning, [lightning]);
});
