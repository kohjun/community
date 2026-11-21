import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { eventMapService } from "@/server/event-map-service";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const { path = [] } = await context.params,
      method = request.method === "HEAD" ? "GET" : request.method;
    if (method !== "GET") assertSameOrigin(request);
    const actor = await currentActor(),
      service = eventMapService(getDatabase());
    if (!path.length && method === "GET") {
      const search = new URL(request.url).searchParams;
      const query: Record<string, unknown> = {};
      for (const key of [
        "south",
        "west",
        "north",
        "east",
        "q",
        "category",
        "mode",
        "meetupType",
        "eventId",
      ]) {
        if (search.has(key)) query[key] = search.get(key);
      }
      for (const key of ["freeOnly", "openOnly"]) {
        if (!search.has(key)) continue;
        const value = search.get(key);
        if (value !== "true" && value !== "false")
          throw new AppError("VALIDATION", "지도 필터를 확인해주세요.");
        query[key] = value === "true";
      }
      return service.list(actor, query);
    }
    if (!path.length && method === "POST") return service.create(actor, await readJson(request));
    const [id, action] = path;
    if (path.length === 1 && id) {
      if (method === "GET") return service.detail(actor, id);
      if (method === "PUT") return service.update(actor, id, await readJson(request));
      if (method === "DELETE") return service.remove(actor, id, await readJson(request));
    }
    if (path.length === 2 && id && action === "recommend" && method === "POST")
      return service.recommend(actor, id, await readJson(request));
    throw new AppError("NOT_FOUND", "요청한 지도 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as DELETE };
