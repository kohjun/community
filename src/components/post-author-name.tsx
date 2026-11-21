import Link from "next/link";
import type { ReactNode } from "react";
import type { CommunityPost } from "@/domain/community";
import type { PublicAuthor } from "@/domain/contracts";

function AuthorName({
  name,
  publicId,
  icon,
}: {
  name: string;
  publicId: string | undefined;
  icon?: ReactNode;
}) {
  const contents = (
    <>
      {icon}
      <span>{name}</span>
    </>
  );
  if (!publicId) return <span className="post-author-name">{contents}</span>;
  return (
    <Link
      className="post-author-name post-author-profile"
      href={`/players/${publicId}`}
      prefetch={false}
    >
      {contents}
      <span className="sr-only"> 프로필 보기</span>
    </Link>
  );
}

export function PostAuthorName({
  post,
  icon,
}: {
  post: Pick<CommunityPost, "author" | "authorPublicId" | "anonymous">;
  icon?: ReactNode;
}) {
  return (
    <AuthorName
      name={post.anonymous ? "익명" : post.author}
      publicId={post.anonymous ? undefined : post.authorPublicId}
      icon={icon}
    />
  );
}

export function EventAuthorName({ author, icon }: { author: PublicAuthor; icon?: ReactNode }) {
  return (
    <AuthorName
      name={author.displayName}
      publicId={author.kind === "member" ? author.publicProfileId : undefined}
      icon={icon}
    />
  );
}
