import Link from "next/link";
import type { CommunityPost } from "@/domain/community";

export function PostAuthorName({
  post,
}: {
  post: Pick<CommunityPost, "author" | "authorPublicId" | "anonymous">;
}) {
  if (post.anonymous) return <>익명</>;
  if (!post.authorPublicId) return <>{post.author}</>;
  return (
    <Link className="post-author-profile" href={`/players/${post.authorPublicId}`} prefetch={false}>
      {post.author}
    </Link>
  );
}
