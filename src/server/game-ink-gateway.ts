import { createServer, type IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  inkFrame,
  verifyInkTicket,
  type InkAuthority,
  type InkStore,
  type InkTicket,
} from "./game-ink-core";
export async function createInkGateway(options: {
  store: InkStore;
  key: string;
  origin: string;
  now?: () => number;
  maxRooms?: number;
  maxConnections?: number;
}) {
  const now = options.now ?? Date.now,
    peers = new Map<
      WebSocket,
      { ticket: InkTicket; authority: InkAuthority; window: number; count: number }
    >();
  const server = createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
  });
  const sockets = new WebSocketServer({
    server,
    maxPayload: 16384,
    perMessageDeflate: false,
    verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage; secure: boolean }) =>
      origin === options.origin && req.url === "/ws/games",
  });
  const send = (ws: WebSocket, value: unknown) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 512 * 1024) {
      ws.close(1013, "Reconnect for a fresh canvas");
      return;
    }
    ws.send(JSON.stringify(value));
  };
  const unlisten = await options.store.listen((value) => {
    for (const [ws, p] of peers) {
      if (p.ticket.roomId !== value.roomId) continue;
      if (value.authority) {
        p.authority = value.authority;
        if (
          p.ticket.phaseId !== value.authority.phaseId ||
          !value.authority.members[p.ticket.member]
        )
          ws.close(4001, "Game stage changed");
      } else if (
        value.canvas &&
        value.event &&
        p.authority.members[p.ticket.member]?.read.includes(value.canvas)
      )
        send(ws, { type: "ink", canvas: value.canvas, event: value.event });
    }
  });
  sockets.on("connection", (ws) => {
    if (sockets.clients.size > (options.maxConnections ?? 128)) {
      ws.close(1013, "Game server busy");
      return;
    }
    const authDeadline = setTimeout(() => ws.close(4001, "Authentication required"), 5000);
    let processing = Promise.resolve(),
      bad = 0,
      outstanding = 0;
    ws.on("message", (raw) => {
      if (++outstanding > 32) {
        ws.close(4008, "Too many pending messages");
        outstanding--;
        return;
      }
      processing = processing
        .then(async () => {
          let value: unknown;
          try {
            value = JSON.parse(raw.toString());
          } catch {
            ws.close(4000, "Invalid payload");
            return;
          }
          let p = peers.get(ws);
          if (!p) {
            const ticket = verifyInkTicket(
              (value as { ticket?: unknown })?.ticket,
              options.key,
              now(),
            );
            if (!ticket) {
              ws.close(4001, "Invalid ticket");
              return;
            }
            const authority = await options.store.authority(ticket.roomId);
            if (
              !authority ||
              authority.expiresAt <= now() ||
              authority.phaseId !== ticket.phaseId ||
              !authority.members[ticket.member]
            ) {
              ws.close(4003, "Room access expired");
              return;
            }
            const rooms = new Set([...peers.values()].map((p) => p.ticket.roomId));
            if (!rooms.has(ticket.roomId) && rooms.size >= (options.maxRooms ?? 8)) {
              ws.close(4009, "All game tables are occupied");
              return;
            }
            clearTimeout(authDeadline);
            p = { ticket, authority, window: Math.floor(now() / 1000), count: 0 };
            peers.set(ws, p);
            for (const canvas of authority.members[ticket.member]!.read)
              send(ws, {
                type: "snapshot",
                canvas,
                events: await options.store.events(ticket.roomId, canvas),
              });
            send(ws, { type: "ready" });
            return;
          }
          if (p.ticket.expiresAt <= now()) {
            ws.close(4001, "Renew ticket");
            return;
          }
          const parsed = inkFrame.safeParse(value);
          if (!parsed.success) {
            if (++bad >= 3) ws.close(4000, "Invalid ink");
            return;
          }
          const frame = parsed.data,
            window = Math.floor(now() / 1000);
          if (p.window !== window) {
            p.window = window;
            p.count = 0;
          }
          if (++p.count > 12) {
            if (++bad >= 3) ws.close(4008, "Slow down");
            return;
          }
          const authority = await options.store.authority(p.ticket.roomId);
          if (
            !authority ||
            authority.phaseId !== p.ticket.phaseId ||
            authority.expiresAt <= now() ||
            authority.members[p.ticket.member]?.write !== frame.canvas
          ) {
            ws.close(4003, "Canvas is read only");
            return;
          }
          p.authority = authority;
          const result = await options.store.append(p.ticket.roomId, frame.canvas, {
            seq: frame.seq,
            command: frame.command,
          });
          if (result === "resync")
            send(ws, {
              type: "snapshot",
              canvas: frame.canvas,
              events: await options.store.events(p.ticket.roomId, frame.canvas),
            });
          else if (result === "full")
            send(ws, { type: "limit", message: "그림을 충분히 담았어요. 완성 버튼을 눌러주세요." });
          else send(ws, { type: "ack", canvas: frame.canvas, seq: frame.seq });
        })
        .catch(() => ws.close(1013, "Ink service reconnecting"))
        .finally(() => {
          outstanding--;
        });
    });
    ws.on("close", () => {
      clearTimeout(authDeadline);
      peers.delete(ws);
    });
    ws.on("error", () => {});
  });
  const sweep = setInterval(() => {
    for (const [ws, p] of peers)
      if (p.ticket.expiresAt <= now() || p.authority.expiresAt <= now())
        ws.close(4001, "Renew ticket");
  }, 5000);
  sweep.unref();
  return {
    server,
    async close() {
      clearInterval(sweep);
      await unlisten();
      for (const ws of sockets.clients) ws.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
