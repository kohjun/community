import { z } from "zod";
import { getDatabase } from "@/db/client";
import { hashVisitor } from "@/domain/visitor";
import { uuidSchema } from "@/domain/validation";
import { communityService, feedQuerySchema } from "@/server/community-service";
import { currentActor } from "@/server/identity";
import { authConfiguration } from "@/server/auth-config";
import { apiResponse, assertSameOrigin, readJson } from "@/server/http";
import { AppError } from "@/server/errors";
import { visitorIdentity } from "@/server/visitor-cookie";
import { uploadImage } from "@/server/media";
import { uploadProfilePhoto, clearProfilePhoto } from "@/server/profile-photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };

async function handle(request: Request, context: Context) {
  return apiResponse(async () => {
    const parts = (await context.params).path ?? [];
    const [resource, id, operation] = parts;
    const method = request.method === "HEAD" ? "GET" : request.method,
      actor = await currentActor(),
      service = communityService(getDatabase());
    if (method !== "GET") assertSameOrigin(request);
    if (method === "GET" && resource === "highlights" && parts.length === 1)
      return service.highlights(actor);
    if (method === "GET" && !parts.length) {
      const query = feedQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      const [feed, notifications] = await Promise.all([
        service.feed(actor, query),
        service.inbox(actor),
      ]);
      return {
        ...feed,
        notifications: notifications.items,
        notificationNextCursor: notifications.nextCursor,
        unreadCount: notifications.unreadCount,
        canWrite: !!actor,
        mode: actor ? (authConfiguration() ? "authenticated" : "development") : "readonly",
      };
    }
    if (method === "GET" && resource === "posts" && id && parts.length === 2)
      return service.detail(id, actor);
    if (method === "GET" && resource === "notifications" && parts.length === 1)
      return service.inbox(actor, Object.fromEntries(new URL(request.url).searchParams));
    if (resource === "me" && parts.length === 1) {
      if (method === "GET") return service.me(actor);
      if (method === "PATCH") return service.updateProfile(actor, await readJson(request));
    }
    if (resource === "me" && id === "photo" && parts.length === 2) {
      if (method === "POST") {
        await uploadProfilePhoto(request, actor);
        return service.me(actor);
      }
      if (method === "DELETE") {
        await clearProfilePhoto(request, actor);
        return service.me(actor);
      }
    }
    if (resource === "me" && id === "onboarding" && parts.length === 2 && method === "POST")
      return service.completeOnboarding(actor, await readJson(request));
    if (resource === "me" && id === "visit" && parts.length === 2 && method === "POST") {
      z.strictObject({}).parse(await readJson(request));
      return service.visit(actor);
    }
    if (
      method === "GET" &&
      resource === "posts" &&
      id &&
      operation === "comments" &&
      parts.length === 3
    )
      return service.commentPage(id, actor, Object.fromEntries(new URL(request.url).searchParams));
    if (method === "POST" && resource === "posts" && parts.length === 1)
      return service.createPost(actor, await readJson(request, 350_000));
    if (resource === "posts" && id && parts.length === 2) {
      if (method === "PATCH")
        return service.updatePost(actor, {
          ...z.record(z.string(), z.unknown()).parse(await readJson(request, 350_000)),
          postId: uuidSchema.parse(id),
        });
      if (method === "DELETE") return service.deletePost(actor, id);
    }
    if (resource === "posts" && id && parts.length === 3 && method === "POST") {
      if (operation === "resolve")
        return service.resolveQuestion(actor, id, await readJson(request));
      if (operation === "vote") return service.vote(actor, id, await readJson(request));
      if (operation === "view") {
        const visitor = await visitorIdentity();
        return service.recordView(id, hashVisitor(visitor.id, id, visitor.secret), actor);
      }
      if (operation === "like" || operation === "bookmark") {
        const value = z.strictObject({ active: z.boolean() }).parse(await readJson(request));
        return service.react(actor, id, operation, value.active);
      }
    }
    if (method === "POST" && resource === "comments" && parts.length === 1)
      return service.createComment(actor, await readJson(request));
    if (resource === "comments" && id && parts.length === 2) {
      if (method === "PATCH")
        return service.changeComment(actor, {
          ...z.record(z.string(), z.unknown()).parse(await readJson(request)),
          commentId: uuidSchema.parse(id),
        });
      if (method === "DELETE") return service.changeComment(actor, id, true);
    }
    if (method === "POST" && resource === "notifications" && id === "read" && parts.length === 2) {
      const value = z.strictObject({ id: uuidSchema.optional() }).parse(await readJson(request));
      return service.markRead(actor, value.id);
    }
    if (method === "POST" && resource === "uploads" && parts.length === 1)
      return uploadImage(request, actor);
    throw new AppError("NOT_FOUND", "요청한 경로를 찾을 수 없어요.");
  });
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
