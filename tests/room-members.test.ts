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
import { participationService } from "../src/server/participation-service";
import { communityService } from "../src/server/community-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite(),
  db = drizzle(pg, { schema });
const service = participationService(db as unknown as Database);
const community = communityService(db as unknown as Database);
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
let owner: string, participant: string, manager: string, outsider: string, postId: string;
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  const [profile] = await db
    .insert(schema.profiles)
    .values({
      id,
      nickname,
      phoneNumber: "01012345678",
      profileCompletedAt: new Date(),
      onboardingConsentAt: new Date(),
    })
    .returning();
  return profile!;
}
async function join(user: string) {
  return (await service.apply(user, postId, { note: "비공개 참가 요청", consent: true }, null))
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
  await pg.exec("truncate auth.users cascade");
  owner = (await member("주최 회원")).id;
  participant = (await member("함께 노는 회원")).id;
  manager = (await member("진행 담당자")).id;
  outsider = (await member("밖에 있는 회원")).id;
  postId = (
    await community.createPost(owner, {
      categorySlug: "party",
      kind: "모집",
      location: "서울",
      eventDate: "토요일 오후 2시",
      eventFee: "무료",
      title: "멤버 목록 테스트 모임",
      bodyMarkdown: "주말 함께 노는 모임입니다.",
      isAnonymous: true,
      imageAssetIds: [],
    })
  ).id;
  await service.configure(owner, postId, { amountKRW: 0, capacity: 100, open: true });
});
after(() => pg.close());

test("confirmed participants see unique room members and display-only identity while write and attendee access remain staff-only", async () => {
  await join(participant);
  await join(manager);
  const [staffProfile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, manager));
  await service.setManager(owner, postId, { publicId: staffProfile!.publicId, enabled: true });
  const room = await service.room(participant, postId);
  assert.equal(room.memberCount, 3);
  assert.deepEqual(
    room.memberPreview.map((m) => m.role),
    ["owner", "manager", "participant"],
  );
  assert.deepEqual(
    room.memberPreview.map((m) => m.nickname),
    ["주최 회원", "진행 담당자", "함께 노는 회원"],
  );
  assert.equal(room.memberPreview.find((m) => m.isMe)?.nickname, "함께 노는 회원");
  assert.equal(room.canWrite, false);
  const page = await service.members(participant, postId);
  assert.deepEqual(page.members, room.memberPreview);
  assert.equal(page.memberCount, room.memberCount);
  assert.equal(page.memberRevision, room.memberRevision);
  for (const row of page.members)
    assert.deepEqual(
      Object.keys(row).sort(),
      ["publicId", "nickname", "avatar", "photoSrc", "role", "isMe"].sort(),
    );
  const serialized = JSON.stringify({ room, page });
  for (const privateValue of [
    owner,
    manager,
    participant,
    outsider,
    "01012345678",
    "비공개 참가 요청",
  ])
    assert.equal(serialized.includes(privateValue), false);
  await assert.rejects(
    service.send(participant, postId, { body: "참가자는 쓸 수 없음" }),
    code("FORBIDDEN"),
  );
  await assert.rejects(service.attendees(participant, postId), code("FORBIDDEN"));
});

test("roster rejects outsiders, unpaid applicants and revoked participants and removes cancelled members from snapshots", async () => {
  await assert.rejects(service.members(null, postId), code("UNAUTHENTICATED"));
  await assert.rejects(service.members(outsider, postId), code("FORBIDDEN"));
  const application = await join(participant);
  const before = await service.room(owner, postId);
  await service.cancel(participant, application.id);
  const after = await service.room(owner, postId);
  assert.equal(after.memberCount, 1);
  assert.notEqual(after.memberRevision, before.memberRevision);
  await assert.rejects(service.members(participant, postId), code("FORBIDDEN"));
  await service.configure(owner, postId, { amountKRW: 10000, capacity: 100, open: true });
  await service.apply(outsider, postId, { consent: true }, "bridge");
  await assert.rejects(service.members(outsider, postId), code("FORBIDDEN"));
  assert.equal((await service.room(owner, postId)).memberCount, 1);
});

test("display name, avatar, profile photo replacement and manager roles update the live roster revision", async () => {
  await join(participant);
  const initial = await service.room(participant, postId);
  await db
    .update(schema.profiles)
    .set({ nickname: "새로운 닉네임", avatar: "dice" })
    .where(eq(schema.profiles.id, participant));
  const renamed = await service.room(participant, postId);
  assert.notEqual(renamed.memberRevision, initial.memberRevision);
  assert.equal(renamed.memberPreview.find((m) => m.isMe)?.nickname, "새로운 닉네임");
  const id = randomUUID();
  await db.insert(schema.profilePhotos).values({
    id,
    userId: participant,
    objectKey: `${id}.webp`,
    contentType: "image/webp",
    bytes: 150,
  });
  const photographed = await service.room(owner, postId);
  assert.notEqual(photographed.memberRevision, renamed.memberRevision);
  assert.equal(
    photographed.memberPreview.find((m) => m.nickname === "새로운 닉네임")?.photoSrc,
    `/api/profile-photos/${id}?room=${postId}`,
  );
  const [staffProfile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, manager));
  await service.setManager(owner, postId, { publicId: staffProfile!.publicId, enabled: true });
  const managed = await service.room(participant, postId);
  assert.equal(managed.memberCount, 3);
  assert.notEqual(managed.memberRevision, photographed.memberRevision);
  await service.setManager(owner, postId, { publicId: staffProfile!.publicId, enabled: false });
  assert.equal((await service.members(participant, postId)).memberCount, 2);
});

test("bounded keyset pages cover every member without duplicates and reject cross-room, cross-user and stale cursors", async () => {
  await join(participant);
  for (let i = 0; i < 51; i++) await join((await member(`추가 참가자 ${i}`)).id);
  const preview = await service.room(participant, postId);
  assert.equal(preview.memberCount, 53);
  assert.equal(preview.memberPreview.length, 8);
  const first = await service.members(participant, postId, { limit: 50 });
  assert.equal(first.members.length, 50);
  assert.ok(first.nextCursor);
  const second = await service.members(participant, postId, {
    limit: 50,
    cursor: first.nextCursor,
  });
  assert.equal(second.members.length, 3);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.members, ...second.members].map((m) => m.publicId)).size, 53);
  assert.equal(first.memberRevision, second.memberRevision);
  await assert.rejects(
    service.members(owner, postId, { cursor: first.nextCursor }),
    code("VALIDATION"),
  );
  const other = (
    await community.createPost(owner, {
      categorySlug: "party",
      kind: "모집",
      location: "서울",
      eventDate: "토요일 오후 2시",
      eventFee: "무료",
      title: "다른 방 테스트 모임",
      bodyMarkdown: "다른 방 멤버 목록입니다.",
      isAnonymous: false,
      imageAssetIds: [],
    })
  ).id;
  await service.configure(owner, other, { amountKRW: 0, capacity: 5, open: true });
  await service.apply(participant, other, { consent: true }, null);
  await assert.rejects(
    service.members(participant, other, { cursor: first.nextCursor }),
    code("VALIDATION"),
  );
  const newer = (await member("새로 참가한 사람")).id;
  await join(newer);
  await assert.rejects(
    service.members(participant, postId, { cursor: first.nextCursor }),
    code("CONFLICT"),
  );
  assert.equal((await service.members(participant, postId, { limit: 50 })).memberCount, 54);
  await assert.rejects(service.members(participant, postId, { limit: 51 }));
  await assert.rejects(service.members(participant, postId, { cursor: "!" }));
});
