import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { TownWorld, type TownMember } from "../src/server/town-world";
import { TownAOI, townVoiceTargets } from "../src/server/town-spatial";
import { TownMovementValidator } from "../src/server/town-movement";
import { issueTownTicket, verifyTownTicket } from "../src/server/town-ticket";
import { townInputSchema, TOWN_SEATS } from "../src/domain/town";
import { issueTownVoiceToken, TownVoicePolicy, townVoiceConfig } from "../src/server/town-voice";
const member = (nickname = "플레이어"): TownMember => ({
  actor: randomUUID(),
  publicId: randomUUID(),
  nickname,
  blocked: [],
});
const key = randomBytes(48).toString("hex");
function fixture(capacity = 8) {
  let now = 1_000_000;
  const world = new TownWorld(() => now, capacity);
  return {
    world,
    advance: (ms: number) => {
      now += ms;
      world.tick();
    },
    get now() {
      return now;
    },
  };
}
function report(
  w: TownWorld,
  m: TownMember,
  connection: string,
  sequence: number,
  x: number,
  z: number,
  ix = 1,
  iz = 0,
) {
  w.input(m.actor, connection, {
    type: "input",
    sequence,
    moveX: ix,
    moveZ: iz,
    rotationY: 0,
    clientTick: sequence * 50,
  });
  w.input(m.actor, connection, {
    type: "report",
    sequence,
    position: { x, y: 0, z },
    rotationY: 0,
  });
}
test("town tickets are short lived, signed, world-bound and reject tampering", () => {
  const actor = randomUUID(),
    token = issueTownTicket(actor, key, 1000);
  assert.equal(verifyTownTicket(token, key, 1001)?.actor, actor);
  assert.equal(verifyTownTicket(token, key, 1001)?.worldId, "main-world");
  assert.equal(verifyTownTicket(token, key, 91_000), null);
  assert.equal(verifyTownTicket(token + "a", key, 1001), null);
  assert.equal(verifyTownTicket(token, randomBytes(48).toString("hex"), 1001), null);
});
test("town session reconnect retains avatar, limits capacity and expires abandoned seats", () => {
  const f = fixture(2),
    a = member(),
    b = member(),
    c = member();
  const first = f.world.join(a, "a");
  f.world.join(b, "b");
  assert.throws(() => f.world.join(c, "c"), /가득/);
  f.world.disconnect(a.actor, "a");
  assert.equal(f.world.join(a, "a2").id, first.id);
  f.world.disconnect(a.actor, "a");
  assert.equal(f.world.view(a.actor)?.players.find((p) => p.id === first.id)?.online, true);
  assert.equal(f.world.join(a, "a3").replaced, "a2");
  f.world.disconnect(a.actor, "a3");
  f.advance(30_001);
  f.world.join(c, "c");
  assert.equal(f.world.residents.size, 2);
});
test("client reports require increasing sequences, bounded motion and no forged identity", () => {
  const f = fixture(),
    a = member();
  f.world.join(a, "a");
  const p = f.world.residents.get(a.actor)!.avatar;
  const x = p.x,
    z = p.z;
  f.advance(50);
  report(f.world, a, "a", 1, x + 0.3, z);
  assert.equal(p.x, x + 0.3);
  assert.throws(() => report(f.world, a, "a", 1, x + 0.3, z), /순서/);
  assert.throws(() => report(f.world, a, "wrong", 2, x + 0.4, z), /다시/);
  assert.throws(() => report(f.world, a, "a", 2, 100, z), /movement_validation/);
  assert.equal(p.x, x + 0.3);
  assert.equal(
    townInputSchema.safeParse({
      type: "report",
      sequence: 3,
      position: { x: NaN, y: 0, z: 0 },
      rotationY: 0,
    }).success,
    false,
  );
  assert.equal(
    townInputSchema.safeParse({
      type: "input",
      sequence: 3,
      moveX: 1,
      moveZ: 0,
      rotationY: 0,
      clientTick: 3,
      actor: randomUUID(),
    }).success,
    false,
  );
});
test("movement credit prevents high-frequency speed exploits and validates swept obstacles", () => {
  const v = new TownMovementValidator(0);
  let p = { x: 4, z: 8 };
  for (let i = 0; i < 10; i++) {
    const next = { x: p.x + 0.05, y: 0, z: p.z };
    if (v.accept(p, next, { x: 1, z: 0 }, 0)) p = next;
  }
  assert.equal(v.accept(p, { x: p.x + 0.3, y: 0, z: p.z }, { x: 1, z: 0 }, 0), false);
  const wall = new TownMovementValidator(0);
  assert.equal(wall.accept({ x: 2.8, z: 0 }, { x: 2.4, y: 0, z: 0 }, { x: -1, z: 0 }, 0), false);
  assert.equal(wall.accept({ x: 250, z: 0 }, { x: 250.1, y: 0, z: 0 }, { x: 1, z: 0 }, 100), false);
});
test("AOI grid returns exact nearby IDs across negative cells and prunes removals", () => {
  const aoi = new TownAOI();
  aoi.update("a", -24, 0);
  aoi.update("b", 30, 0);
  aoi.update("c", 5, 5);
  assert.deepEqual(aoi.nearby(0, 0, 10), ["c"]);
  aoi.update("a", 2, 1);
  assert.deepEqual(new Set(aoi.nearby(0, 0, 10)), new Set(["a", "c"]));
  aoi.remove("a");
  assert.deepEqual(aoi.nearby(0, 0, 10), ["c"]);
});
test("blocked members are removed on server from avatars, voice, chat and evidence", () => {
  const f = fixture(),
    a = member("하나"),
    b = member("둘");
  f.world.join(a, "a");
  f.world.join(b, "b");
  f.world.input(b.actor, "b", { type: "chat", channel: "world", text: "반가워요" });
  const chat = f.world.view(a.actor)!.messages[0]!;
  assert.equal(f.world.evidence(a.actor, chat.id, "message").publicId, b.publicId);
  a.blocked = [b.actor];
  f.world.updateMember(a);
  assert.equal(f.world.view(a.actor)!.players.length, 1);
  assert.equal(f.world.view(b.actor)!.players.length, 1);
  assert.equal(f.world.view(a.actor)!.messages.length, 0);
  assert.deepEqual(f.world.voiceTargets(a.actor), []);
  assert.throws(() => f.world.evidence(a.actor, chat.id, "message"));
  assert.ok(!JSON.stringify(f.world.view(b.actor)).includes(a.actor));
  assert.ok(!JSON.stringify(f.world.view(b.actor)).includes(b.publicId));
});
test("nearby chat is delivered only to the audience present within its radius", () => {
  const f = fixture(),
    a = member(),
    b = member(),
    c = member();
  f.world.join(a, "a");
  f.world.join(b, "b");
  f.world.input(a.actor, "a", { type: "chat", channel: "nearby", text: "우리 근처에서만 나눠요" });
  f.world.join(c, "c");
  assert.equal(f.world.view(b.actor)!.messages.length, 1);
  assert.equal(f.world.view(c.actor)!.messages.length, 0);
  f.advance(30 * 60_000 + 1);
  assert.equal(f.world.view(b.actor)!.messages.length, 0);
});
test("chat applies content policy and persistent per-resident cooldown", () => {
  const f = fixture(),
    a = member();
  f.world.join(a, "a");
  f.world.input(a.actor, "a", { type: "chat", channel: "world", text: "안녕하세요" });
  f.world.join(a, "a2");
  assert.throws(
    () => f.world.input(a.actor, "a2", { type: "chat", channel: "world", text: "다시 인사" }),
    /간격/,
  );
  f.advance(1600);
  assert.throws(() =>
    f.world.input(a.actor, "a2", { type: "chat", channel: "world", text: "씨발" }),
  );
});
test("benches validate proximity and exclusive occupancy, then free on leaving", () => {
  const f = fixture(),
    a = member(),
    b = member();
  f.world.join(a, "a");
  f.world.join(b, "b");
  const seat = TOWN_SEATS[0]!;
  assert.throws(() => f.world.input(a.actor, "a", { type: "sit", seat: seat.id }), /가까이/);
  for (const m of [a, b]) {
    const p = f.world.residents.get(m.actor)!.avatar;
    p.x = seat.x;
    p.z = seat.z;
  }
  f.world.input(a.actor, "a", { type: "sit", seat: seat.id });
  assert.throws(() => f.world.input(b.actor, "b", { type: "sit", seat: seat.id }), /이미/);
  f.world.remove(a.actor, "a");
  f.world.input(b.actor, "b", { type: "sit", seat: seat.id });
  assert.equal(f.world.residents.get(b.actor)!.avatar.seat, seat.id);
});
test("voice chooses nearest twelve with separate 15/18m hysteresis", () => {
  const people = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    x: i,
    z: 0,
    online: true,
  }));
  assert.deepEqual(
    townVoiceTargets({ x: 0, z: 0 }, people),
    people.slice(0, 12).map((p) => p.id),
  );
  assert.deepEqual(
    townVoiceTargets({ x: 0, z: 0 }, [{ id: "a", x: 17, z: 0, online: true }], new Set(["a"])),
    ["a"],
  );
  assert.deepEqual(townVoiceTargets({ x: 0, z: 0 }, [{ id: "a", x: 17, z: 0, online: true }]), []);
});
test("voice tokens grant microphone only, no direct subscriptions or room administration", async () => {
  assert.equal(townVoiceConfig({}), null);
  const config = {
    url: "wss://voice.example.test",
    key: randomBytes(12).toString("hex"),
    secret: randomBytes(40).toString("hex"),
  };
  const value = await issueTownVoiceToken(randomUUID(), config);
  const payload = JSON.parse(Buffer.from(value.token.split(".")[1]!, "base64url").toString());
  assert.equal(payload.video.canSubscribe, false);
  assert.deepEqual(payload.video.canPublishSources, ["microphone"]);
  assert.equal(payload.video.roomAdmin, undefined);
  assert.equal(payload.video.canPublishData, false);
  assert.equal(payload.exp - payload.nbf, 60);
});
test("voice policy revokes departed targets before grants and removes stale participants", async () => {
  const calls: string[] = [],
    actors = [
      { identity: "a", tracks: [] },
      { identity: "b", tracks: [{ sid: "tb", source: 2 }] },
      { identity: "c", tracks: [{ sid: "tc", source: 2 }] },
    ];
  const policy = new TownVoicePolicy({
    listParticipants: async () => actors as never,
    updateSubscriptions: async (_r, id, tracks, subscribe) => {
      calls.push(`${id}:${subscribe}:${tracks.join()}`);
    },
    removeParticipant: async (_r, id) => {
      calls.push(`remove:${id}`);
      return {} as never;
    },
  });
  await policy.sync(
    new Map([
      ["a", ["b"]],
      ["b", []],
      ["c", []],
    ]),
  );
  assert.ok(calls.includes("a:true:tb"));
  calls.length = 0;
  await policy.sync(
    new Map([
      ["a", ["c"]],
      ["b", []],
      ["c", []],
    ]),
  );
  assert.ok(calls.indexOf("a:false:tb") < calls.indexOf("a:true:tc"));
  calls.length = 0;
  await policy.sync(new Map([["a", []]]));
  assert.ok(calls.includes("remove:b"));
  assert.ok(calls.includes("remove:c"));
});

test("actual Rapier obstacle contacts stay inside the server walkable envelope", async () => {
  const R = await import("@dimforge/rapier3d-compat");
  await R.init();
  const { createTownPhysics } = await import("../src/lib/town-physics");
  const { world, body, collider, controller } = createTownPhysics(R);
  const { townWalkable } = await import("../src/domain/town");
  try {
    body.setTranslation({ x: 4, y: 0.9, z: 0 }, true);
    world.step();
    for (let i = 0; i < 120; i++) {
      controller.computeColliderMovement(collider, { x: -0.1, y: 0, z: 0 });
      const p = body.translation(),
        d = controller.computedMovement();
      body.setNextKinematicTranslation({ x: p.x + d.x, y: 0.9, z: p.z + d.z });
      world.step();
      assert.ok(townWalkable(body.translation().x, body.translation().z));
    }
    assert.ok(body.translation().x >= 2.7 && body.translation().x < 2.8);
  } finally {
    world.free();
  }
});
