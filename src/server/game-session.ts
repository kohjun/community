import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
const MAX_AGE = 24 * 60 * 60 * 1000;
export const GAME_COOKIE = "sliper-game-device";
export function gameDigest(secret: string, context: string, value: string) {
  if (secret.length < 32) throw new Error("Game session signing is not configured.");
  return createHmac("sha256", secret).update(`sliper:game:${context}:${value}`).digest("hex");
}
export function issueGameSession(secret: string, now = Date.now()) {
  const value = `${randomUUID()}.${now}`;
  return `${value}.${gameDigest(secret, "cookie", value)}`;
}
export function verifyGameSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (!token || token.length > 160) return null;
  const [id, time, signature, extra] = token.split(".");
  if (
    extra !== undefined ||
    !/^[a-f0-9-]{36}$/.test(id ?? "") ||
    !/^\d{13}$/.test(time ?? "") ||
    !/^[a-f0-9]{64}$/.test(signature ?? "")
  )
    return null;
  const issued = Number(time);
  if (issued > now + 60_000 || now - issued >= MAX_AGE) return null;
  const expected = gameDigest(secret, "cookie", `${id}.${time}`);
  return timingSafeEqual(Buffer.from(signature!), Buffer.from(expected)) ? id! : null;
}
export function gameNetworkKey(headers: Headers, secret: string, roomId: string) {
  // Production's loopback listener accepts traffic only from the trusted Nginx proxy.
  const candidate = headers.get("x-real-ip")?.trim() ?? "";
  const ip = isIP(candidate) ? candidate : "unknown";
  return gameDigest(secret, `network:${roomId}`, ip);
}
