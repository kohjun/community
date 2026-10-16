import { getDatabase } from "@/db/client";
import { authenticatedActor } from "@/server/identity";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { AppError } from "@/server/errors";
import { appealService } from "@/server/appeal-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const q = new URL(request.url).searchParams,
      allowed = new Set(["page", "actionId"]);
    if (q.size !== new Set(q.keys()).size || [...q.keys()].some((key) => !allowed.has(key)))
      throw new AppError("VALIDATION", "이의신청 조회 조건을 확인해주세요.");
    return appealService(getDatabase()).list(await authenticatedActor(), {
      ...(q.has("page") ? { page: q.get("page") } : {}),
      ...(q.has("actionId") ? { actionId: q.get("actionId") } : {}),
    });
  });
}
export async function POST(request: Request) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    if (new URL(request.url).searchParams.size)
      throw new AppError("VALIDATION", "이의신청 요청을 확인해주세요.");
    return appealService(getDatabase()).submit(await authenticatedActor(), await readJson(request));
  });
}
