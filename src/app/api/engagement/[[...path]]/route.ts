import { getDatabase } from "@/db/client";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { currentActor } from "@/server/identity";
import { AppError } from "@/server/errors";
import { engagementService } from "@/server/engagement-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const { path = [] } = await context.params,
      method = request.method === "HEAD" ? "GET" : request.method;
    const actor = await currentActor(),
      service = engagementService(getDatabase());
    if (method !== "GET") assertSameOrigin(request);
    if (path.length === 1 && path[0] === "inbox" && method === "GET")
      return service.inbox(actor, Object.fromEntries(new URL(request.url).searchParams));
    if (path.length === 2 && path[0] === "inbox" && path[1] === "read" && method === "POST")
      return service.markRead(actor, await readJson(request));
    if (path.length === 1 && path[0] === "subscriptions" && method === "GET")
      return service.subscriptions(actor);
    if (
      path.length === 2 &&
      path[0] === "subscriptions" &&
      path[1] === "categories" &&
      method === "PUT"
    )
      return service.updateCategories(actor, await readJson(request));
    if (path.length === 2 && path[0] === "hosts" && path[1]) {
      if (method === "GET") return service.host(actor, path[1]);
      if (method === "PUT") return service.updateHost(actor, path[1], await readJson(request));
    }
    throw new AppError("NOT_FOUND", "이 요청을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as POST, handle as PUT };
