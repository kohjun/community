import { test } from "node:test";
import assert from "node:assert/strict";
import { homeRecruitments } from "../src/domain/home-discovery";
import type { CommunityPost } from "../src/domain/community";
import { JANUARY_RECRUITMENTS } from "../src/demo/january-recruitments";
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

test("curated January samples fill only the empty meetup type and expire by start time", () => {
  const samples = JANUARY_RECRUITMENTS.map(({ postId, startsAt, type }) =>
    post({ id: postId, eventStartsAt: startsAt, meetupType: type, sample: true }),
  ).reverse();
  const upcoming = Date.parse("2026-11-22T00:00:00+09:00");
  const both = homeRecruitments([], samples, [], upcoming);
  assert.equal(new Set(samples.map(({ id }) => id)).size, 12);
  for (const type of ["event", "lightning"] as const) {
    const expected = JANUARY_RECRUITMENTS.filter((entry) => entry.type === type)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(({ postId }) => postId);
    assert.equal(expected.length, 6);
    assert.deepEqual(
      both[type].map(({ id }) => id),
      expected,
    );
  }

  const real = post({ eventAvailable: true, meetupType: "event" });
  const withReal = homeRecruitments([real], samples, [], upcoming);
  assert.deepEqual(withReal.event, [real]);
  assert.equal(withReal.lightning.length, 6);
  assert.deepEqual(homeRecruitments([], samples, [], Date.parse("2027-02-01")), {
    event: [],
    lightning: [],
  });
});
