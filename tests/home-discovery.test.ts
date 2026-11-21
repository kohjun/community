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
test("home recruitment includes real open events once and excludes editorial samples", () => {
  const sample = post({ id: "sample", sample: true, featured: true, likes: 999 }),
    active = post({ id: "active", eventAvailable: true, likes: 1 }),
    story = post({ id: "story", kind: "이야기" });
  const { event: result } = homeRecruitments([active], [sample, active, story]);
  assert.deepEqual(result, [active]);
});

test("home recruitment limits each meetup type independently and excludes crews and closed events", () => {
  const active = post({ id: "active", eventAvailable: true });
  const closed = post({ id: "closed", likes: 200 });
  const cancelled = post({ id: "cancelled", eventAvailable: true, eventCancelledAt: "2026-01-01" });
  const crew = post({ id: "crew", category: "crew", eventAvailable: true });
  const lightning = post({ id: "lightning", meetupType: "lightning", eventAvailable: true });
  const moreOpenEvents = Array.from({ length: 12 }, (_, index) =>
    post({ id: `open-${index}`, eventAvailable: true }),
  );
  const result = homeRecruitments(
    [active, crew],
    [moreOpenEvents[0]!, closed, cancelled],
    [active, ...moreOpenEvents, lightning],
  );

  assert.equal(result.event.length, 12);
  assert.equal(result.event[0]?.id, active.id);
  assert.equal(new Set(result.event.map(({ id }) => id)).size, 12);
  assert.ok(result.event.every(({ sample, eventAvailable }) => !sample && eventAvailable));
  assert.deepEqual(result.lightning, [lightning]);
});
