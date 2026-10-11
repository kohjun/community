import type { CommunityPost } from "./community";
export const DISCUSSION_TYPES = ["free", "question", "tip", "analysis"] as const;
export type DiscussionType = (typeof DISCUSSION_TYPES)[number];
export const DISCUSSION_LABELS: Record<DiscussionType, string> = {
  free: "자유 이야기",
  question: "질문",
  tip: "운영 팁",
  analysis: "콘텐츠 분석",
};
export interface SpoilerSource {
  title: string;
  spoiler?: boolean;
  spoilerTitle?: string | null;
  spoilerSummary?: string | null;
}
export function safePostTitle(post: SpoilerSource) {
  return post.spoiler ? post.spoilerTitle?.trim() || "스포일러가 포함된 이야기" : post.title;
}
export function safeSpoilerSummary(post: SpoilerSource) {
  return post.spoilerSummary?.trim() || "내용과 댓글에 스포일러가 있어요. 확인 후 펼쳐보세요.";
}
/** List/search/share surfaces must never reuse detail content after local mutations. */
export function previewPost(post: CommunityPost): CommunityPost {
  if (!post.spoiler) return post;
  const { image: _image, ...summary } = post;
  return {
    ...summary,
    title: safePostTitle(post),
    excerpt: safeSpoilerSummary(post),
    body: "",
    bodyDocument: null,
    images: [],
    videos: [],
    tags: [],
    poll: null,
  };
}
