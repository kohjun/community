import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { apiResponse } from "@/server/http";
import { operationsService } from "@/server/operations-service";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const q = new URL(request.url).searchParams,
      allowed = new Set(["kind", "stage", "assignment", "page"]);
    if (q.size !== new Set(q.keys()).size || [...q.keys()].some((key) => !allowed.has(key)))
      throw new AppError("VALIDATION", "목록 조회 조건을 확인해주세요.");
    return operationsService(getDatabase()).list(await currentActor(), {
      ...(q.has("kind") ? { kind: q.get("kind") } : {}),
      ...(q.has("stage") ? { stage: q.get("stage") } : {}),
      ...(q.has("assignment") ? { assignment: q.get("assignment") } : {}),
      ...(q.has("page") ? { page: q.get("page") } : {}),
    });
  });
}
