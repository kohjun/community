import { safeExternalLink } from "../domain/post-document";
import { parseRedisConfiguration } from "./redis-configuration";
export type RoomRealtimeConfiguration =
  | { provider: "polling" }
  | { provider: "redis"; url: string }
  | { provider: "supabase"; url: string; secretKey: string };
export function roomRealtimeConfiguration(
  env: Record<string, string | undefined> = process.env,
): RoomRealtimeConfiguration {
  const cloud = env.SLIPER_CLOUD_ONLY === "true";
  const provider =
    env.ROOM_REALTIME_PROVIDER?.trim() ||
    (cloud ? "supabase" : env.REDIS_URL?.trim() ? "redis" : "polling");
  if (provider === "polling") return { provider };
  if (provider === "redis" && !cloud && parseRedisConfiguration(env.REDIS_URL))
    return { provider, url: env.REDIS_URL!.trim() };
  if (provider === "supabase") {
    try {
      const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
      const secretKey =
        env.SUPABASE_REALTIME_SECRET_KEY?.trim() ||
        env.SUPABASE_SERVER_SECRET_KEY?.trim() ||
        env.SUPABASE_STORAGE_SECRET_KEY?.trim() ||
        "";
      let validKey = /^sb_secret_[A-Za-z0-9_-]{24,}$/.test(secretKey);
      if (secretKey.startsWith("eyJ")) {
        const parts = secretKey.split(".");
        validKey =
          parts.length === 3 &&
          JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")).role ===
            "service_role";
      }
      if (
        safeExternalLink(url.href) &&
        url.protocol === "https:" &&
        !url.port &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        validKey
      )
        return { provider, url: url.origin, secretKey };
    } catch {
      /* Configuration errors must not include credentials. */
    }
  }
  throw new Error("Announcement realtime server configuration is invalid.");
}
