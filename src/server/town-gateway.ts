import type { IncomingMessage, ServerResponse, RequestListener } from "node:http";
import { Server, Room, matchMaker, type Client, type AuthContext } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { schema, t, type SchemaType } from "@colyseus/schema";
import { townInputSchema } from "../domain/town";
import { TownWorld, type TownMember } from "./town-world";
import { townSignatureMatches, verifyTownTicket } from "./town-ticket";
type Peer = {
  client: Client;
  actor: string;
  expires: number;
  messages: string;
  lastSent: number;
  invalid: number;
  known: Map<string, { index: number; stamp: string }>;
  nextIndex: number;
  fullAt: number;
};
const WorldMetadata = schema(
  { worldId: t.string().default("main-world"), occupancy: t.number().default(0) },
  "SliperWorldMetadata",
);
type WorldMetadata = SchemaType<typeof WorldMetadata>;
export function createTownGateway(options: {
  key: string;
  origin: string;
  members: (actors: string[]) => Promise<TownMember[]>;
  now?: () => number;
  capacity?: number;
  isHealthy?: () => boolean;
  chatLimit?: (actor: string) => Promise<boolean>;
  consumeNonce?: (nonce: string, ttl: number) => Promise<boolean>;
  onVoice?: (targets: Map<string, string[]>) => Promise<void>;
  onRemoveVoice?: (identity: string) => Promise<void>;
}) {
  const now = options.now ?? Date.now,
    world = new TownWorld(now, options.capacity),
    peers = new Map<string, Peer>(),
    used = new Map<string, number>();
  let roomId = "",
    healthy = true,
    refreshing = false,
    serverRoom: WorldRoom | undefined,
    stopping = false;
  const ticks: number[] = [];
  const boot = now();
  const members = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const actors = [...world.residents.keys()],
        found = await options.members(actors),
        allowed = new Set(found.map((m) => m.actor));
      for (const m of found) world.updateMember(m);
      for (const actor of actors)
        if (!allowed.has(actor)) {
          for (const p of peers.values())
            if (p.actor === actor) {
              void options.onRemoveVoice?.(world.residents.get(actor)?.avatar.id ?? "");
              p.client.leave(4003);
            }
          world.remove(actor);
        }
      healthy = true;
    } catch {
      healthy = false;
      for (const p of peers.values()) p.client.leave(1013);
    } finally {
      refreshing = false;
    }
  };
  async function claim(ticket: unknown) {
    if (typeof ticket !== "string") throw new Error("입장 티켓이 필요해요.");
    const value = verifyTownTicket(ticket, options.key, now());
    if (!value) throw new Error("입장 티켓이 만료됐어요.");
    for (const [id, exp] of used) if (exp <= now()) used.delete(id);
    if (used.size >= 512 || used.has(value.nonce)) throw new Error("이미 사용한 입장 티켓이에요.");
    used.set(value.nonce, value.exp);
    if (options.consumeNonce && !(await options.consumeNonce(value.nonce, value.exp - now())))
      throw new Error("이미 사용한 입장 티켓이에요.");
    const member = (await options.members([value.actor]))[0];
    if (!member) throw new Error("이용 가능한 계정으로 로그인해주세요.");
    return { member, expires: value.exp };
  }
  class WorldRoom extends Room<{ state: WorldMetadata }> {
    onCreate() {
      serverRoom = this;
      this.autoDispose = false;
      this.maxClients = world.capacity + 8;
      this.maxMessagesPerSecond = 70;
      this.state = new WorldMetadata();
      this.patchRate = 100;
      this.onMessage("town:action", (client, value) => {
        void action(client, value);
      });
      this.onMessage("player:input", (client, value) => {
        void action(client, { ...value, type: "input" });
      });
      this.onMessage("player:report", (client, value) => {
        void action(client, { ...value, type: "report" });
      });
      this.setSimulationInterval(() => {
        const start = performance.now();
        world.tick();
        for (const p of peers.values()) if (p.expires <= now()) p.client.leave(4001);
        this.state.occupancy = world.residents.size;
        ticks.push(performance.now() - start);
        if (ticks.length > 3600) ticks.shift();
      }, 1000 / 30);
      this.clock.setInterval(() => {
        for (const p of peers.values()) {
          if (world.residents.get(p.actor)?.connection !== p.client.sessionId) continue;
          if (
            ((p.client.ref as unknown as { bufferedAmount?: number }).bufferedAmount ?? 0) >
            128 * 1024
          ) {
            p.client.leave(1013);
            continue;
          }
          const view = world.view(p.actor);
          if (!view) continue;
          const visible = new Set(view.players.map((a) => a.id));
          for (const [id, known] of p.known)
            if (!visible.has(id)) {
              p.client.send("player:left", { index: known.index, id });
              p.known.delete(id);
            }
          const snapshots: number[][] = [];
          for (const avatar of view.players) {
            let known = p.known.get(avatar.id);
            if (!known) {
              known = { index: p.nextIndex++, stamp: "" };
              p.known.set(avatar.id, known);
              p.client.send("player:joined", { index: known.index, avatar });
            }
            const seat = ["shade-a", "shade-b", "garden-a", "garden-b"].indexOf(avatar.seat ?? "");
            const tuple = [
              known.index,
              Math.round(avatar.x * 100),
              Math.round(avatar.z * 100),
              Math.round(avatar.yaw * 100),
              (avatar.online ? 1 : 0) | (avatar.moving ? 2 : 0),
              seat,
              Math.max(0, Math.round((avatar.wavingUntil - now()) / 100)),
            ];
            const stamp = tuple.join();
            if (stamp !== known.stamp) {
              snapshots.push(tuple);
              known.stamp = stamp;
            }
          }
          if (snapshots.length) p.client.send("player:snapshots", snapshots);
          const messages = JSON.stringify(view.messages);
          if (messages !== p.messages || now() - p.fullAt >= 10000) {
            p.client.send("world:state", view);
            p.messages = messages;
            p.fullAt = now();
          } else if (now() - p.lastSent >= 1000) {
            p.client.send("world:meta", {
              now: now(),
              occupancy: view.occupancy,
              capacity: view.capacity,
            });
          }
          if (now() - p.lastSent >= 1000) p.lastSent = now();
        }
      }, 50);
      this.clock.setInterval(() => void members(), 15_000);
      this.clock.setInterval(() => {
        const targets = new Map<string, string[]>();
        for (const p of peers.values()) {
          const id = world.residents.get(p.actor)?.avatar.id;
          if (id) {
            const list = world.voiceTargets(p.actor);
            p.client.send("voice:targets", { nearbyPlayerIds: list });
            targets.set(id, list);
          }
        }
        void options.onVoice?.(targets).catch(() => {
          for (const p of peers.values())
            p.client.send("town:error", {
              message: "음성 권한을 확인하는 중이에요. 잠시 뒤 다시 연결해주세요.",
            });
        });
      }, 200);
    }
    async onAuth(_client: Client, value: { ticket?: unknown }, context: AuthContext) {
      if (context.headers.get("origin") !== options.origin)
        throw new Error("허용되지 않은 접속이에요.");
      return claim(value?.ticket);
    }
    onJoin(client: Client, _value: unknown, auth: { member: TownMember; expires: number }) {
      const joined = world.join(auth.member, client.sessionId);
      if (joined.replaced && joined.replaced !== client.sessionId) {
        const old = peers.get(joined.replaced);
        if (old) old.client.leave(4009);
      }
      peers.set(client.sessionId, {
        client,
        actor: auth.member.actor,
        expires: auth.expires,
        messages: "",
        lastSent: 0,
        invalid: 0,
        known: new Map(),
        nextIndex: 0,
        fullAt: 0,
      });
      client.send("world:ready", { worldId: "main-world" });
    }
    onLeave(client: Client, code?: number) {
      const p = peers.get(client.sessionId);
      peers.delete(client.sessionId);
      if (!p) return;
      const id = world.residents.get(p.actor)?.avatar.id;
      if (code === 4000 || code === 1000) world.remove(p.actor, client.sessionId);
      else world.disconnect(p.actor, client.sessionId);
      if (id && world.residents.get(p.actor)?.connection !== client.sessionId)
        void options.onRemoveVoice?.(id).catch(() => {});
    }
  }
  async function action(client: Client, value: unknown) {
    const p = peers.get(client.sessionId);
    if (!p) return;
    try {
      const input = townInputSchema.parse(value);
      if (input.type === "auth") {
        const fresh = await claim(input.ticket);
        if (fresh.member.actor !== p.actor) throw new Error("계정을 다시 확인해주세요.");
        world.updateMember(fresh.member);
        p.expires = fresh.expires;
        return;
      }
      if (p.expires <= now()) {
        client.leave(4001);
        return;
      }
      if (input.type === "chat" && options.chatLimit && !(await options.chatLimit(p.actor)))
        throw new Error("채팅은 1분에 20개까지 보낼 수 있어요.");
      world.input(p.actor, client.sessionId, input);
      if (input.type === "leave") {
        client.leave(4000);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "요청을 확인해주세요.";
      if (message === "movement_validation") {
        const a = world.residents.get(p.actor)?.avatar;
        if (a) client.send("player:correction", { x: a.x, z: a.z, sequence: a.sequence });
        return;
      }
      client.send("town:error", {
        message: message.startsWith("[") ? "입력값을 확인해주세요." : message,
      });
      if (++p.invalid > 10) client.leave(1008);
    }
  }
  const transport = new WebSocketTransport({
    maxPayload: 4096,
    perMessageDeflate: false,
    pingInterval: 10_000,
    pingMaxRetries: 2,
    beforeUpgrade: (request) =>
      request.headers.get("origin") === options.origin
        ? undefined
        : new Response(null, { status: 403 }),
  });
  const game = new Server({ transport, greet: false, gracefullyShutdown: false });
  async function gate(req: IncomingMessage, res: ServerResponse, handlers: RequestListener[]) {
    res.setHeader("Cache-Control", "no-store");
    if (req.headers.origin === options.origin) {
      res.setHeader("Access-Control-Allow-Origin", options.origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    if (
      req.method === "OPTIONS" &&
      req.headers.origin === options.origin &&
      req.url === `/matchmake/joinById/${roomId}`
    ) {
      res.setHeader("Access-Control-Allow-Methods", "POST");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.writeHead(204).end();
      return;
    }

    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.method === "GET" && req.url === "/health") {
      json(
        {
          ok: healthy && !stopping && (options.isHealthy?.() ?? true),
          uptimeSeconds: Math.floor((now() - boot) / 1000),
        },
        healthy && !stopping && (options.isHealthy?.() ?? true) ? 200 : 503,
      );
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/internal/")) {
      try {
        const raw = await read(req),
          stamp = req.headers["x-town-time"],
          sig = req.headers["x-town-signature"];
        if (
          typeof stamp !== "string" ||
          typeof sig !== "string" ||
          !/^\d{13}$/.test(stamp) ||
          Math.abs(now() - Number(stamp)) > 10_000 ||
          !townSignatureMatches(`${stamp}\n${req.url}\n${raw}`, sig, options.key)
        ) {
          res.writeHead(403).end();
          return;
        }
        const value = JSON.parse(raw);
        if (req.url === "/internal/refresh") {
          await members();
          json({}, healthy ? 200 : 503);
          return;
        }
        if (req.url === "/internal/metrics") {
          const sorted = [...ticks].sort((a, b) => a - b);
          json({
            residents: world.residents.size,
            connections: peers.size,
            tickP95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
            samples: ticks.length,
          });
          return;
        }
        if (req.url === "/internal/world") {
          json({ roomId });
          return;
        }
        if (req.url === "/internal/session") {
          const p = world.residents.get(value.actor);
          if (!p?.connection) throw new Error();
          json({ identity: p.avatar.id, worldId: "main-world" });
          return;
        }
        if (
          req.url !== "/internal/evidence" ||
          typeof value.actor !== "string" ||
          typeof value.target !== "string" ||
          !["message", "player"].includes(value.kind)
        )
          throw new Error();
        json(world.evidence(value.actor, value.target, value.kind));
        return;
      } catch {
        json({ error: "광장 상태를 확인할 수 없어요." }, 400);
        return;
      }
    }
    if (
      req.headers.origin !== options.origin ||
      req.method !== "POST" ||
      !roomId ||
      req.url !== `/matchmake/joinById/${roomId}` ||
      Number(req.headers["content-length"] ?? 0) > 4096
    ) {
      res.writeHead(403).end();
      return;
    }
    for (const handler of handlers) handler.call(game.transport.server, req, res);
  }
  game.define("sliper-town", WorldRoom);
  return {
    world,
    refreshMembers: members,
    get roomId() {
      return roomId;
    },
    async listen(port: number, host = "127.0.0.1") {
      await game.listen(port, host);
      const server = game.transport.server!,
        handlers = server.listeners("request") as RequestListener[];
      server.requestTimeout = 10000;
      server.headersTimeout = 5000;
      server.maxConnections = 256;
      server.removeAllListeners("request");
      server.on("request", (req, res) => {
        void gate(req, res, handlers).catch(() => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
      });
      const room = await matchMaker.createRoom("sliper-town", {});
      roomId = room.roomId;
      return roomId;
    },
    async close() {
      stopping = true;
      await game.gracefullyShutdown(false);
    },
    get server() {
      return game.transport.server!;
    },
    get room() {
      return serverRoom;
    },
  };
}
async function read(req: AsyncIterable<Buffer>) {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new Error();
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}
