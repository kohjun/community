import { getDatabase } from "@/db/client";
import { eventCreditService } from "@/server/event-credit-service";
import { currentActor } from "@/server/identity";
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
      service = eventCreditService(getDatabase());
    if (path.length === 1 && path[0] === "me" && method === "GET") return service.me(actor);
    if (path.length === 2 && path[0] === "events" && path[1]) {
      if (method === "GET") return service.event(actor, path[1]);
      if (method === "POST") return service.create(actor, path[1], await readJson(request));
    }
    if (path.length === 1 && path[0] && method === "PATCH")
      return service.update(actor, path[0], await readJson(request));
    if (path.length === 2 && path[0] && path[1] === "decision" && method === "POST")
      return service.decide(actor, path[0], await readJson(request));
    throw new AppError("NOT_FOUND", "기여 내역 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as POST, handle as PATCH };
