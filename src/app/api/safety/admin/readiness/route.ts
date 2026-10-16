import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { releaseReadinessService } from "@/server/release-readiness-service";
import { apiResponse } from "@/server/http";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const actor = await currentActor();
    const service = releaseReadinessService(getDatabase());
    // Authenticate before exposing even a configuration report. No query selects an env or a probe.
    const result = await service.snapshot(actor);
    if (new URL(request.url).searchParams.size)
      throw new AppError("VALIDATION", "이 점검은 검색 조건을 사용하지 않아요.");
    return result;
  });
}
