import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { pushService } from "@/server/push-service";
import { AppError } from "@/server/errors";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const { path = [] } = await context.params;
    const actor = await currentActor(),
      service = pushService(getDatabase());
    const method = request.method === "HEAD" ? "GET" : request.method;
    if (method !== "GET") assertSameOrigin(request);
    if (path.length === 1 && path[0] === "settings") {
      if (method === "GET")
        return service.settings(actor, new URL(request.url).searchParams.get("device"));
      if (method === "PATCH") return service.update(actor, await readJson(request));
    }
    if (path.length === 1 && path[0] === "subscriptions") {
      if (method === "POST") return service.subscribe(actor, await readJson(request));
      if (method === "DELETE") return service.unsubscribe(actor, await readJson(request));
    }
    if (path.length === 1 && path[0] === "test" && method === "POST")
      return service.test(actor, await readJson(request));
    throw new AppError("NOT_FOUND", "알림 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as POST, handle as PATCH, handle as DELETE };
