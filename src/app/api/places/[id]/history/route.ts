import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { AppError } from "@/server/errors";
import { apiResponse } from "@/server/http";
import { createPlaceHistoryService } from "@/server/place-history-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) {
      if (params.getAll(key).length !== 1)
        throw new AppError("VALIDATION", "검색 조건을 한 번씩 지정해주세요.");
    }
    return createPlaceHistoryService(getDatabase()).history(
      await currentActor(),
      id,
      Object.fromEntries(params),
    );
  });
}
export { handle as GET, handle as HEAD };
