import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { operationsService } from "@/server/operations-service";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ kind: string; id: string }> };
export async function GET(request: Request, context: Context) {
  return apiResponse(async () => {
    if (new URL(request.url).searchParams.size)
      throw new AppError("VALIDATION", "상세 조회 요청을 확인해주세요.");
    const { kind, id } = await context.params;
    return operationsService(getDatabase()).detail(await currentActor(), kind, id);
  });
}
export async function PATCH(request: Request, context: Context) {
  return apiResponse(async () => {
    assertSameOrigin(request);
    if (new URL(request.url).searchParams.size)
      throw new AppError("VALIDATION", "운영 작업 요청을 확인해주세요.");
    const { kind, id } = await context.params;
    return operationsService(getDatabase()).triage(
      await currentActor(),
      kind,
      id,
      await readJson(request),
    );
  });
}
