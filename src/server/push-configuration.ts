import { createECDH } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export interface PushConfiguration {
  subject: string;
  publicKey: string;
  privateKey: string;
}
const configSchema = z.strictObject({
  subject: z
    .string()
    .max(512)
    .refine((value) => {
      try {
        const u = new URL(value);
        return (
          (u.protocol === "mailto:" && /^[^\s@]+@[^\s@]+$/.test(u.pathname)) ||
          (u.protocol === "https:" && !u.username && !u.password && u.hostname !== "localhost")
        );
      } catch {
        return false;
      }
    }),
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  privateKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export function isLocalPushDevelopment(env: NodeJS.ProcessEnv = process.env) {
  if (
    env.NODE_ENV === "production" ||
    env.LOCAL_DATABASE !== "1" ||
    env.SLIPER_AUTH_MODE !== "development"
  )
    return false;
  try {
    const u = new URL(env.DATABASE_URL || "http://missing");
    return u.hostname === "127.0.0.1" && u.port === "55432" && u.pathname === "/sliper_dev";
  } catch {
    return false;
  }
}
export function parsePushConfiguration(value: unknown): PushConfiguration | null {
  const result = configSchema.safeParse(value);
  if (!result.success) return null;
  try {
    const ec = createECDH("prime256v1");
    ec.setPrivateKey(Buffer.from(result.data.privateKey, "base64url"));
    return ec.getPublicKey().toString("base64url") === result.data.publicKey ? result.data : null;
  } catch {
    return null;
  }
}
export function pushConfiguration(env: NodeJS.ProcessEnv = process.env): PushConfiguration | null {
  if (env.VAPID_PUBLIC_KEY || env.VAPID_PRIVATE_KEY || env.VAPID_SUBJECT) {
    return parsePushConfiguration({
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });
  }
  // Only the isolated local database can use an ignored development key file.
  // Production reads credentials solely from server environment variables.
  if (!isLocalPushDevelopment(env)) return null;
  try {
    return parsePushConfiguration(
      JSON.parse(
        readFileSync(
          /* turbopackIgnore: true */ path.resolve(process.cwd(), ".local", "push-vapid.json"),
          "utf8",
        ),
      ),
    );
  } catch {
    return null;
  }
}
