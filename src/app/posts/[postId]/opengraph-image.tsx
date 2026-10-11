import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@/server/errors";
import { getPublicPostShare } from "@/server/post-page";
import { renderPostShareImage } from "@/server/post-share-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Sliper 게시글 공유 이미지";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Local assets prevent title text from reaching an external font/emoji service.
const fontData = readFile(join(process.cwd(), "public/fonts/SliperShareSans-SemiBold.ttf"));
const logoData = readFile(join(process.cwd(), "public/images/sliper-icon-192.png"));
const fontCoverage = readFile(
  join(process.cwd(), "public/fonts/SliperShareSans-coverage.json"),
  "utf8",
).then((data) => new Set<number>(JSON.parse(data) as number[]));

export default async function Image({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  try {
    const post = await getPublicPostShare(postId);
    const [font, logo, coverage] = await Promise.all([fontData, logoData, fontCoverage]);
    return renderPostShareImage(post, { font, logo, coverage });
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
      });
    }
    throw error;
  }
}
