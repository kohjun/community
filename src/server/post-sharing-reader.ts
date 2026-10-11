import { and, eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import { posts } from "../db/schema";
import { publicPostShare } from "../domain/post-sharing";
import { uuidSchema } from "../domain/validation";
import { AppError } from "./errors";
import { contentVisible } from "./safety-visibility";

export async function readPublicPostShare(db: Database, id: string) {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) throw new AppError("NOT_FOUND", "게시글을 찾을 수 없어요.");
  const [row] = await db
    .select({
      id: posts.id,
      title: posts.title,
      spoiler: posts.spoiler,
      spoilerTitle: posts.spoilerTitle,
      categorySlug: posts.categorySlug,
      kind: posts.kind,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(
      and(
        eq(posts.id, parsed.data),
        eq(posts.status, "published"),
        contentVisible("post", posts.id),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "게시글이 없거나 삭제되었어요.");
  return publicPostShare(row);
}
