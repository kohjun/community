import { z } from "zod";

export type PostDocumentMark =
  | { type: "bold" | "italic" | "strike" | "underline" | "code" }
  | { type: "link"; attrs: { href: string } };

export type PostDocumentNode =
  | { type: "text"; text: string; marks?: PostDocumentMark[] }
  | { type: "paragraph" | "bulletList" | "listItem" | "blockquote"; content?: PostDocumentNode[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: PostDocumentNode[] }
  | { type: "orderedList"; attrs?: { start: number }; content?: PostDocumentNode[] }
  | { type: "hardBreak" | "horizontalRule" }
  | { type: "image"; attrs: { assetId: string; alt: string } }
  | { type: "video"; attrs: { url: string } }
  | { type: "uploadedVideo"; attrs: { assetId: string } }
  | { type: "legacyMarkdown"; attrs: { markdown: string } };

export interface PostDocument {
  version: 1;
  type: "doc";
  content: PostDocumentNode[];
}
export interface VideoUrlInfo {
  provider: "youtube" | "vimeo" | "file";
  url: string;
  embedUrl?: string;
}

const BYTE_LIMIT = 200 * 1024;
const TEXT_LIMIT = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEAF_TYPES = new Set(["text", "hardBreak"]);
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "horizontalRule",
  "image",
  "video",
  "uploadedVideo",
  "legacyMarkdown",
]);

function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    (!host.includes(".") && !host.startsWith("[")) ||
    host === "localhost" ||
    /\.(localhost|local|internal|lan)$/.test(host)
  )
    return true;
  if (host.startsWith("[")) {
    const address = host.slice(1, -1);
    return (
      address === "::" ||
      address === "::1" ||
      /^(fc|fd|fe[89ab])/i.test(address) ||
      address.startsWith("::ffff:") ||
      address.startsWith("::")
    );
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a! >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return false;
}

/** User supplied links are navigated/rendered only; the server never fetches them. */
export function safeExternalLink(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const source = value.trim();
  if (!source || source.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(source)) return null;
  try {
    const url = new URL(source);
    if (
      !/^https?:\/\//i.test(source) ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      privateHost(url.hostname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function startSeconds(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const count = Number(value);
    return count > 0 && count <= 604800 ? count : null;
  }
  const match = /^((\d+)h)?((\d+)m)?((\d+)s)?$/.exec(value);
  if (!match) return null;
  const count = Number(match[2] ?? 0) * 3600 + Number(match[4] ?? 0) * 60 + Number(match[6] ?? 0);
  return count > 0 && count <= 604800 ? count : null;
}

/** Only allowlisted providers receive an iframe; other safe HTTPS URLs become links. */
export function parseVideoUrl(value: unknown): VideoUrlInfo | null {
  const safe = safeExternalLink(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.protocol !== "https:" || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtube-nocookie.com",
      "www.youtube-nocookie.com",
      "youtu.be",
      "www.youtu.be",
    ].includes(host)
  ) {
    const id =
      host === "youtu.be" || host === "www.youtu.be"
        ? parts.length === 1
          ? parts[0]
          : null
        : parts[0] === "watch" && parts.length === 1
          ? url.searchParams.get("v")
          : ["embed", "shorts", "live"].includes(parts[0] ?? "") && parts.length === 2
            ? parts[1]
            : null;
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
    const start = startSeconds(url.searchParams.get("start") ?? url.searchParams.get("t"));
    return {
      provider: "youtube",
      url: "https://www.youtube.com/watch?v=" + id + (start ? "&t=" + start : ""),
      embedUrl: "https://www.youtube-nocookie.com/embed/" + id + (start ? "?start=" + start : ""),
    };
  }
  if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
    const id =
      host === "player.vimeo.com"
        ? parts[0] === "video" && parts.length === 2
          ? parts[1]
          : null
        : parts.length >= 1 && parts.length <= 2
          ? parts[0]
          : null;
    const hash = host === "player.vimeo.com" ? url.searchParams.get("h") : parts[1];
    if (!id || !/^\d{1,12}$/.test(id) || (hash && !/^[a-zA-Z0-9]{6,64}$/.test(hash))) return null;
    return {
      provider: "vimeo",
      url: "https://vimeo.com/" + id + (hash ? "/" + hash : ""),
      embedUrl: "https://player.vimeo.com/video/" + id + (hash ? "?h=" + hash : ""),
    };
  }
  if (/\.(mp4|webm|ogg)$/i.test(url.pathname)) return { provider: "file", url: safe };
  return null;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("문서 형식이 올바르지 않아요.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !keys.includes(key)))
    throw new Error("허용되지 않은 문서 속성이 있어요.");
  return row;
}
function fail(message: string): never {
  throw new Error(message);
}

