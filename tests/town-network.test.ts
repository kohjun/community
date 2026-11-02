import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Client, type Room } from "@colyseus/sdk";
import { createTownGateway } from "../src/server/town-gateway";
import { issueTownTicket, townSignature } from "../src/server/town-ticket";
import type { TownMember } from "../src/server/town-world";
import type { TownSnapshot } from "../src/domain/town";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function wait(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error("town network timed out");
    await pause(25);
  }
}
test(
  "real Colyseus clients share one world, authenticate, move, reconnect and enforce blocks",
  { timeout: 25000 },
  async () => {
    const key = randomBytes(48).toString("hex"),
      origin = "http://127.0.0.1:31089",
      people = new Map<string, TownMember>(),
      rooms: Room[] = [];
    for (const name of ["하나", "둘", "셋"]) {
      const actor = randomUUID();
      people.set(actor, { actor, publicId: randomUUID(), nickname: name, blocked: [] });
    }
    let cacheHealthy = true;
    const gateway = createTownGateway({
      isHealthy: () => cacheHealthy,
      key,
      origin,
      capacity: 2,
      members: async (actors) => actors.flatMap((id) => (people.has(id) ? [people.get(id)!] : [])),
    });
    try {
      await gateway.listen(0);
      const port = (gateway.server.address() as { port: number }).port,
        base = `http://127.0.0.1:${port}`,
        sdk = new Client(base, { headers: { origin } }),
        actors = [...people.keys()];
      cacheHealthy = false;
      assert.equal((await fetch(`${base}/health`)).status, 503);
      cacheHealthy = true;
      assert.equal((await fetch(`${base}/health`)).status, 200);
      const views = new Map<string, TownSnapshot>();
      async function join(actor: string, ticket = issueTownTicket(actor, key)) {
        const r = await sdk.joinById(gateway.roomId, { ticket });
        r.reconnection.enabled = false;
        r.onMessage("world:ready", () => {});
        r.onMessage("world:state", (v: TownSnapshot) => {
          v.messages ??= views.get(actor)?.messages ?? [];
          views.set(actor, v);
        });
        r.onMessage("player:joined", () => {});
        r.onMessage("player:left", () => {});
        r.onMessage("player:snapshots", () => {});
        r.onMessage("world:meta", () => {});
        r.onMessage("voice:targets", () => {});
        r.onMessage("town:error", () => {});
        r.onMessage("player:correction", () => {});
        rooms.push(r);
        await wait(() => views.has(actor));
        return r;
      }
      assert.equal(
        (
          await fetch(`${base}/matchmake/create/sliper-town`, {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: "{}",
          })
        ).status,
        403,
      );
      await assert.rejects(sdk.joinById(gateway.roomId, { ticket: "bad-ticket" }));
      const firstTicket = issueTownTicket(actors[0]!, key),
        a = await join(actors[0]!, firstTicket),
        b = await join(actors[1]!);
      await wait(() => gateway.world.residents.size === 2);
      await assert.rejects(sdk.joinById(gateway.roomId, { ticket: firstTicket }));
      await assert.rejects(
        sdk.joinById(gateway.roomId, { ticket: issueTownTicket(actors[2]!, key) }),
      );
      const initial = views
        .get(actors[0]!)!
        .players.find((p) => p.id === views.get(actors[0]!)!.me)!;
      a.send("player:input", { sequence: 1, moveX: 1, moveZ: 0, rotationY: 0, clientTick: 1 });
      a.send("player:report", {
        sequence: 1,
        position: { x: initial.x + 0.2, y: 0, z: initial.z },
        rotationY: 0,
      });
      await wait(() => gateway.world.residents.get(actors[0]!)!.avatar.x === initial.x + 0.2);
      a.send("town:action", { type: "chat", channel: "world", text: "같이 놀아요" });
      await wait(() => views.get(actors[1]!)!.messages.length === 1);
      const packet = JSON.stringify(views.get(actors[1]!));
      for (const person of people.values()) {
        assert.ok(!packet.includes(person.actor));
        assert.ok(!packet.includes(person.publicId));
      }
      const stamp = String(Date.now()),
        path = "/internal/evidence",
        body = JSON.stringify({
          actor: actors[1],
          target: views.get(actors[1]!)!.messages[0]!.id,
          kind: "message",
        });
      assert.equal((await fetch(`${base}${path}`, { method: "POST", body })).status, 403);
      const evidence = await fetch(`${base}${path}`, {
        method: "POST",
        body,
        headers: {
          "x-town-time": stamp,
          "x-town-signature": townSignature(`${stamp}\n${path}\n${body}`, key),
        },
      });
      assert.equal(evidence.status, 200);
      assert.ok((await evidence.json()).text.includes("같이 놀아요"));
      people.get(actors[1]!)!.blocked = [actors[0]!];
      await gateway.refreshMembers();
      await wait(
        () =>
          views.get(actors[1]!)!.players.length === 1 &&
          views.get(actors[1]!)!.messages.length === 0,
      );
      const stable = gateway.world.residents.get(actors[0]!)!.avatar.id;
      await a.leave(false);
      await pause(100);
      views.delete(actors[0]!);
      await join(actors[0]!);
      assert.equal(gateway.world.residents.get(actors[0]!)!.avatar.id, stable);
      assert.equal(gateway.world.residents.size, 2);
      people.delete(actors[1]!);
      await gateway.refreshMembers();
      await wait(() => !gateway.world.residents.has(actors[1]!));
      await wait(() => !b.connection.isOpen);
    } finally {
      for (const r of rooms) await r.leave().catch(() => {});
      await gateway.close();
    }
  },
);
