import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { profiles } from "@/db/schema";
import { currentIdentity } from "@/server/identity";
import { authConfiguration } from "@/server/auth-config";
import { localTestAuthAvailable } from "@/server/local-test-access";
import { apiResponse } from "@/server/http";
import { safetyService } from "@/server/safety-service";
export const dynamic = "force-dynamic";
export async function GET() {
  return apiResponse(async () => {
    const { authenticatedId: raw, actor } = await currentIdentity();
    const [profileRows, role] = await Promise.all([
      raw
        ? getDatabase()
            .select({ nickname: profiles.nickname })
            .from(profiles)
            .where(eq(profiles.id, raw))
        : [],
      actor ? safetyService(getDatabase()).role(actor) : null,
    ]);
    const [profile] = profileRows;
    return {
      available: !!authConfiguration() || localTestAuthAvailable((await headers()).get("host")),
      authenticated: !!actor,
      nickname: profile?.nickname ?? null,
      restricted: !!raw && !actor,
      mode: authConfiguration() ? "supabase" : "development",
      role,
    };
  });
}
