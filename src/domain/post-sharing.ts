import { safePostTitle, type SpoilerSource } from "./discussions";
import { CATEGORIES, type CategorySlug } from "./categories";
import { safeExternalLink } from "./post-document";

const postIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function postPath(id: string): string {
  if (!postIdPattern.test(id)) throw new Error("Invalid post ID");
  return `/posts/${id.toLowerCase()}`;
}

export function postShareOrigin(value: string | undefined, allowLocal = false): URL | null {
  const configured = value ?? (allowLocal ? "http://127.0.0.1:3000" : undefined);
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      return null;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (local && allowLocal && ["http:", "https:"].includes(parsed.protocol)) {
      return new URL(parsed.origin);
    }
    if (parsed.protocol !== "https:" || !safeExternalLink(parsed.href)) return null;
    return new URL(parsed.origin);
  } catch {
    return null;
  }
}

/** Unsupported glyphs become local placeholders instead of external font/emoji requests. */
export function ogTitleText(title: string, coverage: ReadonlySet<number>): string {
  return Array.from(new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(title))
    .map(({ segment }) =>
      Array.from(segment).every((char) => coverage.has(char.codePointAt(0)!)) ? segment : "□",
    )
    .join("");
}

export interface PublicPostShareSource extends SpoilerSource {
  id: string;
  title: string;
  categorySlug: CategorySlug;
  kind: "모집" | "후기" | "이야기" | "투표";
  createdAt: Date;
}

export interface PublicPostShare {
  path: string;
  title: string;
  description: string;
  category: string;
  kind: PublicPostShareSource["kind"];
  publishedAt: string;
}

// Sharing never includes the body, contact field, author identity, or attached images.
export function publicPostShare(source: PublicPostShareSource): PublicPostShare {
  const title = safePostTitle(source)
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/https?:\/\/\S+/gi, "[링크]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일]")
    .replace(/(?:\+82[\s-]?)?0?1[016789][\s.-]?\d{3,4}[\s.-]?\d{4}/g, "[연락처]")
    .replace(/\s+/g, " ")
    .trim();
  const segments = Array.from(new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(title));
  const briefTitle =
    segments.length > 70
      ? segments
          .slice(0, 69)
          .map(({ segment }) => segment)
          .join("") + "…"
      : title;
  const category = CATEGORIES.find(({ slug }) => slug === source.categorySlug)?.name ?? "커뮤니티";
  return {
    path: postPath(source.id),
    title: briefTitle || "슬리퍼의 새로운 이야기",
    description: `${category} · ${source.kind} | 취향 맞는 사람들과 나누는 Sliper 커뮤니티. 글과 댓글을 확인해보세요.`,
    category,
    kind: source.kind,
    publishedAt: source.createdAt.toISOString(),
  };
}
