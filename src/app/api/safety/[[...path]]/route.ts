import { z } from "zod";
import { getDatabase } from "@/db/client";
import { safetyService } from "@/server/safety-service";
import { authenticatedActor, currentActor } from "@/server/identity";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { AppError } from "@/server/errors";
import { removeFile } from "@/server/profile-photos";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const parts = (await context.params).path ?? [],
      [resource, id, operation] = parts;
    const service = safetyService(getDatabase()),
      method = request.method,
      raw = await authenticatedActor();
    if (method !== "GET") assertSameOrigin(request);
    const actor = await currentActor();
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(new URL(request.url).searchParams.get("page") ?? 1);
    if (resource === "account" && parts.length === 1) {
      if (method === "GET") return service.account(raw);
      if (method === "DELETE") {
        z.strictObject({ confirm: z.literal("탈퇴") }).parse(await readJson(request));
        const result = await service.withdraw(actor);
        await removeFile(result.photoObjectKey, result.photoStorageBackend ?? "local");
        return { withdrawn: result.withdrawn };
      }
    }
    if (resource === "reports" && parts.length === 1) {
      if (method === "GET") return service.reports(raw, false, page);
      if (method === "POST") return service.report(actor, await readJson(request));
    }
    if (resource === "blocks") {
      if (method === "GET" && parts.length === 1) return service.blocks(raw);
      if (method === "POST" && parts.length === 1)
        return service.block(actor, await readJson(request));
      if (method === "DELETE" && parts.length === 2 && id) return service.unblock(raw, id);
    }
    if (resource === "support" && parts.length === 1) {
      if (method === "GET") return service.tickets(raw, false, page);
      if (method === "POST") return service.createTicket(raw, await readJson(request));
    }
    if (resource === "admin") {
      if (method === "GET" && parts.length === 2) {
        if (id === "reports") return service.reports(actor, true, page);
        if (id === "support") return service.tickets(actor, true, page);
        if (id === "audit") return service.audit(actor, page);
      }
      if (method === "GET" && parts.length === 3 && operation) {
        if (id === "reports") return service.reportDetail(actor, operation);
        if (id === "support") return service.ticketDetail(actor, operation);
      }
      if (method === "POST" && parts.length === 3 && operation) {
        if (id === "reports") return service.resolve(actor, operation, await readJson(request));
        if (id === "support") return service.reply(actor, operation, await readJson(request));
        if (id === "reinstate") {
          const value = z.strictObject({ reason: z.string() }).parse(await readJson(request));
          return service.reinstate(actor, operation, value.reason);
        }
      }
    }
    throw new AppError("NOT_FOUND", "요청한 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as POST, handle as DELETE };
