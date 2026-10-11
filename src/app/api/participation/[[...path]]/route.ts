import { z } from "zod";
import { getDatabase } from "@/db/client";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { currentActor } from "@/server/identity";
import { AppError, requireActor } from "@/server/errors";
import { eventLifecycleService } from "@/server/event-lifecycle-service";
import { eventOperationsService } from "@/server/event-operations-service";
import { paymentReconciliationService } from "@/server/payment-reconciliation-service";
import { refundService } from "@/server/refund-service";
import { participationService } from "@/server/participation-service";
import {
  createCheckout,
  paymentConfiguration,
  localPaymentTesting,
} from "@/server/payment-gateway";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  return apiResponse(async () => {
    const { path = [] } = await context.params,
      method = request.method === "HEAD" ? "GET" : request.method;
    const actor = await currentActor(),
      service = participationService(getDatabase()),
      cursor = new URL(request.url).searchParams.get("cursor");
    if (method !== "GET") assertSameOrigin(request);
    if (path.length === 1 && path[0] === "notices" && method === "GET")
      return eventLifecycleService(getDatabase()).notices(
        actor,
        z.coerce
          .number()
          .int()
          .min(1)
          .max(10000)
          .parse(new URL(request.url).searchParams.get("page") ?? 1),
      );
    if (path.length === 1 && path[0] === "me" && method === "GET")
      return service.home(actor, cursor);
    if (path.length === 1 && path[0] === "management" && method === "GET")
      return service.managedEvents(actor, cursor);
    const [resource, id, action] = path;
    if (
      resource === "refunds" &&
      id &&
      action === "resolve" &&
      path.length === 3 &&
      method === "PUT"
    )
      return refundService(getDatabase()).resolve(actor, id, await readJson(request));
    if (
      resource === "applications" &&
      id &&
      action === "decision" &&
      path.length === 3 &&
      method === "POST"
    )
      return service.decideExternal(actor, id, await readJson(request));
    if (resource === "events" && id && path.length === 2 && method === "GET")
      return service.overview(actor, id);
    if (resource === "events" && id && path.length === 3) {
      const lifecycle = eventLifecycleService(getDatabase());
      if (action === "lifecycle" && method === "GET")
        return lifecycle.overview(
          actor,
          id,
          z.coerce
            .number()
            .int()
            .min(1)
            .max(10000)
            .parse(new URL(request.url).searchParams.get("page") ?? 1),
        );
      if (action === "lifecycle" && method === "POST")
        return lifecycle.change(actor, id, await readJson(request));
      if (action === "notice-read" && method === "POST")
        return lifecycle.markRead(actor, id, await readJson(request));
      const operations = eventOperationsService(getDatabase());
      if (action === "finalize" && method === "POST") {
        z.strictObject({}).parse(await readJson(request));
        return operations.finalize(actor, id);
      }
      if (action === "ticket" && method === "POST")
        return operations.issue(actor, id, await readJson(request));
      if (action === "check-in-preview" && method === "POST")
        return operations.scan(actor, id, await readJson(request));
      if (action === "check-in" && method === "POST")
        return operations.scan(actor, id, await readJson(request), true);
      if (action === "check-ins" && method === "GET")
        return operations.roster(actor, id, Object.fromEntries(new URL(request.url).searchParams));
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(new URL(request.url).searchParams.get("page") ?? 1);
      if (action === "reviews" && method === "GET") return operations.reviews(actor, id, page);
      if (action === "reviews" && method === "POST")
        return operations.writeReview(actor, id, await readJson(request));
      if (action === "payment-review" && method === "GET")
        return paymentReconciliationService(getDatabase()).overview(actor, id, page);
      if (action === "payment-review" && method === "POST")
        return paymentReconciliationService(getDatabase()).note(actor, id, await readJson(request));
      if (action === "refunds" && method === "GET")
        return refundService(getDatabase()).overview(
          actor,
          id,
          new URL(request.url).searchParams.get("manage") === "1",
          cursor,
        );
      if (action === "refunds" && method === "POST")
        return refundService(getDatabase()).request(actor, id, await readJson(request));
      if (action === "external-confirmation" && method === "POST")
        return service.claimExternal(actor, id, await readJson(request));
      if (action === "dashboard" && method === "GET") {
        const query = new URL(request.url).searchParams;
        return service.dashboard(actor, id, {
          ...(cursor ? { cursor } : {}),
          ...(query.has("status") ? { status: query.get("status") } : {}),
          ...(query.has("search") ? { search: query.get("search") } : {}),
        });
      }
      if (action === "settings" && method === "PUT")
        return service.configure(actor, id, await readJson(request));
      if (action === "applications" && method === "POST") {
        const user = requireActor(actor),
          config = paymentConfiguration();
        return service.apply(
          user,
          id,
          await readJson(request),
          config?.provider || (localPaymentTesting(actor) ? "local-test" : null),
        );
      }
      if (action === "attendees" && method === "GET") return service.attendees(actor, id, cursor);
      if (action === "managers" && method === "GET") return service.managers(actor, id);
      if (action === "managers" && method === "PUT")
        return service.setManager(actor, id, await readJson(request));
    }
    if (resource === "applications" && id && path.length === 2 && method === "DELETE")
      return service.cancel(actor, id);
    if (resource === "orders" && id && path.length === 3 && method === "POST") {
      requireActor(actor);
      const order = await service.checkoutOrder(actor, id);
      if (action === "checkout") {
        const url = await createCheckout(order);
        return service.saveCheckout(actor, id, url);
      }
      if (action === "simulate") {
        // currentActor itself verifies dev mode, local DB, port and loopback host.
        // Keep an independent production guard when replacing identity with OAuth.
        if (!localPaymentTesting(actor) || order.provider !== "local-test")
          throw new AppError("FORBIDDEN", "로컬 테스트 환경에서만 사용할 수 있어요.");
        const value = z
          .object({ status: z.enum(["paid", "refunded"]) })
          .strict()
          .parse(await readJson(request));
        if (value.status !== "paid")
          throw new AppError("VALIDATION", "이 화면에서는 테스트 결제 확인만 가능해요.");
        return service.payment("local-test", {
          eventId: `local-paid-${order.id}`,
          orderId: order.id,
          paymentId: `local-${order.id}`,
          amountKRW: order.amountKRW,
          currency: "KRW",
          status: "paid",
        });
      }
    }
    if (
      resource === "rooms" &&
      id &&
      action === "members" &&
      path.length === 3 &&
      method === "GET"
    ) {
      const query = new URL(request.url).searchParams;
      return service.members(actor, id, {
        limit: query.get("limit") ?? 50,
        ...(cursor ? { cursor } : {}),
      });
    }
    if (resource === "rooms" && id && path.length === 2 && method === "GET")
      return service.room(actor, id, cursor);
    if (
      resource === "rooms" &&
      id &&
      action === "messages" &&
      path.length === 3 &&
      method === "POST"
    )
      return service.send(actor, id, await readJson(request));
    throw new AppError("NOT_FOUND", "요청한 기능을 찾을 수 없어요.");
  });
}
export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as DELETE };
