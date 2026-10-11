import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import {
  profilePhotoService,
  isProfilePhotoObjectKey,
  PROFILE_PHOTO_MAX_OUTPUT_BYTES,
} from "../src/server/profile-photo-service";
import { profileService } from "../src/server/profile-service";
import { participationService } from "../src/server/participation-service";
import { communityService } from "../src/server/community-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite(),
  db = drizzle(pg, { schema });
const photos = profilePhotoService(db as unknown as Database);
const participation = participationService(db as unknown as Database);
const community = communityService(db as unknown as Database);
const profile = profileService(db as unknown as Database, async () => []);
let owner: string, attendee: string, outsider: string, staff: string, postId: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
function asset() {
  const id = randomUUID();
  return { id, objectKey: id + ".webp", contentType: "image/webp" as const, bytes: 1000 };
}
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values ($1)", [id]);
  await db.insert(schema.profiles).values({
    id,
    nickname,
    phoneNumber: "01012345678",
    profileCompletedAt: new Date(),
    onboardingConsentAt: new Date(),
  });
  return id;
}
async function apply(user = attendee) {
  return (await participation.apply(user, postId, { note: "처음 참가해요", consent: true }, null))
    .application!;
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade;");
  owner = await member("등록자");
  attendee = await member("참가자");
  outsider = await member("외부회원");
  staff = await member("운영담당자");
  postId = (
    await community.createPost(owner, {
      categorySlug: "party",
      kind: "모집",
      title: "프로필 사진 공개 행사",
      bodyMarkdown: "함께 즐기는 행사",
      location: "서울",
      eventDate: "토요일",
      eventFee: "무료",
      isAnonymous: false,
      imageAssetIds: [],
    })
  ).id;
  await participation.configure(owner, postId, { amountKRW: 0, capacity: 5, open: true });
});
after(() => pg.close());

