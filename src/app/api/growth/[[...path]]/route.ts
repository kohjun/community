import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { AppError } from "@/server/errors";
import { savedSearchService } from "@/server/saved-search-service";
import { waitlistService } from "@/server/waitlist-service";
import { communityGrowthService } from "@/server/community-growth-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const { path = [] } = await context.params,
      m = request.method === "HEAD" ? "GET" : request.method;
    if (m !== "GET") assertSameOrigin(request);
    const actor = await currentActor(),
      db = getDatabase(),
      saved = savedSearchService(db),
      growth = communityGrowthService(db),
      q = new URL(request.url).searchParams;
    if (path[0] === "saved" && path.length === 3 && path[1] && path[2] === "matches" && m === "GET")
      return saved.matches(actor, path[1], Number(q.get("page") ?? 1));
    if (path[0] === "saved" && path.length <= 2) {
      if (m === "GET" && path.length === 1) return saved.list(actor);
      if (m === "POST" && path.length === 1) return saved.save(actor, await readJson(request));
      if (m === "PUT" && path[1]) return saved.save(actor, await readJson(request), path[1]);
      if (m === "DELETE" && path[1]) return saved.remove(actor, path[1]);
    }
    if (path[0] === "waitlist" && path.length === 2 && path[1]) {
      if (m === "GET") return waitlistService(db).view(actor, path[1]);
      if (m === "PUT") return waitlistService(db).update(actor, path[1], await readJson(request));
    }
    if (path[0] === "ideas") {
      if (path.length === 1 && m === "GET")
        return growth.ideas(actor, Number(q.get("page") ?? 1), q.get("region") ?? "");
      if (path.length === 1 && m === "POST")
        return growth.createIdea(actor, await readJson(request));
      if (path.length === 3 && path[1] && m === "PUT") {
        if (path[2] === "interest") return growth.interest(actor, path[1], await readJson(request));
        if (path[2] === "closed") return growth.closeIdea(actor, path[1], await readJson(request));
        if (path[2] === "events") return growth.linkEvent(actor, path[1], await readJson(request));
      }
    }
    if (path[0] === "reunion" && path.length === 2 && path[1]) {
      if (m === "GET") return growth.reunionView(actor, path[1], Number(q.get("page") ?? 1));
      if (m === "PUT") return growth.saveReflection(actor, path[1], await readJson(request));
      if (m === "DELETE") return growth.deleteReflection(actor, path[1]);
    }
    throw new AppError("NOT_FOUND", "요청을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as DELETE };
