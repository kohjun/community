import { z } from "zod";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { crewService } from "@/server/crew-service";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const { path = [] } = await context.params,
      method = request.method === "HEAD" ? "GET" : request.method;
    if (method !== "GET") assertSameOrigin(request);
    const actor = await currentActor(),
      service = crewService(getDatabase());
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const [id, action, subaction] = path;
    if (!path.length && method === "GET") return service.list(actor, query);
    if (!path.length && method === "POST") return service.create(actor, await readJson(request));
    if (id && path.length === 1) {
      if (method === "GET") return service.detail(actor, id);
      if (method === "PATCH") return service.update(actor, id, await readJson(request));
    }
    if (id && path.length === 2 && method === "GET") {
      if (action === "activity") return service.activity(actor, id, query);
      if (action === "requests") return service.requests(actor, id, query);
      if (action === "contributions") return service.contributions(actor, id, query);
    }
    if (
      id &&
      action === "events" &&
      subaction === "available" &&
      path.length === 3 &&
      method === "GET"
    )
      return service.availableEvents(actor, id);
    if (id && action === "events" && subaction && path.length === 3 && method === "DELETE")
      return service.unlinkEvent(actor, id, subaction);
    if (id && path.length === 2 && method === "POST") {
      if (action === "join") return service.join(actor, id, await readJson(request));
      if (action === "announcements") return service.announce(actor, id, await readJson(request));
      if (action === "events") return service.linkEvent(actor, id, await readJson(request));
      if (action === "contributions")
        return service.verifyContribution(actor, id, await readJson(request));
      if (action === "transfer") return service.transfer(actor, id, await readJson(request));
      if (["withdraw", "leave", "archive"].includes(action ?? "")) {
        z.strictObject({}).parse(await readJson(request));
        if (action === "withdraw") return service.withdrawRequest(actor, id);
        if (action === "leave") return service.leave(actor, id);
        return service.archive(actor, id);
      }
    }
    if (id && path.length === 3 && method === "POST") {
      if (action === "requests" && subaction === "decision")
        return service.decide(actor, id, await readJson(request));
      if (action === "members" && subaction === "role")
        return service.setRole(actor, id, await readJson(request));
      if (action === "members" && subaction === "remove")
        return service.removeMember(actor, id, await readJson(request));
    }
    throw new AppError("NOT_FOUND", "크루 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as POST, handle as PATCH, handle as DELETE };
