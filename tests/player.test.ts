import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
import * as base from "../src/db/schema";
import * as player from "../src/db/player-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { mannerTemperature } from "../src/domain/player";
import { playerService } from "../src/server/player-service";
import { participationService } from "../src/server/participation-service";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg, { schema: { ...base, ...player } });
const service = playerService(db as unknown as Database),
  participation = participationService(db as unknown as Database);
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
let owner: string, alice: string, bob: string, outsider: string, staff: string, postId: string;
async function member(name: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db
    .insert(base.profiles)
    .values({ id, nickname: name, region: "서울", bio: "실제 개인정보 없는 테스트" });
  return id;
}
async function publicId(user: string) {
  return (
    await db
      .select({ publicId: base.profiles.publicId })
      .from(base.profiles)
      .where(eq(base.profiles.id, user))
  )[0]!.publicId;
}
async function apply(user: string) {
  // Replay a confirmed free registration from a completed event. New registrations
  // after an event starts are deliberately blocked by the real application service.
  const [application] = await db
    .insert(base.eventApplications)
    .values({
      postId,
      userId: user,
      attendeeName: "참가자",
      contact: "test@example.invalid",
      amountKRW: 0,
      status: "confirmed",
      confirmedAt: new Date("2020-01-01T00:30:00Z"),
      expiresAt: new Date("2020-01-01T04:00:00Z"),
    })
    .returning({ id: base.eventApplications.id });
  return application!;
}
async function record(user: string, presence: "attended" | "no_show" = "attended") {
  const application = await apply(user);
  return service.recordResult(owner, postId, {
    applicationId: application.id,
    presence,
    outcome: "participated",
    observedRole: presence === "attended" ? "brain" : null,
  });
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("진행자");
  alice = await member("두뇌 플레이어");
  bob = await member("함께한 플레이어");
  outsider = await member("외부 플레이어");
  staff = await member("보조 진행자");
  const [p] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      categorySlug: "party",
      kind: "모집",
      title: "참가 전적 테스트",
      bodyMarkdown: "함께하는 게임",
    })
    .returning({ id: base.posts.id });
  postId = p!.id;
  await participation.configure(owner, postId, { amountKRW: 0, capacity: 10, open: true });
  await db
    .update(base.eventSettings)
    .set({ startsAt: new Date("2020-01-01T01:00:00Z"), endsAt: new Date("2020-01-01T03:00:00Z") })
    .where(eq(base.eventSettings.postId, postId));
});
after(() => pg.close());

