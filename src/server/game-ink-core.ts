import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { inkCommand, type InkEvent } from "../domain/game-ink";
export type InkAuthority = {
  roomId: string;
  revision: number;
  phaseId: string;
  expiresAt: number;
  members: Record<string, { read: string[]; write: string | null }>;
};
const ticketSchema = z.strictObject({
  roomId: z.uuid(),
  member: z.string().min(1).max(40),
  phaseId: z.uuid(),
  expiresAt: z.number().int(),
});
export type InkTicket = z.infer<typeof ticketSchema>;
function signature(body: string, key: string) {
  if (key.length < 32) throw new Error("Game ink signing is not configured.");
  return createHmac("sha256", key)
    .update("sliper:game-ink:" + body)
    .digest("base64url");
}
export function issueInkTicket(data: InkTicket, key: string) {
  const body = Buffer.from(JSON.stringify(ticketSchema.parse(data))).toString("base64url");
  return body + "." + signature(body, key);
}
export function verifyInkTicket(token: unknown, key: string, now = Date.now()): InkTicket | null {
  try {
    if (typeof token !== "string" || token.length > 2048) return null;
    const [body, sig, extra] = token.split(".");
    if (!body || !sig || extra !== undefined) return null;
    const expected = signature(body, key);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return null;
    const data = ticketSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
    return data.expiresAt > now && data.expiresAt <= now + 90_000 ? data : null;
  } catch {
    return null;
  }
}
export const inkFrame = z.strictObject({
  type: z.literal("ink"),
  canvas: z.string().regex(/^[a-zA-Z0-9:-]{1,160}$/),
  seq: z.number().int().min(1).max(1500),
  command: inkCommand,
});
export interface InkStore {
  authority(roomId: string): Promise<InkAuthority | null>;
  events(roomId: string, canvas: string): Promise<InkEvent[]>;
  append(
    roomId: string,
    canvas: string,
    event: InkEvent,
  ): Promise<"ok" | "duplicate" | "resync" | "full">;
  listen(
    handler: (event: {
      roomId: string;
      canvas?: string;
      event?: InkEvent;
      authority?: InkAuthority;
    }) => void,
  ): Promise<() => Promise<void>>;
}
