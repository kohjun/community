import { TOPICS } from "@/domain/topics";
import { apiResponse } from "@/server/http";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => {
    if (new URL(request.url).searchParams.size)
      throw new AppError("VALIDATION", "주제 목록은 검색 조건을 사용하지 않아요.");
    return { topics: TOPICS };
  });
}
