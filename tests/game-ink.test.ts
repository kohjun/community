import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createInkGateway } from "../src/server/game-ink-gateway";
import {
  issueInkTicket,
  verifyInkTicket,
  type InkAuthority,
  type InkStore,
} from "../src/server/game-ink-core";
import { replayInk, type InkEvent } from "../src/domain/game-ink";
const secret = randomBytes(32).toString("hex"),
  origin = "https://sliper.test";
function memory() {
  const authorities = new Map<string, InkAuthority>(),
    drawings = new Map<string, InkEvent[]>(),
    listeners = new Set<Parameters<InkStore["listen"]>[0]>();
  const store: InkStore = {
    async authority(r) {
      return authorities.get(r) ?? null;
    },
    async events(r, c) {
      return drawings.get(r + ":" + c) ?? [];
    },
    async append(r, c, event) {
      const k = r + ":" + c,
        events = drawings.get(k) ?? [],
        seq = events.at(-1)?.seq ?? 0;
      if (event.seq <= seq) return "duplicate";
      if (event.seq !== seq + 1) return "resync";
      events.push(event);
      drawings.set(k, events);
      for (const fn of listeners) fn({ roomId: r, canvas: c, event });
      return "ok";
    },
    async listen(fn) {
      listeners.add(fn);
      return async () => {
        listeners.delete(fn);
      };
    },
  };
  return {
    store,
    authorities,
    update(a: InkAuthority) {
      authorities.set(a.roomId, a);
      for (const fn of listeners) fn({ roomId: a.roomId, authority: a });
    },
  };
}
async function peer(url: string, authority: InkAuthority, member: string) {
  const socket = new WebSocket(url, { origin });
  const messages: Record<string, any>[] = [];
  socket.on("error", () => {});
  socket.on("message", (v) => messages.push(JSON.parse(v.toString())));
  await once(socket, "open");
  socket.send(
    JSON.stringify({
      type: "auth",
      ticket: issueInkTicket(
        {
          roomId: authority.roomId,
          member,
          phaseId: authority.phaseId,
          expiresAt: Date.now() + 60000,
        },
        secret,
      ),
    }),
  );
  async function wait(predicate: (v: Record<string, any>) => boolean) {
    for (let i = 0; i < 200; i++) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("Socket response timeout");
  }
  await wait((m) => m.type === "ready");
  return { socket, messages, wait };
}
const stroke = () => ({
  op: "stroke" as const,
  id: randomUUID(),
  colour: "#0A84FE" as const,
  width: 4,
  points: [
    [0.2, 0.3],
    [0.4, 0.5],
  ] as [number, number][],
});
test("ink tickets reject forgery, expiration, extra fields, and excessive future lifetimes", () => {
  const a = {
    roomId: randomUUID(),
    member: randomUUID(),
    phaseId: randomUUID(),
    expiresAt: Date.now() + 60000,
  };
  const token = issueInkTicket(a, secret);
  assert.ok(verifyInkTicket(token, secret));
  assert.equal(verifyInkTicket(token + "x", secret), null);
  assert.equal(verifyInkTicket(token, secret, Date.now() + 61000), null);
  assert.equal(
    verifyInkTicket(issueInkTicket({ ...a, expiresAt: Date.now() + 100000 }, secret), secret),
    null,
  );
});
test("ink replay preserves segmented strokes and implements undo and clear", () => {
  const a = stroke(),
    b = stroke();
  const events: InkEvent[] = [
    { seq: 1, command: a },
    { seq: 2, command: { ...a, points: [[0.6, 0.6]] } },
    { seq: 3, command: b },
    { seq: 4, command: { op: "undo" } },
  ];
  const result = replayInk(events);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.points.length, 3);
  assert.equal(a.points.length, 2);
  assert.equal(replayInk([...events, { seq: 5, command: { op: "clear" } }]).length, 0);
});
test("private canvases stay private, valid readers get live events and reconnect snapshots, duplicate sequence is idempotent", async (t) => {
  const mem = memory(),
    roomId = randomUUID(),
    canvas = randomUUID(),
    other = randomUUID(),
    artist = randomUUID(),
    reader = randomUUID(),
    outsider = randomUUID();
  const a: InkAuthority = {
    roomId,
    phaseId: randomUUID(),
    revision: 1,
    expiresAt: Date.now() + 120000,
    members: {
      [artist]: { read: [canvas], write: canvas },
      [reader]: { read: [canvas], write: null },
      [outsider]: { read: [other], write: other },
    },
  };
  mem.update(a);
  const g = await createInkGateway({ store: mem.store, key: secret, origin });
  g.server.listen(0, "127.0.0.1");
  await once(g.server, "listening");
  t.after(() => g.close());
  const address = g.server.address();
  assert.ok(address && typeof address !== "string");
  const url = `ws://127.0.0.1:${address.port}/ws/games`;
  const p = await peer(url, a, artist),
    q = await peer(url, a, reader),
    x = await peer(url, a, outsider);
  const command = stroke();
  p.socket.send(JSON.stringify({ type: "ink", canvas, seq: 1, command }));
  await p.wait((v) => v.type === "ack" && v.seq === 1);
  await q.wait((v) => v.type === "ink");
  assert.ok(!x.messages.some((v) => v.type === "ink"));
  p.socket.send(JSON.stringify({ type: "ink", canvas, seq: 1, command }));
  await new Promise((r) => setTimeout(r, 25));
  assert.equal((await mem.store.events(roomId, canvas)).length, 1);
  const rejoined = await peer(url, a, reader);
  assert.equal(rejoined.messages.find((m) => m.type === "snapshot")!.events.length, 1);
  const closed = once(q.socket, "close");
  q.socket.send(JSON.stringify({ type: "ink", canvas, seq: 2, command: stroke() }));
  const [code] = await closed;
  assert.equal(code, 4003);
  const revoked = once(p.socket, "close");
  mem.update({ ...a, revision: 2, phaseId: randomUUID() });
  assert.equal((await revoked)[0], 4001);
});
test("gateway rejects another website's origin and a forged room membership", async (t) => {
  const mem = memory(),
    roomId = randomUUID();
  const a: InkAuthority = {
    roomId,
    phaseId: randomUUID(),
    revision: 1,
    expiresAt: Date.now() + 120000,
    members: {},
  };
  mem.update(a);
  const g = await createInkGateway({ store: mem.store, key: secret, origin });
  g.server.listen(0, "127.0.0.1");
  await once(g.server, "listening");
  t.after(() => g.close());
  const address = g.server.address();
  assert.ok(address && typeof address !== "string");
  const url = `ws://127.0.0.1:${address.port}/ws/games`;
  const blocked = new WebSocket(url, { origin: "https://evil.test" });
  const error = once(blocked, "error");
  await error;
  assert.notEqual(blocked.readyState, WebSocket.OPEN);
  const ws = new WebSocket(url, { origin });
  ws.on("error", () => {});
  await once(ws, "open");
  const closed = once(ws, "close");
  ws.send(
    JSON.stringify({
      ticket: issueInkTicket(
        { roomId, phaseId: a.phaseId, member: randomUUID(), expiresAt: Date.now() + 60000 },
        secret,
      ),
    }),
  );
  assert.equal((await closed)[0], 4003);
});
