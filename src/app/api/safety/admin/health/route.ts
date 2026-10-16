import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { operationsHealthService } from "@/server/operations-health-service";
import { apiResponse } from "@/server/http";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiResponse(async () => {
    if (new URL(request.url).searchParams.size)
      throw new AppError("VALIDATION", "이 점검은 별도 검색 조건을 사용하지 않아요.");
    return operationsHealthService(getDatabase()).snapshot(await currentActor());
  });
}
