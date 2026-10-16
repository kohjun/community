import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as base from "../src/db/schema";
import { eventPrivateContacts } from "../src/db/event-contact-schema";
import { memberSafety, memberBlocks, contentRestrictions } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import {
  eventPrivateContactPutSchema,
  eventPrivateContactDeleteSchema,
} from "../src/domain/event-contact";
import { eventPrivateContactService } from "../src/server/event-contact-service";
import { participationService } from "../src/server/participation-service";
import { eventLifecycleService } from "../src/server/event-lifecycle-service";
import { communityService } from "../src/server/community-service";
import { safetyService } from "../src/server/safety-service";
import { AppError } from "../src/server/errors";

const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
const contacts = eventPrivateContactService(connection),
  participation = participationService(connection),
  community = communityService(connection);
let owner: string, participant: string, manager: string, outsider: string, postId: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
const input = (expectedRevision = 0) => ({
  expectedRevision,
  channel: "email" as const,
  value: "host-private@example.invalid",
  note: "행사 당일 일정과 준비물 문의",
});
async function member(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(base.profiles).values({
    id,
    nickname,
    phoneNumber: "01088887777",
    profileCompletedAt: new Date(),
    onboardingConsentAt: new Date(),
  });
  return id;
}
async function event(ended = false) {
  const [row] = await db
    .insert(base.posts)
    .values({
      authorId: owner,
      categorySlug: "party",
      kind: "모집",
      isAnonymous: true,
      title: "익명 행사 비공개 연락처",
      bodyMarkdown: "참가자와 담당자에게만 연락 경로를 제공합니다.",
      contactInfo: "PUBLIC-INQUIRY-ONLY",
      location: "서울",
      eventDate: "주말",
      eventFee: "무료",
    })
    .returning();
  await db.insert(base.eventSettings).values({
    postId: row!.id,
    amountKRW: 0,
    capacity: 20,
    startsAt: new Date(Date.now() + (ended ? -7200000 : 86400000)),
    endsAt: new Date(Date.now() + (ended ? -3600000 : 90000000)),
    open: true,
  });
  return row!.id;
}
async function application(user: string, status = "confirmed", id = postId) {
  const [row] = await db
    .insert(base.eventApplications)
    .values({
      postId: id,
      userId: user,
      attendeeName: "비공개 참가자 이름",
      contact: "participant-private@example.invalid",
      amountKRW: 0,
      status,
      confirmedAt: status === "confirmed" ? new Date() : null,
      expiresAt: new Date(Date.now() + 1800000),
    })
    .returning();
  return row!.id;
}
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(base.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  owner = await member("익명 주최자 개인정보");
  participant = await member("참가자");
  manager = await member("별도 진행 담당자");
  outsider = await member("외부 회원");
  postId = await event();
});
after(() => pg.close());

test("strict contact inputs normalize each method and reject forged ownership, unsafe values and invalid revisions", () => {
  assert.equal(
    eventPrivateContactPutSchema.parse({
      expectedRevision: 0,
      channel: "phone",
      value: " +82 (10) 1234-5678 ",
    }).value,
    "01012345678",
  );
  assert.equal(
    eventPrivateContactPutSchema.parse({
      expectedRevision: 0,
      channel: "phone",
      value: "02-1234-5678",
    }).value,
    "0212345678",
  );
  assert.equal(
    eventPrivateContactPutSchema.parse({
      expectedRevision: 0,
      channel: "phone",
      value: "+1 (212) 555-1234",
    }).value,
    "+12125551234",
  );
  assert.equal(
    eventPrivateContactPutSchema.parse({
      expectedRevision: 0,
      channel: "link",
      value: "https://example.invalid/contact",
    }).note,
    "",
  );
  for (const invalid of [
    { ...input(), ownerId: randomUUID() },
    { ...input(), expectedRevision: -1 },
    { ...input(), expectedRevision: "0" },
    { ...input(), value: "broken-email" },
    { ...input(), value: "host@example.invalid\r\nBcc:other@example.invalid" },
    { ...input(), channel: "phone", value: "javascript:alert(1)" },
    { ...input(), channel: "phone", value: "123" },
    { ...input(), channel: "link", value: "javascript:alert(1)" },
    { ...input(), channel: "link", value: "http://example.invalid" },
    { ...input(), channel: "link", value: "https://username:password@example.invalid" },
    { ...input(), channel: "link", value: "https://example.invalid/ bad" },
    { ...input(), channel: "link", value: "https://example.invalid\\@other.invalid" },
  ])
    assert.equal(eventPrivateContactPutSchema.safeParse(invalid).success, false);
  assert.equal(
    eventPrivateContactDeleteSchema.safeParse({ expectedRevision: 0, userId: owner }).success,
    false,
  );
});

