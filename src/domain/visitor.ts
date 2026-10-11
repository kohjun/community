import { createHmac } from "node:crypto";
import { uuidSchema } from "./validation";

export function koreaDate(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error("Invalid date.");
  // Korea has a fixed UTC+09:00 offset and no daylight saving time.
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Input visitorId must come from the server-verified HttpOnly visitor cookie,
// never from a request body. Including postId prevents cross-post correlation.
export function hashVisitor(visitorId: string, postId: string, secret: string): string {
  const canonicalVisitorId = uuidSchema.parse(visitorId);
  const canonicalPostId = uuidSchema.parse(postId);
  if (secret.length < 32) throw new Error("VISITOR_HASH_SECRET must have at least 32 characters.");
  return createHmac("sha256", secret)
    .update(`sliper:view:${canonicalPostId}:${canonicalVisitorId}`)
    .digest("hex");
}