test("manner scores start at 36.5 and remain within 0 to 99.9", () => {
  assert.equal(mannerTemperature({ attended: 0, noShow: 0, positive: 0, negative: 0 }), 36.5);
  assert.equal(mannerTemperature({ attended: 1, noShow: 0, positive: 1, negative: 0 }), 36.8);
  assert.equal(mannerTemperature({ attended: 10000, noShow: 0, positive: 0, negative: 0 }), 99.9);
  assert.equal(mannerTemperature({ attended: 0, noShow: 10000, positive: 0, negative: 0 }), 0);
});
test("member-only profiles reveal no auth IDs or contacts; history and directory require opt-in", async () => {
  await record(alice);
  await assert.rejects(service.profile(null, await publicId(alice)), code("UNAUTHENTICATED"));
  await assert.rejects(service.directory(null), code("UNAUTHENTICATED"));
  const own = await service.self(alice),
    publicProfile = await service.profile(outsider, await publicId(alice));
  assert.equal(own.history.length, 1);
  assert.equal(publicProfile.history.length, 0);
  assert.equal(publicProfile.summary.attended, 0);
  assert.equal(publicProfile.careerVisible, false);
  assert.equal(publicProfile.summary.mannerTemperature, 36.6);
  assert.equal(JSON.stringify(publicProfile).includes(alice), false);
  assert.equal(JSON.stringify(publicProfile).includes("test@example.invalid"), false);
  assert.equal((await service.directory(outsider)).items.length, 0);
  await service.updatePreference(alice, {
    preferredRole: "strategist",
    matchingVisible: true,
    historyPublic: true,
  });
  const directory = await service.directory(outsider, { role: "strategist", region: "서울" });
  assert.equal(directory.items.length, 1);
  assert.equal(directory.items[0]?.nickname, "두뇌 플레이어");
  assert.equal((await service.directory(outsider, { role: "physical" })).items.length, 0);
  assert.equal((await service.profile(outsider, await publicId(alice))).history.length, 1);
  await assert.rejects(
    service.updatePreference(null, {
      preferredRole: null,
      matchingVisible: false,
      historyPublic: false,
    }),
    code("UNAUTHENTICATED"),
  );
  await assert.rejects(
    service.updatePreference(alice, {
      preferredRole: null,
      matchingVisible: false,
      historyPublic: false,
      mannerTemperature: 100,
    }),
  );
});
test("only a host or appointed manager can record confirmed participants after the event ends", async () => {
  const app = await apply(alice),
    input = { applicationId: app.id, presence: "attended", outcome: "won", observedRole: "brain" };
  await assert.rejects(service.recordResult(outsider, postId, input), code("FORBIDDEN"));
  await assert.rejects(service.recordRoster(alice, postId), code("FORBIDDEN"));
  await assert.rejects(service.recordResult(null, postId, input), code("UNAUTHENTICATED"));
  const beforeEnd = playerService(
    db as unknown as Database,
    () => new Date("2020-01-01T02:00:00Z"),
  );
  await assert.rejects(beforeEnd.recordResult(owner, postId, input), code("CONFLICT"));
  await db.insert(base.roomManagers).values({ postId, userId: staff });
  await service.recordResult(staff, postId, input);
  const profile = await service.self(alice);
  assert.equal(profile.summary.wins, 1);
  assert.equal(profile.summary.observedRoles.brain, 1);
  assert.equal((await service.self(owner)).summary.hosted, 1);
  await participation.cancel(alice, app.id);
  await assert.rejects(service.recordResult(owner, postId, input), code("CONFLICT"));
  const ownerApp = await apply(owner);
  await assert.rejects(
    service.recordResult(owner, postId, { ...input, applicationId: ownerApp.id }),
    code("FORBIDDEN"),
  );
});
test("result corrections require a reason and upserts do not duplicate attendance or score", async () => {
  const app = await apply(alice),
    input = {
      applicationId: app.id,
      presence: "attended",
      outcome: "participated",
      observedRole: "physical",
    };
  await service.recordResult(owner, postId, input);
  await service.recordResult(owner, postId, input);
  assert.equal((await service.self(alice)).summary.attended, 1);
  await assert.rejects(
    service.recordResult(owner, postId, {
      ...input,
      expectedUpdatedAt: (await service.recordRoster(owner, postId)).attendees.find(
        (p) => p.applicationId === app.id,
      )!.result!.updatedAt,
      presence: "no_show",
      observedRole: null,
    }),
    code("VALIDATION"),
  );
  await service.recordResult(owner, postId, {
    ...input,
    presence: "no_show",
    observedRole: null,
    reason: "현장 체크인 기록 정정",
    expectedUpdatedAt: (await service.recordRoster(owner, postId)).attendees.find(
      (p) => p.applicationId === app.id,
    )!.result!.updatedAt,
  });
  const profile = await service.self(alice);
  assert.equal(profile.summary.attended, 0);
  assert.equal(profile.summary.noShow, 1);
  assert.equal(profile.summary.mannerTemperature, 34.5);
  await assert.rejects(
    service.recordResult(owner, postId, {
      ...input,
      presence: "no_show",
      outcome: "won",
      observedRole: null,
    }),
  );
});
test("manner reviews are limited to actual co-attendees, one per event; public output is aggregate only", async () => {
  await record(alice);
  await record(bob);
  const input = { targetPublicId: await publicId(bob), sentiment: "positive", tags: ["배려"] };
  await assert.rejects(service.reviewManner(outsider, postId, input), code("FORBIDDEN"));
  await assert.rejects(service.reviewManner(bob, postId, input), code("FORBIDDEN"));
  await service.reviewManner(alice, postId, input);
  await service.reviewManner(alice, postId, input);
  await assert.rejects(
    service.reviewManner(alice, postId, { ...input, sentiment: "negative", tags: ["진행 방해"] }),
    code("CONFLICT"),
  );
  const profile = await service.profile(outsider, await publicId(bob));
  assert.equal(profile.summary.positive, 1);
  assert.equal(profile.summary.mannerTemperature, 36.8);
  assert.equal(JSON.stringify(profile).includes("배려"), false);
  assert.equal(JSON.stringify(profile).includes(alice), false);
  const roster = await service.reviewable(alice, postId);
  assert.equal(roster.members[0]?.reviewed, true);
  await record(outsider, "no_show");
  await assert.rejects(service.reviewManner(outsider, postId, input), code("FORBIDDEN"));
  await assert.rejects(
    service.reviewManner(alice, postId, { ...input, targetPublicId: await publicId(outsider) }),
    code("FORBIDDEN"),
  );
});
test("correcting an attendance record immediately removes its associated review from aggregate scores", async () => {
  await record(alice);
  await record(bob);
  await service.reviewManner(alice, postId, {
    targetPublicId: await publicId(bob),
    sentiment: "negative",
    tags: ["진행 방해"],
  });
  assert.equal((await service.self(bob)).summary.mannerTemperature, 36.1);
  const app = (await participation.overview(alice, postId)).application!;
  await service.recordResult(owner, postId, {
    applicationId: app.id,
    presence: "no_show",
    outcome: "participated",
    observedRole: null,
    reason: "등록 오류 정정",
    expectedUpdatedAt: (await service.recordRoster(owner, postId)).attendees.find(
      (p) => p.applicationId === app.id,
    )!.result!.updatedAt,
  });
  assert.equal((await service.self(bob)).summary.negative, 0);
  assert.equal((await service.self(bob)).summary.mannerTemperature, 36.6);
  await assert.rejects(service.reviewable(alice, postId), code("FORBIDDEN"));
});
test("database constraints reject mismatched application identity and self-recording", async () => {
  const app = await apply(alice);
  await assert.rejects(
    db.insert(player.eventResults).values({
      applicationId: app.id,
      postId,
      userId: bob,
      recorderId: owner,
      presence: "attended",
      outcome: "participated",
    }),
  );
  await assert.rejects(
    db.insert(player.eventResults).values({
      applicationId: app.id,
      postId,
      userId: alice,
      recorderId: alice,
      presence: "attended",
      outcome: "participated",
    }),
  );
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(player.eventResults);
  assert.equal(row!.count, 0);
});