test("contact starts empty and never copies a profile phone or public inquiry", async () => {
  assert.deepEqual(await contacts.overview(owner, postId), {
    revision: 0,
    canManage: true,
    contact: null,
  });
  await application(participant);
  assert.deepEqual(await contacts.overview(participant, postId), {
    revision: 0,
    canManage: false,
    contact: null,
  });
  assert.equal((await db.select().from(eventPrivateContacts)).length, 0);
});

test("only confirmed participants and current managers can read explicit contact without anonymous owner identity", async () => {
  await application(participant);
  await db.insert(base.roomManagers).values({ postId, userId: manager });
  const saved = await contacts.save(owner, postId, input());
  assert.deepEqual(saved, {
    revision: 1,
    canManage: true,
    contact: { channel: "email", value: input().value, note: input().note },
  });
  for (const actor of [participant, manager]) {
    const view = await contacts.overview(actor, postId);
    assert.deepEqual(view, { ...saved, canManage: false });
    const serialized = JSON.stringify(view);
    for (const secret of [
      owner,
      participant,
      manager,
      "익명 주최자 개인정보",
      "01088887777",
      "participant-private@example.invalid",
      "updatedBy",
      "postId",
    ])
      assert.equal(serialized.includes(secret), false);
    await assert.rejects(contacts.save(actor, postId, input(1)), code("FORBIDDEN"));
    await assert.rejects(
      contacts.remove(actor, postId, { expectedRevision: 1 }),
      code("FORBIDDEN"),
    );
  }
  await assert.rejects(contacts.overview(null, postId), code("UNAUTHENTICATED"));
  await assert.rejects(contacts.overview(outsider, postId), code("FORBIDDEN"));
  await db.delete(base.roomManagers).where(eq(base.roomManagers.userId, manager));
  await assert.rejects(contacts.overview(manager, postId), code("FORBIDDEN"));
});

test("pending, unverified and cancelled or refunded participants lose private contact access immediately", async () => {
  await contacts.save(owner, postId, input());
  const id = await application(participant, "pending_payment");
  await assert.rejects(contacts.overview(participant, postId), code("FORBIDDEN"));
  await db
    .update(base.eventApplications)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(eq(base.eventApplications.id, id));
  assert.equal((await contacts.overview(participant, postId)).contact?.value, input().value);
  await db
    .update(base.eventApplications)
    .set({ status: "cancelled" })
    .where(eq(base.eventApplications.id, id));
  await assert.rejects(contacts.overview(participant, postId), code("FORBIDDEN"));
  const refunded = await application(manager);
  await db
    .update(base.eventApplications)
    .set({ status: "refunded" })
    .where(eq(base.eventApplications.id, refunded));
  await assert.rejects(contacts.overview(manager, postId), code("FORBIDDEN"));
  const external = await event();
  await db
    .update(base.posts)
    .set({ applicationUrl: "https://example.invalid/apply" })
    .where(eq(base.posts.id, external));
  await contacts.save(owner, external, input());
  const [pending] = await db
    .insert(base.eventApplications)
    .values({
      postId: external,
      userId: outsider,
      source: "external",
      externalReference: "unverified-order",
      attendeeName: "참가자",
      contact: "private-contact",
      amountKRW: 0,
      status: "pending_approval",
    })
    .returning();
  await assert.rejects(contacts.overview(outsider, external), code("FORBIDDEN"));
  await db
    .update(base.eventApplications)
    .set({ status: "review" })
    .where(eq(base.eventApplications.id, pending!.id));
  await assert.rejects(contacts.overview(outsider, external), code("FORBIDDEN"));
});