function validDocumentText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !/[\u0000]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)
  );
}

function normalizeDocument(value: unknown): PostDocument {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return fail("순환 참조가 있는 문서는 저장할 수 없어요.");
  }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > BYTE_LIMIT)
    return fail("문서는 200KB까지 저장할 수 있어요.");
  const root = record(value, ["version", "type", "content"]);
  if (
    root.version !== 1 ||
    root.type !== "doc" ||
    !Array.isArray(root.content) ||
    !root.content.length
  )
    return fail("문서 형식이 올바르지 않아요.");
  let count = 0,
    textLength = 0,
    imageCount = 0,
    videoCount = 0,
    uploadedVideoCount = 0,
    legacyCount = 0;
  const ids = new Set<string>();
  const videoIds = new Set<string>();
  function node(input: unknown, depth: number, parent: string): PostDocumentNode {
    if (++count > 500 || depth > 8) return fail("문서의 항목이나 중첩 단계가 너무 많아요.");
    const row = record(input, ["type", "text", "attrs", "content", "marks"]);
    const type = row.type;
    if (typeof type !== "string") return fail("문서 항목이 올바르지 않아요.");
    if (parent === "paragraph" || parent === "heading") {
      if (!LEAF_TYPES.has(type)) return fail("문단 안에는 텍스트와 줄바꿈만 넣을 수 있어요.");
    } else if (parent === "bulletList" || parent === "orderedList") {
      if (type !== "listItem") return fail("목록 형식이 올바르지 않아요.");
    } else if (!BLOCK_TYPES.has(type)) return fail("허용되지 않은 문서 항목이에요.");
    if (type === "text") {
      record(input, ["type", "text", "marks"]);
      if (!validDocumentText(row.text) || !row.text.length)
        return fail("텍스트가 올바르지 않아요.");
      textLength += row.text.length;
      if (textLength > TEXT_LIMIT) return fail("본문은 30,000자까지 입력할 수 있어요.");
      const output: Extract<PostDocumentNode, { type: "text" }> = { type, text: row.text };
      if (row.marks !== undefined) {
        if (!Array.isArray(row.marks) || row.marks.length > 6)
          return fail("텍스트 서식이 올바르지 않아요.");
        const used = new Set<string>();
        output.marks = row.marks.map((item) => {
          const mark = record(item, ["type", "attrs"]);
          if (typeof mark.type !== "string" || used.has(mark.type))
            return fail("중복되거나 잘못된 서식이에요.");
          used.add(mark.type);
          if (mark.type === "link") {
            const attrs = record(mark.attrs, ["href"]);
            const href = safeExternalLink(attrs.href);
            if (!href) return fail("http:// 또는 https://로 시작하는 안전한 링크를 입력해주세요.");
            return { type: "link", attrs: { href } };
          }
          record(item, ["type"]);
          if (!["bold", "italic", "strike", "underline", "code"].includes(mark.type))
            return fail("허용되지 않은 텍스트 서식이에요.");
          return { type: mark.type as "bold" | "italic" | "strike" | "underline" | "code" };
        });
      }
      return output;
    }
    if (type === "image") {
      record(input, ["type", "attrs"]);
      const attrs = record(row.attrs, ["assetId", "alt"]);
      if (
        typeof attrs.assetId !== "string" ||
        !UUID.test(attrs.assetId) ||
        (attrs.alt !== undefined && (!validDocumentText(attrs.alt) || attrs.alt.length > 300))
      )
        return fail("이미지 항목이 올바르지 않아요.");
      const assetId = attrs.assetId.toLowerCase();
      if (++imageCount > 10 || ids.has(assetId))
        return fail("이미지는 중복 없이 10장까지 넣을 수 있어요.");
      ids.add(assetId);
      return { type, attrs: { assetId, alt: typeof attrs.alt === "string" ? attrs.alt : "" } };
    }
    if (type === "uploadedVideo") {
      record(input, ["type", "attrs"]);
      const attrs = record(row.attrs, ["assetId"]);
      if (typeof attrs.assetId !== "string" || !UUID.test(attrs.assetId))
        return fail("업로드 영상 항목이 올바르지 않아요.");
      const assetId = attrs.assetId.toLowerCase();
      if (++uploadedVideoCount > 3 || videoIds.has(assetId))
        return fail("업로드 영상은 중복 없이 3개까지 넣을 수 있어요.");
      videoIds.add(assetId);
      return { type, attrs: { assetId } };
    }
    if (type === "legacyMarkdown") {
      record(input, ["type", "attrs"]);
      const attrs = record(row.attrs, ["markdown"]);
      if (!validDocumentText(attrs.markdown) || !attrs.markdown.trim() || ++legacyCount > 1)
        return fail("기존 Markdown 내용은 한 번만 넣을 수 있어요.");
      textLength += attrs.markdown.length;
      if (textLength > TEXT_LIMIT) return fail("본문은 30,000자까지 입력할 수 있어요.");
      return { type, attrs: { markdown: attrs.markdown } };
    }
    if (type === "video") {
      record(input, ["type", "attrs"]);
      const attrs = record(row.attrs, ["url"]);
      const safe = safeExternalLink(attrs.url);
      if (!safe || !safe.startsWith("https://") || ++videoCount > 10)
        return fail("영상은 안전한 https:// 링크로 10개까지 첨부할 수 있어요.");
      return { type, attrs: { url: parseVideoUrl(safe)?.url ?? safe } };
    }
    if (type === "hardBreak" || type === "horizontalRule") {
      record(input, ["type"]);
      return { type };
    }
    record(input, [
      "type",
      "content",
      ...(type === "heading" || type === "orderedList" ? ["attrs"] : []),
    ]);
    const output = { type } as PostDocumentNode & { content?: PostDocumentNode[]; attrs?: unknown };
    if (type === "heading") {
      const attrs = record(row.attrs, ["level"]);
      if (attrs.level !== 2 && attrs.level !== 3) return fail("제목 크기를 선택해주세요.");
      output.attrs = { level: attrs.level };
    }
    if (type === "orderedList" && row.attrs !== undefined) {
      const attrs = record(row.attrs, ["start"]);
      if (
        !Number.isInteger(attrs.start) ||
        (attrs.start as number) < 1 ||
        (attrs.start as number) > 10000
      )
        return fail("목록 시작 번호가 올바르지 않아요.");
      output.attrs = { start: attrs.start };
    }
    if (row.content !== undefined) {
      if (!Array.isArray(row.content)) return fail("문서 항목이 올바르지 않아요.");
      output.content = row.content.map((item) => node(item, depth + 1, type));
    }
    if (
      ["bulletList", "orderedList", "listItem", "blockquote"].includes(type) &&
      !output.content?.length
    )
      return fail("비어 있는 목록이나 인용문은 저장할 수 없어요.");
    if (type === "listItem" && output.content?.[0]?.type !== "paragraph")
      return fail("목록 항목은 문단으로 시작해주세요.");
    return output;
  }
  const document: PostDocument = {
    version: 1,
    type: "doc",
    content: root.content.map((item) => node(item, 1, "doc")),
  };
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > BYTE_LIMIT)
    return fail("정규화된 문서는 200KB까지 저장할 수 있어요.");
  const fallback = postDocumentToMarkdown(document);
  if (!fallback.trim()) return fail("내용을 입력해주세요.");
  if (fallback.length > TEXT_LIMIT)
    return fail("본문과 첨부 링크를 합쳐 30,000자까지 저장할 수 있어요.");
  return document;
}