test("fictional sample events never add reputation, wins, role counts or verified hosting", async () => {
  await db.update(base.posts).set({ sample: true }).where(eq(base.posts.id, postId));
  await record(alice);
  await record(bob);
  await service.reviewManner(alice, postId, {
    targetPublicId: await publicId(bob),
    sentiment: "positive",
    tags: ["배려"],
  });
  const profile = await service.self(bob);
  assert.equal(profile.summary.attended, 0);
  assert.equal(profile.summary.positive, 0);
  assert.equal(profile.summary.mannerTemperature, 36.5);
  assert.equal(profile.summary.observedRoles.brain, 0);
  assert.equal(profile.history[0]?.sample, true);
  assert.equal((await service.self(owner)).summary.hosted, 0);
});
test("directory pagination uses public IDs with scope-bound role and region filters", async () => {
  for (let index = 0; index < 24; index++) {
    const user = await member(`탐색 플레이어${index}`);
    await service.updatePreference(user, {
      preferredRole: "strategist",
      matchingVisible: true,
      historyPublic: false,
    });
  }
  const first = await service.directory(outsider, { role: "strategist", region: "서울" });
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  const next = await service.directory(outsider, {
    role: "strategist",
    region: "서울",
    cursor: first.nextCursor,
  });
  assert.equal(next.items.length, 4);
  assert.equal(next.nextCursor, null);
  assert.equal(new Set([...first.items, ...next.items].map((p) => p.publicId)).size, 24);
  await assert.rejects(
    service.directory(outsider, { role: "brain", region: "서울", cursor: first.nextCursor }),
    code("VALIDATION"),
  );
  await assert.rejects(
    service.directory(outsider, { role: "strategist", region: "부산", cursor: first.nextCursor }),
    code("VALIDATION"),
  );
});
