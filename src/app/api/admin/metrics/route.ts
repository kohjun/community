import { currentActor } from "@/server/identity";
import { getDatabase } from "@/db/client";
import { analyticsService } from "@/server/analytics-service";
import { apiResponse } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiResponse(async () =>
    analyticsService(getDatabase()).summary(
      await currentActor(),
      Object.fromEntries(new URL(request.url).searchParams),
    ),
  );
}
