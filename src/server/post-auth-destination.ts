import "server-only";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { profiles } from "@/db/schema";
import { memberSafety } from "@/db/safety-schema";
import { membershipActive } from "@/domain/safety";
import { isProfileReadyForApplication, safeProfileReturnTo } from "@/domain/profile";

export async function postAuthDestination(actor: string, returnTo: unknown) {
  const db = getDatabase();
  const [state] = await db.select().from(memberSafety).where(eq(memberSafety.userId, actor));
  if (!membershipActive(state)) return "/settings/account";

  await db.insert(profiles).values({ id: actor, nickname: "슬리퍼 회원" }).onConflictDoNothing();
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, actor));
  if (!profile) throw new Error("Missing profile");

  const next = safeProfileReturnTo(returnTo ?? "/");
  return isProfileReadyForApplication(profile)
    ? next
    : "/signup?returnTo=" + encodeURIComponent(next);
}
