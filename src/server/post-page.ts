import "server-only";
import { cache } from "react";
import { getDatabase } from "../db/client";
import type { CommunitySnapshot } from "../domain/community";
import { postShareOrigin } from "../domain/post-sharing";
import { uuidSchema } from "../domain/validation";
import { authConfiguration } from "./auth-config";
import { communityService } from "./community-service";
import { AppError } from "./errors";
import { currentActor } from "./identity";
import { readPublicPostShare } from "./post-sharing-reader";

export function sharingOrigin() {
  return postShareOrigin(
    process.env.APP_ORIGIN,
    process.env.NODE_ENV === "development" || process.env.LOCAL_DATABASE === "1",
  );
}

export const getPublicPostShare = cache(async (postId: string) =>
  readPublicPostShare(getDatabase(), postId),
);

export const getPostPage = cache(async (postId: string) => {
  const parsed = uuidSchema.safeParse(postId);
  if (!parsed.success) throw new AppError("NOT_FOUND", "게시글을 찾을 수 없어요.");
  const actor = await currentActor();
  const service = communityService(getDatabase());
  const detail = await service.detail(parsed.data, actor);
  const inbox = await service.inbox(actor);
  const initialState: CommunitySnapshot = {
    posts: [detail.post],
    featured: [],
    hot: [],
    nextCursor: null,
    notifications: inbox.items,
    notificationNextCursor: inbox.nextCursor,
    unreadCount: inbox.unreadCount,
    canWrite: !!actor,
    mode: actor ? (authConfiguration() ? "authenticated" : "development") : "readonly",
  };
  return { initialDetail: detail, initialState };
});
