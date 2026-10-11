import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import {
  normalizePhoneNumber,
  isProfileReadyForApplication,
  safeProfileReturnTo,
} from "../src/domain/profile";
import { onboardingInputSchema, profileInputSchema } from "../src/domain/validation";
import { profileService } from "../src/server/profile-service";
import { playerService } from "../src/server/player-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const service = profileService(db as unknown as Database, async () => []);
let owner: string, other: string;
const input = {
  nickname: "테스트플레이어",
  phoneNumber: "010-1234-5678",
  consent: true,
  ageBand: "30s",
  gender: "female",
};
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values ($1)", [id]);
  await db.insert(schema.profiles).values({ id, nickname });
  return id;
}
before(async () => {
  await pg.exec(
    "create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("본인닉네임");
  other = await member("다른닉네임");
});
after(() => pg.close());

test("phone normalization checks mobile formats without pretending to verify ownership", () => {
  for (const raw of ["010-1234-5678", "010 1234 5678", "+82 10-1234-5678", "+82 (0)10 1234 5678"])
    assert.equal(normalizePhoneNumber(raw), "01012345678");
  for (const raw of [
    "",
    "0101234567",
    "0212345678",
    "+12025550123",
    "abc01012345678",
    "01012345678<script>",
  ])
    assert.equal(normalizePhoneNumber(raw), null);
  const parsed = onboardingInputSchema.parse(input);
  assert.equal(parsed.phoneNumber, "01012345678");
  assert.equal("phoneVerifiedAt" in parsed, false);
});
test("onboarding requires storage consent and rejects client supplied verification metadata", () => {
  for (const payload of [
    { ...input, consent: false },
    { ...input, consent: undefined },
    { ...input, phoneNumber: "" },
    { ...input, nickname: "짧" },
    { ...input, phoneVerifiedAt: new Date().toISOString() },
    { ...input, profileCompletedAt: new Date().toISOString() },
    { ...input, userId: randomUUID() },
  ])
    assert.equal(onboardingInputSchema.safeParse(payload).success, false);
  assert.equal(
    profileInputSchema.safeParse({ nickname: "닉네임", phoneVerifiedAt: new Date() }).success,
    false,
  );
});
test("onboarding saves only the authenticated member and keeps phone verification separate", async () => {
  await assert.rejects(service.completeOnboarding(null, input), code("UNAUTHENTICATED"));
  const result = await service.completeOnboarding(owner, input);
  assert.equal(result.phoneNumber, "01012345678");
  assert.equal(result.phoneVerifiedAt, null);
  assert.ok(result.onboardingConsentAt);
  assert.ok(result.profileCompletedAt);
  assert.equal(isProfileReadyForApplication(result), true);
  assert.equal(result.ageBand, "30s");
  assert.equal(result.gender, "female");
  const untouched = await service.me(other);
  assert.equal(untouched.phoneNumber, null);
  assert.equal(untouched.profileCompletedAt, null);
  assert.equal(untouched.nickname, "다른닉네임");
});
test("editing public profile fields preserves omitted private details and verified ownership", async () => {
  const completed = await service.completeOnboarding(owner, input);
  const verifiedAt = new Date("2026-10-01T00:00:00Z");
  await db
    .update(schema.profiles)
    .set({ phoneVerifiedAt: verifiedAt })
    .where(eq(schema.profiles.id, owner));
  const updated = await service.updateProfile(owner, { nickname: "새닉네임", bio: "새 소개" });
  assert.equal(updated.phoneNumber, completed.phoneNumber);
  assert.equal(updated.ageBand, completed.ageBand);
  assert.equal(updated.gender, completed.gender);
  assert.equal(updated.phoneVerifiedAt, verifiedAt.toISOString());
  assert.equal(updated.profileCompletedAt, completed.profileCompletedAt);
  const sameNumber = await service.updateProfile(owner, {
    nickname: "새닉네임",
    phoneNumber: "+82 10-1234-5678",
  });
  assert.equal(sameNumber.phoneVerifiedAt, verifiedAt.toISOString());
});
test("changing or removing a phone invalidates verification and updates profile readiness", async () => {
  await service.completeOnboarding(owner, input);
  await db
    .update(schema.profiles)
    .set({ phoneVerifiedAt: new Date() })
    .where(eq(schema.profiles.id, owner));
  const changed = await service.updateProfile(owner, {
    nickname: "새닉네임",
    phoneNumber: "010-9876-5432",
  });
  assert.equal(changed.phoneNumber, "01098765432");
  assert.equal(changed.phoneVerifiedAt, null);
  assert.equal(isProfileReadyForApplication(changed), true);
  const removed = await service.updateProfile(owner, {
    nickname: "새닉네임",
    phoneNumber: "",
    ageBand: null,
    gender: null,
  });
  assert.equal(removed.phoneNumber, null);
  assert.equal(removed.phoneVerifiedAt, null);
  assert.equal(removed.profileCompletedAt, null);
  assert.equal(removed.ageBand, null);
  assert.equal(removed.gender, null);
  assert.equal(isProfileReadyForApplication(removed), false);
});
test("a phone saved before onboarding cannot bypass the consent requirement", async () => {
  const profile = await service.updateProfile(owner, {
    nickname: "닉네임",
    phoneNumber: "010-1234-5678",
  });
  assert.equal(profile.profileCompletedAt, null);
  assert.equal(profile.onboardingConsentAt, null);
  assert.equal(isProfileReadyForApplication(profile), false);
  await assert.rejects(
    service.updateProfile(randomUUID(), { nickname: "없는회원" }),
    code("NOT_FOUND"),
  );
});
test("public player views never reveal the member phone, demographics or completion metadata", async () => {
  const me = await service.completeOnboarding(owner, input);
  const publicProfile = await playerService(db as unknown as Database).profile(other, me.publicId);
  const payload = JSON.stringify(publicProfile);
  for (const field of [
    "phoneNumber",
    "phoneVerifiedAt",
    "ageBand",
    "gender",
    "onboardingConsentAt",
    "profileCompletedAt",
    owner,
    "01012345678",
  ])
    assert.equal(payload.includes(field), false, field);
});
test("return navigation accepts event paths while refusing external and obfuscated destinations", () => {
  assert.equal(safeProfileReturnTo("/events/abc?tab=apply#form"), "/events/abc?tab=apply#form");
  for (const value of [
    "https://evil.invalid",
    "//evil.invalid",
    "/\\evil.invalid",
    "/%2F%2Fevil.invalid",
    "/%255c%255cevil.invalid",
    "/login",
    "/signup",
    "/\nother",
    ["//evil.invalid"],
  ])
    assert.equal(safeProfileReturnTo(value), "/mypage");
});
