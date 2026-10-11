import { getDatabase } from "@/db/client";
import { playerService } from "@/server/player-service";
import { portfolioService } from "@/server/portfolio-service";
import { currentActor } from "@/server/identity";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const { path = [] } = await context.params,
      method = request.method === "HEAD" ? "GET" : request.method;
    const actor = await currentActor(),
      service = playerService(getDatabase());
    if (method !== "GET") assertSameOrigin(request);
    if (!path.length && method === "GET") {
      const search = new URL(request.url).searchParams;
      return service.directory(
        actor,
        Object.fromEntries(
          ["role", "region", "cursor"].flatMap((key) =>
            search.has(key) ? [[key, search.get(key)]] : [],
          ),
        ),
      );
    }
    if (path.length === 2 && path[1] === "portfolio" && path[0]) {
      const portfolio = portfolioService(getDatabase());
      if (method === "GET") {
        const query = Object.fromEntries(new URL(request.url).searchParams);
        return path[0] === "me"
          ? portfolio.self(actor, query)
          : portfolio.view(actor, path[0], query);
      }
      if (method === "PUT" && path[0] === "me")
        return portfolio.updatePreference(actor, await readJson(request));
    }
    if (path.length === 1 && path[0] === "me") {
      if (method === "GET") return service.self(actor);
      if (method === "PUT") return service.updatePreference(actor, await readJson(request));
    }
    if (path.length === 1 && path[0] && method === "GET") return service.profile(actor, path[0]);
    if (path.length === 3 && path[0] === "events" && path[1]) {
      if (path[2] === "records") {
        if (method === "GET") return service.recordRoster(actor, path[1]);
        if (method === "PUT") return service.recordResult(actor, path[1], await readJson(request));
      }
      if (path[2] === "manner") {
        if (method === "GET") return service.reviewable(actor, path[1]);
        if (method === "POST") return service.reviewManner(actor, path[1], await readJson(request));
      }
    }
    throw new AppError("NOT_FOUND", "플레이어 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as PUT, handle as POST };
