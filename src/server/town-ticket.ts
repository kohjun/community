import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
const claimSchema = z.strictObject({
  worldId: z.literal("main-world"),
  actor: z.string().uuid(),
  nonce: z.string().uuid(),
  exp: z.number().int(),
});
export const TOWN_TICKET_MS = 90_000;
export function townSecret(value = process.env.TOWN_SIGNING_SECRET) {
  if (!value || value.length < 48) throw new Error("Town signing is not configured.");
  return value;
}
export function townSignature(value: string, key: string) {
  return createHmac("sha256", townSecret(key)).update(value).digest("base64url");
}
export function townSignatureMatches(value: string, signature: string, key: string) {
  const expected = Buffer.from(townSignature(value, key));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function issueTownTicket(actor: string, key: string, now = Date.now()) {
  const claim = claimSchema.parse({
    worldId: "main-world",
    actor,
    nonce: randomUUID(),
    exp: now + TOWN_TICKET_MS,
  });
  const body = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${body}.${townSignature(body, key)}`;
}
export function verifyTownTicket(ticket: string, key: string, now = Date.now()) {
  try {
    if (ticket.length > 2048) return null;
    const [body, signature, extra] = ticket.split(".");
    if (!body || !signature || extra || !townSignatureMatches(body, signature, key)) return null;
    const value = claimSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
    return value.exp > now && value.exp <= now + TOWN_TICKET_MS ? value : null;
  } catch {
    return null;
  }
}
