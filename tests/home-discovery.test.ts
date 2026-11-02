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
  const result = homeRecruitments([active], [sample, active, story]);
  assert.deepEqual(
    result.map((p) => p.id),
    ["active", "sample"],
  );
  assert.equal(result[1]!.sample, true);
  assert.equal(result[1]!.eventAvailable, false);
});
