import { topicQuerySchema } from "@/domain/topics";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { topicService } from "@/server/topic-service";
import { apiResponse } from "@/server/http";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return apiResponse(async () => {
    const input: Record<string, string> = Object.create(null);
    for (const [key, value] of new URL(request.url).searchParams) {
      if (!Object.hasOwn(topicQuerySchema.shape, key))
        throw new AppError("VALIDATION", "허용되지 않는 검색 조건이에요.");
      if (Object.hasOwn(input, key))
        throw new AppError("VALIDATION", "중복 검색 조건을 제거해주세요.");
      input[key] = value;
    }
    return topicService(getDatabase()).detail(
      await currentActor(),
      (await context.params).slug,
      input,
    );
  });
}
