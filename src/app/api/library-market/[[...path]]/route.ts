import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { libraryMarketService } from "@/server/library-market-service";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const { path = [] } = await context.params,
      method = request.method === "HEAD" ? "GET" : request.method;
    if (method !== "GET") assertSameOrigin(request);
    const actor = await currentActor(),
      service = libraryMarketService(getDatabase());
    if (!path.length && method === "GET") {
      const input: Record<string, string> = {};
      for (const [key, value] of new URL(request.url).searchParams) {
        if (Object.hasOwn(input, key))
          throw new AppError("VALIDATION", "중복 검색 조건을 제거해주세요.");
        input[key] = value;
      }
      return service.list(actor, input);
    }
    const [id, action, disputeId, operation] = path;
    if (id && path.length === 1 && method === "GET") return service.detail(actor, id);
    if (id && path.length === 2 && method === "POST") {
      if (action === "decision") return service.decide(actor, id, await readJson(request));
      if (action === "disputes") return service.openDispute(actor, id, await readJson(request));
    }
    if (id && action === "disputes" && disputeId && path.length === 4 && method === "POST") {
      const body = await readJson(request);
      if (operation === "response") return service.respond(actor, id, disputeId, body);
      if (operation === "resolve") return service.resolve(actor, id, disputeId, body);
      if (operation === "withdraw") return service.withdraw(actor, id, disputeId, body);
    }
    throw new AppError("NOT_FOUND", "요청한 구매 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as POST };
