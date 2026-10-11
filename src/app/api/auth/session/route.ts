import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { profiles } from "@/db/schema";
import { authenticatedActor, currentActor } from "@/server/identity";
import { authConfiguration } from "@/server/auth-config";
import { localTestAuthAvailable } from "@/server/local-test-access";
import { apiResponse } from "@/server/http";
import { safetyService } from "@/server/safety-service";
export const dynamic = "force-dynamic";
export async function GET() {
  return apiResponse(async () => {
    const raw = await authenticatedActor(),
      actor = await currentActor();
    const [profile] = raw
      ? await getDatabase()
          .select({ nickname: profiles.nickname })
          .from(profiles)
          .where(eq(profiles.id, raw))
      : [];
    return {
      available: !!authConfiguration() || localTestAuthAvailable((await headers()).get("host")),
      authenticated: !!actor,
      nickname: profile?.nickname ?? null,
      restricted: !!raw && !actor,
      mode: authConfiguration() ? "supabase" : "development",
      role: actor ? await safetyService(getDatabase()).role(actor) : null,
    };
  });
}
