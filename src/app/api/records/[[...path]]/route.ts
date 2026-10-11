import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { createRecordTemplateService } from "@/server/record-template-service";
import { recordService } from "@/server/record-service";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const { path = [] } = await context.params;
    const method = request.method === "HEAD" ? "GET" : request.method;
    if (method !== "GET") assertSameOrigin(request);
    const actor = await currentActor(),
      service = recordService(getDatabase());
    if (!path.length && method === "GET")
      return service.list(actor, Object.fromEntries(new URL(request.url).searchParams));
    const [id, action] = path;
    if (id && path.length === 1) {
      if (method === "GET") return service.detail(actor, id);
      if (method === "PATCH") return service.save(actor, id, await readJson(request, 250_000));
    }
    if (id && action === "publish" && path.length === 2 && method === "POST")
      return service.publish(actor, id, await readJson(request));
    if (id && action === "template-draft" && path.length === 2 && method === "POST")
      return createRecordTemplateService(getDatabase()).createDraft(
        actor,
        id,
        await readJson(request),
      );
    throw new AppError("NOT_FOUND", "행사 기록 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as PATCH, handle as POST };
