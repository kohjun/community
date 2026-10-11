import { librarySearchParams } from "@/domain/library";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { libraryCollaborationService } from "@/server/library-collaboration-service";
import { libraryService } from "@/server/library-service";
import { libraryMarketService } from "@/server/library-market-service";
import { libraryTestPurchaseService } from "@/server/library-test-purchase";
import { libraryEvidenceService } from "@/server/library-evidence-service";
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
      service = libraryService(getDatabase());
    if (!path.length && method === "GET") {
      return service.list(actor, librarySearchParams(new URL(request.url).searchParams));
    }
    if (path.length === 1 && path[0] === "drafts" && method === "POST")
      return service.createDraft(actor, await readJson(request));
    if (!path.length && method === "POST") return service.create(actor, await readJson(request));
    const [id, action] = path;
    if (id && path.length === 2 && action === "test-purchase" && method === "POST")
      return libraryTestPurchaseService(getDatabase()).purchase(actor, id, await readJson(request));
    if (id && path.length === 2 && action === "purchase" && method === "POST")
      return libraryMarketService(getDatabase()).request(actor, id, await readJson(request));
    if (id && path.length === 2 && action === "evidence" && method === "GET") {
      const input: Record<string, string> = Object.create(null);
      for (const [key, value] of new URL(request.url).searchParams) {
        if (Object.hasOwn(input, key))
          throw new AppError("VALIDATION", "중복 검색 조건을 제거해주세요.");
        input[key] = value;
      }
      return libraryEvidenceService(getDatabase()).list(actor, id, input);
    }
    const collaboration = libraryCollaborationService(getDatabase());
    if (id && path.length === 3 && action === "suggestions") {
      if (method === "GET") return collaboration.detail(actor, id, path[2]!);
      if (method === "POST")
        return collaboration.decide(actor, id, path[2]!, await readJson(request));
    }
    if (id && path.length === 2 && action === "collaboration") {
      if (method === "POST") return collaboration.propose(actor, id, await readJson(request));
      if (method === "GET") {
        const params = new URL(request.url).searchParams;
        for (const key of params.keys())
          if (params.getAll(key).length !== 1)
            throw new AppError("VALIDATION", "중복 검색 조건을 제거해주세요.");
        return collaboration.list(actor, id, Object.fromEntries(params));
      }
    }
    if (
      id &&
      path.length === 2 &&
      action === "discussions" &&
      (method === "POST" || method === "DELETE")
    )
      return collaboration.link(actor, id, await readJson(request), method === "DELETE");
    if (path.length === 1 && id) {
      if (method === "GET") return service.detail(actor, id);
      if (method === "PUT") return service.update(actor, id, await readJson(request));
      if (method === "DELETE") return service.remove(actor, id);
    }
    if (id && path.length === 3 && action === "versions" && path[2] && method === "GET")
      return service.version(actor, id, Number(path[2]));
    if (id && path.length === 2) {
      if (action === "draft" && method === "PUT")
        return service.saveDraft(actor, id, await readJson(request));
      if (action === "publish" && method === "POST")
        return service.publish(actor, id, await readJson(request));
      if (action === "derive" && method === "POST")
        return service.derive(actor, id, await readJson(request));
      if (action === "versions" && method === "GET")
        return service.versions(actor, id, {
          page: new URL(request.url).searchParams.get("page") ?? "1",
        });
      if (action === "access" && method === "POST")
        return service.requestAccess(actor, id, await readJson(request));
      if (action === "requests" && method === "GET")
        return service.accessRequests(
          actor,
          id,
          new URL(request.url).searchParams.get("cursor") ?? undefined,
        );
      if (action === "decision" && method === "POST")
        return service.decideAccess(actor, id, await readJson(request));
      if (action === "host" && method === "POST")
        return service.host(actor, id, await readJson(request));
      if (action === "event-template" && method === "GET") return service.eventTemplate(actor, id);
    }
    throw new AppError("NOT_FOUND", "요청한 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as DELETE };
