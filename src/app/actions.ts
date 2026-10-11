"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import type { ActionResult } from "@/domain/contracts";
import type { CommunityPost } from "@/domain/community";
import { communityService } from "@/server/community-service";
import { currentActor } from "@/server/identity";
import { apiResponse, assertSameOrigin } from "@/server/http";

async function action<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  const response = await apiResponse(async () => {
    assertSameOrigin(
      new Request(process.env.APP_ORIGIN || "http://127.0.0.1:3000", { headers: await headers() }),
    );
    return work();
  });
  return response.json() as Promise<ActionResult<T>>;
}
export async function createPostAction(input: unknown): Promise<ActionResult<CommunityPost>> {
  return action(async () =>
    communityService(getDatabase()).createPost(await currentActor(), input),
  );
}
export async function updatePostAction(
  id: string,
  input: unknown,
): Promise<ActionResult<CommunityPost>> {
  return action(async () =>
    communityService(getDatabase()).updatePost(await currentActor(), {
      ...z.record(z.string(), z.unknown()).parse(input),
      postId: id,
    }),
  );
}
export async function deletePostAction(id: string): Promise<ActionResult<{ id: string }>> {
  return action(async () => communityService(getDatabase()).deletePost(await currentActor(), id));
}
