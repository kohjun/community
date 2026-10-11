import type { CommunityDetail, CommunityPost } from "../domain/community";
import { communityRequest } from "./api-client";
import { markPostRead, normalizeReadPostId } from "./read-posts";
export function readPostContent(id: string, signal?: AbortSignal) {
  return communityRequest<CommunityDetail>(`/posts/${id}`, "GET", undefined, signal);
}
// Counting a visit is best effort; its failure must not block reading content.
export async function recordPostVisit(id: string, signal?: AbortSignal) {
  try {
    return await communityRequest<CommunityPost>(`/posts/${id}/view`, "POST", {}, signal);
  } catch {
    return null;
  }
}

// Ignore late responses when another post opened or the reading dialog closed.
export async function openPostContent(
  id: string,
  signal: AbortSignal,
  {
    isCurrent,
    reconcile,
    display,
  }: {
    isCurrent: () => boolean;
    reconcile: (detail: CommunityDetail) => CommunityDetail | null;
    display: (detail: CommunityDetail) => void;
  },
) {
  const canonicalId = normalizeReadPostId(id);
  if (!canonicalId || signal.aborted || !isCurrent()) return null;
  const result = await readPostContent(canonicalId, signal);
  if (signal.aborted || !isCurrent() || normalizeReadPostId(result?.post?.id) !== canonicalId)
    return null;
  const fresh = reconcile(result);
  if (
    !fresh ||
    signal.aborted ||
    !isCurrent() ||
    normalizeReadPostId(fresh.post?.id) !== canonicalId
  )
    return null;
  const canonicalDetail =
    fresh.post.id === canonicalId ? fresh : { ...fresh, post: { ...fresh.post, id: canonicalId } };
  display(canonicalDetail);
  markPostRead(canonicalId);
  return canonicalDetail;
}