test("confirmed application alone cannot bypass a revoked room membership", async () => {
  await contacts.save(owner, postId, input());
  await application(participant);
  await db
    .update(base.roomMembers)
    .set({ revokedAt: new Date() })
    .where(eq(base.roomMembers.userId, participant));
  await assert.rejects(contacts.overview(participant, postId), code("FORBIDDEN"));
});

test("closed recruitment and host-cancelled events keep contact for still-confirmed refund guidance", async () => {
  await contacts.save(owner, postId, input());
  const id = await application(participant);
  await db
    .update(base.eventSettings)
    .set({ open: false })
    .where(eq(base.eventSettings.postId, postId));
  assert.equal((await contacts.overview(participant, postId)).contact?.value, input().value);
  await eventLifecycleService(connection).change(owner, postId, {
    kind: "cancel",
    reason: "주최자 사정으로 행사를 취소합니다.",
    expectedRevision: 0,
    confirmed: true,
  });
  assert.equal((await contacts.overview(participant, postId)).contact?.value, input().value);
  await db
    .update(base.eventApplications)
    .set({ status: "refunded" })
    .where(eq(base.eventApplications.id, id));
  await assert.rejects(contacts.overview(participant, postId), code("FORBIDDEN"));
});

test("either direction of blocking denies contact without changing participant financial records", async () => {
  await contacts.save(owner, postId, input());
  const id = await application(participant);
  for (const [blockerId, blockedId] of [
    [participant, owner],
    [owner, participant],
  ]) {
    const [block] = await db
      .insert(memberBlocks)
      .values({ blockerId: blockerId!, blockedId: blockedId!, displayLabel: "차단 회원" })
      .returning();
    await assert.rejects(contacts.overview(participant, postId), code("FORBIDDEN"));
    await db.delete(memberBlocks).where(eq(memberBlocks.id, block!.id));
  }
  assert.equal(
    (await db.select().from(base.eventApplications).where(eq(base.eventApplications.id, id)))[0]
      ?.status,
    "confirmed",
  );
  assert.equal((await contacts.overview(participant, postId)).contact?.value, input().value);
});

test("operator-hidden or deleted events and restricted participants or hosts cannot expose contact", async () => {
  await contacts.save(owner, postId, input());
  await application(participant);
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: postId, reason: "운영 검토 중" });
  await assert.rejects(contacts.overview(participant, postId), code("NOT_FOUND"));
  await assert.rejects(contacts.overview(owner, postId), code("NOT_FOUND"));
  await db.delete(contentRestrictions).where(eq(contentRestrictions.targetId, postId));
  for (const userId of [participant, owner]) {
    await db
      .insert(memberSafety)
      .values({ userId, status: "suspended", suspendedUntil: new Date(Date.now() + 60000) });
    await assert.rejects(contacts.overview(participant, postId), code("FORBIDDEN"));
    await assert.rejects(contacts.save(userId, postId, input(1)), code("FORBIDDEN"));
    await db.delete(memberSafety).where(eq(memberSafety.userId, userId));
  }
  await db.insert(memberSafety).values({ userId: participant, status: "closed" });
  await assert.rejects(contacts.overview(participant, postId), code("FORBIDDEN"));
  const deleted = await event();
  await contacts.save(owner, deleted, input());
  await db.update(base.posts).set({ status: "deleted" }).where(eq(base.posts.id, deleted));
  await assert.rejects(contacts.overview(participant, deleted), code("NOT_FOUND"));
  await assert.rejects(contacts.overview(owner, deleted), code("NOT_FOUND"));
});

