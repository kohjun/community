import { previewPost } from "../domain/discussions";
import type {
  CommunityComment,
  CommentMutation,
  CommunityDetail,
  ReadReceipt,
  CommunityPost,
  FeedQuery,
} from "../domain/community";
import type { NotificationItem } from "../domain/contracts";
import { kilometersBetween } from "../domain/location";

export function mergeById<T extends { id: string }>(previous: T[], incoming: T[]) {
  return [...new Map([...previous, ...incoming].map((item) => [item.id, item])).values()];
}
export function mergeComments(previous: CommunityComment[], incoming: CommunityComment[]) {
  return mergeById(previous, incoming).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
export function applyCommentMutation(current: CommunityDetail | null, result: CommentMutation) {
  if (!current || current.post.id !== result.post.id) return current;
  return {
    ...current,
    post: result.post,
    comments: mergeComments(current.comments, [
      result.comment,
      ...(result.parent ? [result.parent] : []),
    ]),
  };
}
export function applyReadReceipt(items: NotificationItem[], receipt: ReadReceipt) {
  // The server's read operation affects only notifications existing before readAt.
  return items.map((item) =>
    (!receipt.id || receipt.id === item.id) &&
    !item.readAt &&
    item.createdAt.replace(/\.(\d{3})Z$/, (_, ms: string) => `.${ms}000Z`) <= receipt.readAt
      ? { ...item, readAt: receipt.readAt }
      : item,
  );
}

export interface PostChange {
  version: number;
  post: CommunityPost | null;
}
// Refresh queries can originate from URLSearchParams; accept only explicit true.
const queryTrue = (value: unknown) => value === true || value === "true";
function withQueryDistance(post: CommunityPost, query: FeedQuery) {
  if (query.latitude === undefined || query.longitude === undefined) return post;
  const distanceKm =
    post.venueLatitude === undefined ||
    post.venueLatitude === null ||
    post.venueLongitude === undefined ||
    post.venueLongitude === null
      ? null
      : kilometersBetween(
          Number(query.latitude),
          Number(query.longitude),
          post.venueLatitude,
          post.venueLongitude,
        );
  return { ...post, distanceKm };
}
export function matchesPostQuery(post: CommunityPost, query: FeedQuery) {
  const eventSearch =
    queryTrue(query.eventOnly) ||
    query.meetupType !== undefined ||
    query.activityCategory !== undefined ||
    query.latitude !== undefined ||
    query.fromDate !== undefined ||
    query.toDate !== undefined ||
    query.minPriceKRW !== undefined ||
    query.maxPriceKRW !== undefined ||
    queryTrue(query.availableOnly);
  if (eventSearch && post.kind !== "모집") return false;
  if (query.meetupType && (post.meetupType ?? "event") !== query.meetupType) return false;
  if (
    query.activityCategory &&
    (query.meetupType !== "lightning" ||
      post.meetupType !== "lightning" ||
      (post.activityCategory ?? "other") !== query.activityCategory)
  )
    return false;
  if (query.latitude !== undefined && query.longitude !== undefined) {
    const distance = withQueryDistance(post, query).distanceKm;
    if (distance === undefined || distance === null || !Number.isFinite(distance)) return false;
    if (query.radiusKm !== undefined && distance > Number(query.radiusKm)) return false;
  }
  if (
    query.minPriceKRW !== undefined &&
    (post.eventAmountKRW === undefined ||
      post.eventAmountKRW === null ||
      post.eventAmountKRW < Number(query.minPriceKRW))
  )
    return false;
  if (
    query.maxPriceKRW !== undefined &&
    (post.eventAmountKRW === undefined ||
      post.eventAmountKRW === null ||
      post.eventAmountKRW > Number(query.maxPriceKRW))
  )
    return false;
  if (query.fromDate || query.toDate) {
    const at = post.eventStartsAt ? Date.parse(post.eventStartsAt) : NaN;
    if (!Number.isFinite(at)) return false;
    const date = new Date(at + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (query.fromDate && date < query.fromDate) return false;
    if (query.toDate && date > query.toDate) return false;
  }
  if (queryTrue(query.availableOnly) && !post.eventAvailable) return false;
  if (query.category && post.category !== query.category) return false;
  if (query.kind && post.kind !== query.kind && !(query.kind === "이야기" && post.kind === "후기"))
    return false;
  if (
    query.discussionType &&
    (post.kind !== "이야기" || (post.discussionType ?? "free") !== query.discussionType)
  )
    return false;
  if (query.focus === "unanswered" && (post.discussionType !== "question" || post.acceptedAnswerId))
    return false;
  if (query.topic && post.topic !== query.topic) return false;
  if (query.tag && !post.tags.includes(query.tag)) return false;
  if (query.view === "mine" && !post.isMine) return false;
  if (query.view === "bookmarks" && !post.isBookmarked) return false;
  if (
    query.search &&
    ![
      previewPost(post).title,
      post.spoiler ? (post.spoilerSummary ?? "") : post.body,
      ...(query.meetupType === "lightning" ? post.tags : []),
    ]
      .join("\n")
      .toLocaleLowerCase()
      .includes(query.search.trim().toLocaleLowerCase())
  )
    return false;
  return true;
}
// Apply only writes newer than a page request. Null entries are deletion tombstones.
export function reconcilePosts(
  items: CommunityPost[],
  changes: ReadonlyMap<string, PostChange>,
  query?: FeedQuery,
) {
  const result = items.flatMap((item) => {
    const changed = changes.has(item.id) ? changes.get(item.id)!.post : item;
    const post = changed && query ? withQueryDistance(changed, query) : changed;
    return post && (!query || matchesPostQuery(post, query)) ? [previewPost(post)] : [];
  });
  return query?.sort === "nearest"
    ? result.sort(
        (a, b) =>
          (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id),
      )
    : result;
}

export interface CommentChange {
  version: number;
  comment: CommunityComment;
}
// A detail request can finish after a local reaction or comment write.
export function reconcileDetail(
  incoming: CommunityDetail,
  posts: ReadonlyMap<string, PostChange>,
  comments: ReadonlyMap<string, CommentChange>,
): CommunityDetail | null {
  const post = posts.has(incoming.post.id) ? posts.get(incoming.post.id)!.post : incoming.post;
  if (!post) return null;
  const changed = [...comments.values()]
    .map((change) => change.comment)
    .filter((comment) => comment.postId === post.id);
  return { ...incoming, post, comments: mergeComments(incoming.comments, changed) };
}
