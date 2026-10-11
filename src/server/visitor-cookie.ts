import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { uuidSchema } from "../domain/validation";

export async function visitorIdentity() {
  const secret = process.env.VISITOR_HASH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Missing visitor secret");
  const sign = (id: string) =>
    createHmac("sha256", secret).update(`sliper:visitor:${id}`).digest("hex");
  const jar = await cookies();
  const [id, signature] = (jar.get("sliper-visitor")?.value ?? "").split(".");
  if (
    id &&
    uuidSchema.safeParse(id).success &&
    signature &&
    /^[a-f0-9]{64}$/.test(signature) &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id)))
  )
    return { id, secret };
  const fresh = randomUUID();
  jar.set("sliper-visitor", `${fresh}.${sign(fresh)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.APP_ORIGIN?.startsWith("https:") ?? false,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { id: fresh, secret };
}