test("withdrawal preserves a tombstone revision while erasing contact data for completed past events", async () => {
  const old = await event(true);
  await contacts.save(owner, old, input());
  await application(participant, "confirmed", old);
  await db.update(base.posts).set({ status: "deleted" }).where(eq(base.posts.id, postId));
  await safetyService(connection).withdraw(owner);
  const [row] = await db
    .select()
    .from(eventPrivateContacts)
    .where(eq(eventPrivateContacts.postId, old));
  assert.equal(row?.enabled, false);
  assert.equal(row?.revision, 2);
  assert.equal(row?.channel, null);
  assert.equal(row?.value, null);
  assert.equal(row?.note, null);
  assert.equal(row?.updatedBy, null);
  await assert.rejects(contacts.overview(participant, old), code("FORBIDDEN"));
});

test("withdrawn contact cannot reappear from a stale edit and repeat writers share one revision", async () => {
  await application(participant);
  await contacts.save(owner, postId, input());
  assert.deepEqual(await contacts.remove(owner, postId, { expectedRevision: 1 }), {
    revision: 2,
    canManage: true,
    contact: null,
  });
  assert.equal((await contacts.overview(participant, postId)).contact, null);
  await assert.rejects(contacts.save(owner, postId, input(1)), code("CONFLICT"));
  const outcomes = await Promise.allSettled([
    contacts.save(owner, postId, input(2)),
    contacts.save(owner, postId, { ...input(2), value: "other@example.invalid" }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected?.status === "rejected" && code("CONFLICT")(rejected.reason));
  assert.equal((await contacts.overview(owner, postId)).revision, 3);
  assert.equal(
    (await db.select().from(eventPrivateContacts).where(eq(eventPrivateContacts.postId, postId)))
      .length,
    1,
  );
});

test("public post, listing, event overview and announcement room never project the private contact", async () => {
  await contacts.save(owner, postId, input());
  await application(participant);
  const views = [
    await community.getPost(postId, null),
    await community.feed(null, {}),
    await participation.overview(null, postId),
    await participation.overview(participant, postId),
    await participation.room(participant, postId),
  ];
  for (const view of views) {
    assert.equal(JSON.stringify(view).includes(input().value), false);
    assert.equal(JSON.stringify(view).includes(input().note), false);
  }
});

test("database constraints reject active empty contacts and public roles cannot access or overwrite stored values", async () => {
  await assert.rejects(
    db
      .insert(eventPrivateContacts)
      .values({ postId, enabled: true, channel: "email", value: null, note: "" }),
  );
  await assert.rejects(
    db.insert(eventPrivateContacts).values({
      postId,
      enabled: true,
      channel: "link",
      value: "http://example.invalid",
      note: "",
    }),
  );
  await assert.rejects(
    db.insert(eventPrivateContacts).values({
      postId,
      enabled: true,
      channel: "email",
      value: "host@example.invalid\nsecret",
      note: "",
    }),
  );
  await contacts.save(owner, postId, {
    expectedRevision: 0,
    channel: "phone",
    value: "+1 (212) 555-1234",
  });
  assert.equal((await contacts.overview(owner, postId)).contact?.value, "+12125551234");
  const protectedTable = await pg.query<{ relrowsecurity: boolean }>(
    "select relrowsecurity from pg_class where oid='sliper.event_private_contacts'::regclass",
  );
  assert.equal(protectedTable.rows[0]?.relrowsecurity, true);
  for (const role of ["anon", "authenticated"]) {
    await pg.exec("set role " + role);
    try {
      await assert.rejects(pg.query("select * from sliper.event_private_contacts"));
      await assert.rejects(pg.query("update sliper.event_private_contacts set value='stolen'"));
      await assert.rejects(pg.query("delete from sliper.event_private_contacts"));
    } finally {
      await pg.exec("reset role");
    }
  }
});
