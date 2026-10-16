import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { eventAftercareService } from "@/server/event-aftercare-service";
import { apiResponse } from "@/server/http";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const search = new URL(request.url).searchParams;
    if (
      search.size !== new Set(search.keys()).size ||
      [...search.keys()].some((key) => !["scope", "view", "page"].includes(key))
    )
      throw new AppError("VALIDATION", "허용된 검색 조건을 한 번씩만 입력해주세요.");
    return eventAftercareService(getDatabase()).list(
      await currentActor(),
      Object.fromEntries(search),
    );
  });
}
