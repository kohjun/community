import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { apiResponse } from "@/server/http";
import { AppError } from "@/server/errors";
import { searchService } from "@/server/search-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request) {
  return apiResponse(async () => {
    const params = new URL(request.url).searchParams;
    const input: Record<string, string> = {};
    for (const [key, value] of params) {
      if (
        !["q", "type", "category", "page", "discussionType"].includes(key) ||
        Object.hasOwn(input, key)
      )
        throw new AppError("VALIDATION", "검색 조건을 확인해주세요.");
      input[key] = value;
    }
    return searchService(getDatabase()).search(await currentActor(), input);
  });
}
export { handle as GET, handle as HEAD };
