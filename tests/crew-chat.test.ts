import assert from "node:assert/strict";
import { randomUUID, createECDH, randomBytes } from "node:crypto";
import { before, beforeEach, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import type { Database } from "../src/db/connection";
import { categories, profiles } from "../src/db/schema";
import { crewMembers, crewMessages } from "../src/db/crew-schema";
import { pushSubscriptions, pushPreferences, pushDeliveries } from "../src/db/push-schema";
import { memberBlocks, memberSafety, contentRestrictions } from "../src/db/safety-schema";
import { CATEGORIES } from "../src/domain/categories";
import { crewChatInputSchema } from "../src/domain/crew-chat";
import { crewService } from "../src/server/crew-service";
import { pushDispatcher } from "../src/server/push-dispatcher";
import { AppError } from "../src/server/errors";
import { openRoomEventStream, type RoomWakeBus } from "../src/server/room-realtime-core";
const pg = new PGlite(),
  db = drizzle(pg),
  connection = db as unknown as Database;
const config = { ...webpush.generateVAPIDKeys(), subject: "mailto:test@example.com" };
let owner: string, member: string, outsider: string, crewId: string;
let receive = () => {};
const bus: RoomWakeBus = {
  subscribe(_id, wake) {
    receive = wake;
    return {
      ready: Promise.resolve(),
      isReady: () => true,
      unsubscribe() {
        receive = () => {};
      },
    };
  },
  async publish() {
    receive();
  },
};
const service = crewService(connection, undefined, (id) => bus.publish(id));
const rejected = (code: string) => (error: unknown) =>
  error instanceof AppError && error.code === code;
async function person(nickname: string) {
  const id = randomUUID();
  await pg.query("insert into auth.users values($1)", [id]);
  await db.insert(profiles).values({ id, nickname });
  return id;
}
async function subscription(userId: string) {
  const key = createECDH("prime256v1");
  key.generateKeys();
  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: "https://fcm.googleapis.com/fcm/send/" + randomUUID(),
    p256dh: key.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
    vapidPublicKey: config.publicKey,
  });
}
const send = (body = "다음 모임은 토요일에 어때요?", user = member, clientId = randomUUID()) =>
  service.sendChat(user, crewId, { clientId, body });
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  owner = await person("리더");
  member = await person("크루원");
  outsider = await person("다른회원");
  crewId = (
    await service.create(owner, {
      name: "우리 크루",
      description: "다음 모임을 함께 준비하는 크루입니다.",
      category: "party",
    })
  ).id;
  await db.insert(crewMembers).values({ crewId, userId: member, role: "member" });
});
after(() => pg.close());
test("only approved active members can read and send, pending requests grant no access", async () => {
  await assert.rejects(service.chat(null, crewId), rejected("UNAUTHENTICATED"));
  await service.join(outsider, crewId, { message: "참여하고 싶어요", publicNameConsent: true });
  await assert.rejects(service.chat(outsider, crewId), rejected("FORBIDDEN"));
  await assert.rejects(send("안녕하세요", outsider), rejected("FORBIDDEN"));
  const room = await send();
  assert.equal(room.messages.length, 1);
  assert.equal(room.messages[0]!.author?.nickname, "크루원");
  assert.equal(room.memberCount, 2);
  await db.insert(memberSafety).values({ userId: member, status: "closed" });
  await assert.rejects(service.chat(member, crewId), rejected("FORBIDDEN"));
});
test("retries do not duplicate messages or push deliveries, bodies are validated and filtered", async () => {
  await subscription(owner);
  const clientId = randomUUID();
  await send("토요일에 만나요", member, clientId);
  await send("토요일에 만나요", member, clientId);
  assert.equal((await db.select().from(crewMessages)).length, 1);
  assert.equal((await db.select().from(pushDeliveries)).length, 1);
  await assert.rejects(send("다른 내용", member, clientId), rejected("CONFLICT"));
  for (const body of [" ", "x".repeat(2001), "잘못된\u0000문자"])
    assert.equal(crewChatInputSchema.safeParse({ clientId, body }).success, false);
  assert.equal(crewChatInputSchema.safeParse({ clientId, body: "안녕 👋" }).success, true);
});
test("own and manager deletion clear the body, ordinary members cannot delete others", async () => {
  const message = (await send("리더 공지", owner)).messages[0]!;
  await assert.rejects(service.deleteChat(member, crewId, message.id), rejected("FORBIDDEN"));
  await service.deleteChat(owner, crewId, message.id);
  await service.deleteChat(owner, crewId, message.id);
  const row = (await db.select().from(crewMessages))[0]!;
  assert.equal(row.body, "");
  assert.ok(row.deletedAt);
  const other = (await send()).messages.at(-1)!;
  await service.deleteChat(owner, crewId, other.id);
  const room = await service.chat(member, crewId);
  assert.equal(
    room.messages.every((item) => item.removed && item.body === "" && item.author === null),
    true,
  );
});
test("keyset history has no gaps and cursors cannot cross crew or recipient", async () => {
  await db.insert(crewMessages).values(
    Array.from({ length: 61 }, (_, index) => ({
      crewId,
      authorId: member,
      clientId: randomUUID(),
      body: "메시지 " + index,
      createdAt: new Date(1700000000000 + index),
    })),
  );
  const first = await service.chat(owner, crewId);
  assert.equal(first.messages.length, 50);
  assert.ok(first.nextCursor);
  const earlier = await service.chat(owner, crewId, { cursor: first.nextCursor });
  assert.equal(earlier.messages.length, 11);
  assert.equal(new Set([...earlier.messages, ...first.messages].map((item) => item.id)).size, 61);
  await assert.rejects(
    service.chat(member, crewId, { cursor: first.nextCursor }),
    rejected("VALIDATION"),
  );
});
test("blocking hides message identity and text, hidden crews and departed members lose access", async () => {
  await send();
  await db
    .insert(memberBlocks)
    .values({ blockerId: owner, blockedId: member, displayLabel: "크루원" });
  const room = await service.chat(owner, crewId);
  assert.equal(room.messages[0]!.body, "");
  assert.equal(room.messages[0]!.author, null);
  await service.leave(member, crewId);
  await assert.rejects(service.chat(member, crewId), rejected("FORBIDDEN"));
  await assert.rejects(send(), rejected("FORBIDDEN"));
  await db
    .insert(contentRestrictions)
    .values({ targetType: "crew", targetId: crewId, hidden: true, reason: "운영 검토" });
  await assert.rejects(service.chat(owner, crewId), rejected("NOT_FOUND"));
});
test("archived crews retain readable history and stop new messages", async () => {
  await send();
  await service.archive(owner, crewId);
  const room = await service.chat(member, crewId);
  assert.equal(room.canSend, false);
  assert.equal(room.messages.length, 1);
  await assert.rejects(send(), rejected("CONFLICT"));
});
test("realtime sends messages and revokes an already-open stream after member removal", async () => {
  const abort = new AbortController();
  const stream = await openRoomEventStream({
    roomId: crewId,
    signal: abort.signal,
    readRoom: () => service.chat(member, crewId),
    bus,
  });
  const reader = stream.getReader(),
    decode = new TextDecoder();
  assert.match(decode.decode((await reader.read()).value), /event: room/);
  await send("함께 만나요", owner);
  assert.match(decode.decode((await reader.read()).value), /함께 만나요/);
  const publicId = (await db.select().from(profiles).where(eq(profiles.id, member)))[0]!.publicId;
  await service.removeMember(owner, crewId, { memberPublicId: publicId });
  assert.match(decode.decode((await reader.read()).value), /event: revoked/);
  abort.abort();
  await reader.cancel();
});
test("crew message push previews use current text and cancel after departure, blocking, deletion or opt-out", async () => {
  await subscription(owner);
  await subscription(member);
  const sent: { title: string; body: string; url: string }[] = [];
  const dispatcher = pushDispatcher(connection, config, async (_sub, delivery) => {
    sent.push(delivery);
  });
  await send("**토요일** 오후에 만나요");
  await dispatcher.drain();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.title, "우리 크루 · 크루원");
  assert.equal(sent[0]!.body, "토요일 오후에 만나요");
  assert.equal(sent[0]!.url, "/crews/" + crewId + "?tab=chat");
  const removed = (await send("삭제할 메시지")).messages.at(-1)!;
  await service.deleteChat(member, crewId, removed.id);
  await dispatcher.drain();
  assert.equal(sent.length, 1);
  await send("차단 확인 메시지");
  await db
    .insert(memberBlocks)
    .values({ blockerId: owner, blockedId: member, displayLabel: "크루원" });
  await dispatcher.drain();
  assert.equal(sent.length, 1);
  await db.delete(memberBlocks);
  await send("권한 회수 검사", owner);
  await service.leave(member, crewId);
  await dispatcher.drain();
  assert.equal(sent.length, 1);
  await db.insert(pushPreferences).values({ userId: owner, crewMessages: false });
  await db.insert(crewMembers).values({ crewId, userId: member, role: "member" });
  await send("수신 해제 검사");
  await dispatcher.drain();
  assert.equal(sent.length, 1);
});
test("chat tables deny direct anon and authenticated table access", async () => {
  const { rows } = await pg.query<{ rls: boolean; anonymous: boolean; member: boolean }>(
    "select relrowsecurity rls,has_table_privilege('anon','sliper.crew_messages','SELECT') anonymous,has_table_privilege('authenticated','sliper.crew_messages','INSERT') member from pg_class where oid='sliper.crew_messages'::regclass",
  );
  assert.deepEqual(rows[0], { rls: true, anonymous: false, member: false });
});