test("profile photo keys cannot escape the private image folder", () => {
  assert.equal(isProfilePhotoObjectKey(asset().objectKey), true);
  for (const key of [
    "../photo.webp",
    "..\\photo.webp",
    "C:\\photo.webp",
    "/photo.webp",
    "file.png",
    asset().objectKey + "/x",
    "00000000-0000-4000-8000-000000000001.webp\n",
  ])
    assert.equal(isProfilePhotoObjectKey(key), false, key);
});
test("photo updates require the authenticated existing profile and reject forged metadata", async () => {
  await assert.rejects(photos.replace(null, asset()), code("UNAUTHENTICATED"));
  await assert.rejects(photos.clear(null), code("UNAUTHENTICATED"));
  await assert.rejects(photos.replace(randomUUID(), asset()), code("NOT_FOUND"));
  await assert.rejects(photos.clear(randomUUID()), code("NOT_FOUND"));
  const valid = asset();
  for (const metadata of [
    { ...valid, objectKey: asset().objectKey },
    { ...valid, objectKey: "../photo.webp" },
    { ...valid, bytes: 0 },
    { ...valid, bytes: 1.5 },
    { ...valid, bytes: NaN },
    { ...valid, bytes: PROFILE_PHOTO_MAX_OUTPUT_BYTES + 1 },
    { ...valid, contentType: "image/svg+xml" },
  ])
    await assert.rejects(
      photos.replace(owner, metadata as Parameters<typeof photos.replace>[1]),
      code("VALIDATION"),
    );
  assert.equal((await db.select().from(schema.profilePhotos)).length, 0);
});
test("own photos can be read privately without a room while guesses from other accounts cannot", async () => {
  const image = asset();
  await photos.replace(owner, image);
  assert.equal((await photos.read(owner, image.id)).objectKey, image.objectKey);
  await assert.rejects(photos.read(null, image.id), code("UNAUTHENTICATED"));
  await assert.rejects(photos.read(outsider, image.id), code("NOT_FOUND"));
  await assert.rejects(photos.read(owner, randomUUID()), code("NOT_FOUND"));
});
test("confirmed members share photos with current participants, host and managers", async () => {
  await apply();
  await apply(outsider);
  const staffProfile = await profile.me(staff);
  await participation.setManager(owner, postId, { publicId: staffProfile.publicId, enabled: true });
  for (const user of [owner, outsider, staff]) {
    const image = asset();
    await photos.replace(user, image);
    assert.equal((await photos.read(attendee, image.id, postId)).id, image.id);
    if (user !== owner) assert.equal((await photos.read(owner, image.id, postId)).id, image.id);
  }
});
test("uninvited viewers and image owners cannot use a room identifier to share private photos", async () => {
  await apply();
  const hostImage = asset(),
    outsiderImage = asset();
  await photos.replace(owner, hostImage);
  await photos.replace(outsider, outsiderImage);
  await assert.rejects(photos.read(outsider, hostImage.id, postId), code("NOT_FOUND"));
  await assert.rejects(photos.read(owner, outsiderImage.id, postId), code("NOT_FOUND"));
  await assert.rejects(photos.read(attendee, outsiderImage.id, postId), code("NOT_FOUND"));
  await assert.rejects(photos.read(attendee, hostImage.id, randomUUID()), code("NOT_FOUND"));
});
test("pending payment grants no access to other room members' profile photos", async () => {
  await participation.configure(owner, postId, { amountKRW: 10000, capacity: 5, open: true });
  const pending = (
    await participation.apply(attendee, postId, { note: "신청 대기", consent: true }, "bridge")
  ).application!;
  assert.equal(pending.status, "pending_payment");
  const hostImage = asset(),
    pendingImage = asset();
  await photos.replace(owner, hostImage);
  await photos.replace(attendee, pendingImage);
  await assert.rejects(photos.read(attendee, hostImage.id, postId), code("NOT_FOUND"));
  await assert.rejects(photos.read(owner, pendingImage.id, postId), code("NOT_FOUND"));
});
test("cancelled members lose both viewing and room-scoped photo visibility while retaining their own image", async () => {
  const application = await apply();
  const hostImage = asset(),
    memberImage = asset();
  await photos.replace(owner, hostImage);
  await photos.replace(attendee, memberImage);
  assert.equal((await photos.read(attendee, hostImage.id, postId)).id, hostImage.id);
  await participation.cancel(attendee, application.id);
  await assert.rejects(photos.read(attendee, hostImage.id, postId), code("NOT_FOUND"));
  await assert.rejects(photos.read(owner, memberImage.id, postId), code("NOT_FOUND"));
  assert.equal((await photos.read(attendee, memberImage.id)).id, memberImage.id);
});
test("manager revocation and deleted events invalidate shared photo access", async () => {
  const staffProfile = await profile.me(staff),
    hostImage = asset();
  await photos.replace(owner, hostImage);
  await participation.setManager(owner, postId, { publicId: staffProfile.publicId, enabled: true });
  assert.equal((await photos.read(staff, hostImage.id, postId)).id, hostImage.id);
  await participation.setManager(owner, postId, {
    publicId: staffProfile.publicId,
    enabled: false,
  });
  await assert.rejects(photos.read(staff, hostImage.id, postId), code("NOT_FOUND"));
  await participation.setManager(owner, postId, { publicId: staffProfile.publicId, enabled: true });
  await community.deletePost(owner, postId);
  await assert.rejects(photos.read(staff, hostImage.id, postId), code("NOT_FOUND"));
});
test("replacement keeps one owner record, updates MyProfile and makes the previous image identifier unusable", async () => {
  const first = asset(),
    second = asset(),
    other = asset();
  assert.equal(await photos.replace(owner, first), null);
  await photos.replace(outsider, other);
  assert.equal((await profile.me(owner)).photoSrc, "/api/profile-photos/" + first.id);
  await assert.rejects(photos.replace(owner, first), code("CONFLICT"));
  assert.equal(await photos.replace(owner, second), first.objectKey);
  await assert.rejects(photos.read(owner, first.id), code("NOT_FOUND"));
  assert.equal((await profile.me(owner)).photoSrc, "/api/profile-photos/" + second.id);
  assert.equal((await profile.me(outsider)).photoSrc, "/api/profile-photos/" + other.id);
  assert.equal(
    (await db.select().from(schema.profilePhotos).where(eq(schema.profilePhotos.userId, owner)))
      .length,
    1,
  );
  assert.equal(await photos.clear(owner), second.objectKey);
  assert.equal(await photos.clear(owner), null);
  assert.equal((await profile.me(owner)).photoSrc, null);
  await assert.rejects(photos.read(owner, second.id), code("NOT_FOUND"));
});
test("profile deletion cascades private photo metadata and database constraints reject unsafe files", async () => {
  const image = asset();
  await photos.replace(attendee, image);
  await pg.query("delete from auth.users where id=$1", [attendee]);
  assert.equal((await db.select().from(schema.profilePhotos)).length, 0);
  for (const invalid of [
    { ...asset(), bytes: 0 },
    { ...asset(), bytes: PROFILE_PHOTO_MAX_OUTPUT_BYTES + 1 },
    { ...asset(), objectKey: "../image.webp" },
    { ...asset(), contentType: "image/svg+xml" },
  ])
    await assert.rejects(db.insert(schema.profilePhotos).values({ ...invalid, userId: owner }));
});

test("stored profile metadata keeps the exact previous backend across local/cloud swaps", async () => {
  const local = asset(),
    cloud = { ...asset(), storageBackend: "supabase" as const },
    nextLocal = asset();
  assert.equal(await photos.replaceStored(owner, local), null);
  assert.equal((await photos.read(owner, local.id)).storageBackend, "local");
  assert.deepEqual(await photos.replaceStored(owner, cloud), {
    objectKey: local.objectKey,
    storageBackend: "local",
  });
  assert.equal((await photos.read(owner, cloud.id)).storageBackend, "supabase");
  assert.deepEqual(await photos.replaceStored(owner, nextLocal), {
    objectKey: cloud.objectKey,
    storageBackend: "supabase",
  });
  assert.deepEqual(await photos.clearStored(owner), {
    objectKey: nextLocal.objectKey,
    storageBackend: "local",
  });
  assert.equal(await photos.clearStored(owner), null);
  const invalid = { ...asset(), storageBackend: "public" } as unknown as Parameters<
    typeof photos.replace
  >[1];
  await assert.rejects(photos.replace(owner, invalid), code("VALIDATION"));
});
