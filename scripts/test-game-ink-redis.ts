import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createInkRedis } from "../src/server/game-ink-redis";
import { createInkGateway } from "../src/server/game-ink-gateway";
import { issueInkTicket, type InkAuthority } from "../src/server/game-ink-core";
const privateMode = process.argv.includes("--private");
const key = randomBytes(32).toString("hex"),
  origin = "http://127.0.0.1:3107",
  redis = await createInkRedis(process.env.TEST_GAME_REDIS_URL ?? "redis://127.0.0.1:6380"),
  gateway = await createInkGateway({ store: redis.store, key, origin });
gateway.server.listen(0, "127.0.0.1");
await once(gateway.server, "listening");
const address = gateway.server.address();
if (!address || typeof address === "string") throw new Error("No gateway address");
const clients: WebSocket[] = [],
  latencies: number[] = [],
  sent = new Map<string, number>(),
  writers: { socket: WebSocket; roomId: string; canvas: string }[] = [];
try {
  for (let room = 0; room < 8; room++) {
    const roomId = randomUUID(),
      canvas = randomUUID(),
      ids = Array.from({ length: 12 }, () => randomUUID()),
      canvases = ids.map(() => randomUUID()),
      authority: InkAuthority = {
        roomId,
        revision: 1,
        phaseId: randomUUID(),
        expiresAt: Date.now() + 120000,
        members: Object.fromEntries(
          ids.map((id, i) => [
            id,
            {
              read: [privateMode ? canvases[i]! : canvas],
              write: privateMode ? canvases[i]! : i === 0 ? canvas : null,
            },
          ]),
        ),
      };
    await redis.sync(authority);
    await Promise.all(
      ids.map(async (id, index) => {
        const mine = privateMode ? canvases[index]! : canvas;
        const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/games`, { origin });
        clients.push(ws);
        ws.on("error", () => {});
        const ready = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("LOAD_JOIN_TIMEOUT")), 5000);
          ws.on("message", (raw) => {
            const d = JSON.parse(raw.toString());
            if (d.type === "ready") {
              clearTimeout(timeout);
              resolve();
            }
            if (d.type === "ink") {
              const at = sent.get(mine + ":" + d.event.seq);
              if (at !== undefined) latencies.push(performance.now() - at);
            }
          });
        });
        await once(ws, "open");
        ws.send(
          JSON.stringify({
            ticket: issueInkTicket(
              { roomId, phaseId: authority.phaseId, member: id, expiresAt: Date.now() + 60000 },
              key,
            ),
          }),
        );
        await ready;
        if (privateMode || index === 0) writers.push({ socket: ws, roomId, canvas: mine });
      }),
    );
  }
  for (let seq = 1; seq <= 20; seq++) {
    for (const w of writers) {
      sent.set(w.canvas + ":" + seq, performance.now());
      w.socket.send(
        JSON.stringify({
          type: "ink",
          canvas: w.canvas,
          seq,
          command: {
            op: "stroke",
            id: randomUUID(),
            colour: "#0A84FE",
            width: 4,
            points: [
              [0.1, 0.2],
              [0.3, 0.4],
            ],
          },
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  for (let i = 0; i < 100 && latencies.length < 8 * 12 * 20; i++)
    await new Promise((r) => setTimeout(r, 20));
  if (latencies.length !== 8 * 12 * 20) throw new Error(`DELIVERY_COUNT ${latencies.length}`);
  const sorted = [...latencies].sort((a, b) => a - b),
    p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  for (const w of writers) {
    const events = await redis.store.events(w.roomId, w.canvas);
    if (events.length !== 20) throw new Error("REDIS_REPLAY_INCOMPLETE");
  }
  if (p95 > 300) throw new Error(`INK_P95_EXCEEDED ${Math.round(p95)}`);
  console.log(
    JSON.stringify({
      scenario: privateMode ? "96 simultaneous private artists" : "8 public artists + 88 viewers",
      rooms: 8,
      connections: clients.length,
      delivered: latencies.length,
      p95Ms: Math.round(p95),
      redisReplayVerified: true,
      environment: "local Windows + Docker Redis, not production Ncloud",
    }),
  );
} finally {
  for (const c of clients) c.terminate();
  await gateway.close();
  await redis.close();
}