export const postDocumentSchema = z.unknown().transform((value, context): PostDocument => {
  try {
    return normalizeDocument(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "문서 형식이 올바르지 않아요.",
    });
    return z.NEVER;
  }
});

export function postDocumentImageIds(document: PostDocument): string[] {
  const result: string[] = [];
  function visit(node: PostDocumentNode) {
    if (node.type === "image") result.push(node.attrs.assetId);
    if ("content" in node) node.content?.forEach(visit);
  }
  document.content.forEach(visit);
  return [...new Set(result)];
}
export function postDocumentVideoIds(document: PostDocument): string[] {
  const result: string[] = [];
  function visit(node: PostDocumentNode) {
    if (node.type === "uploadedVideo") result.push(node.attrs.assetId);
    if ("content" in node) node.content?.forEach(visit);
  }
  document.content.forEach(visit);
  return [...new Set(result)];
}
const escapeMarkdown = (text: string) => text.replace(/[\\#*_>\[\]\x60~!|]/g, "\\$&");

/** Compatibility/search text is derived from the document by the trusted server. */
export function postDocumentToMarkdown(document: PostDocument): string {
  function render(node: PostDocumentNode): string {
    if (node.type === "text") return escapeMarkdown(node.text);
    if (node.type === "legacyMarkdown") return node.attrs.markdown;
    if (node.type === "hardBreak") return "\n";
    if (node.type === "horizontalRule") return "\n---\n";
    if (node.type === "image") return "\n![첨부 이미지](/api/media/" + node.attrs.assetId + ")\n";
    if (node.type === "video") return "\n영상: " + node.attrs.url + "\n";
    if (node.type === "uploadedVideo") return "\n영상: /api/videos/" + node.attrs.assetId + "\n";
    const content = "content" in node ? (node.content?.map(render).join("") ?? "") : "";
    if (node.type === "listItem") return "- " + content.trim() + "\n";
    return content + "\n";
  }
  return document.content.map(render).join("\n").trim();
}
