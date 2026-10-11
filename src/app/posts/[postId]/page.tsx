import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostDetailPage } from "@/components/post-detail-page";
import { AppError } from "@/server/errors";
import { getPostPage, getPublicPostShare, sharingOrigin } from "@/server/post-page";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ postId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { postId } = await params;
  try {
    // A blocked author must not leak through this viewer's page metadata.
    await getPostPage(postId);
    const post = await getPublicPostShare(postId);
    const origin = sharingOrigin();
    const canonical = origin ? new URL(post.path, origin).href : undefined;
    const image = origin ? new URL(post.path + "/opengraph-image", origin).href : undefined;
    return {
      title: `${post.title} — Sliper`,
      description: post.description,
      ...(origin ? { metadataBase: origin } : {}),
      ...(canonical ? { alternates: { canonical } } : {}),
      robots: { index: false, follow: false },
      openGraph: {
        title: post.title,
        description: post.description,
        type: "article",
        siteName: "Sliper",
        locale: "ko_KR",
        publishedTime: post.publishedAt,
        ...(canonical ? { url: canonical } : {}),
        ...(image
          ? { images: [{ url: image, width: 1200, height: 630, alt: "Sliper 게시글 공유 이미지" }] }
          : {}),
      },
      twitter: {
        card: "summary_large_image",
        title: post.title,
        description: post.description,
        ...(image ? { images: [image] } : {}),
      },
    };
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export default async function Page({ params }: Props) {
  const { postId } = await params;
  try {
    const data = await getPostPage(postId);
    return <PostDetailPage key={data.initialDetail.post.id} {...data} />;
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
