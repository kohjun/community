import type { JSONContent } from "@tiptap/core";
import type { MarkdownManager } from "@tiptap/markdown";
import type { PublicImage } from "@/domain/contracts";
import {
  postDocumentImageIds,
  postDocumentToMarkdown,
  safeExternalLink,
  type PostDocument,
  type PostDocumentMark,
  type PostDocumentNode,
} from "@/domain/post-document";
const EMPTY: PostDocument = { version: 1, type: "doc", content: [{ type: "paragraph" }] };

function canonicalNode(input: JSONContent): PostDocumentNode | null {
  if (input.type === "text") {
    if (!input.text) return null;
    const marks: PostDocumentMark[] = [];
    for (const mark of input.marks ?? []) {
      if (mark.type === "link") {
        const href = safeExternalLink(mark.attrs?.href);
        if (href) marks.push({ type: "link", attrs: { href } });
      } else if (["bold", "italic", "strike", "underline", "code"].includes(mark.type))
        marks.push({ type: mark.type as "bold" | "italic" | "strike" | "underline" | "code" });
    }
    return { type: "text", text: input.text, ...(marks.length ? { marks } : {}) };
  }
  if (input.type === "hardBreak" || input.type === "horizontalRule") return { type: input.type };
  if (input.type === "image")
    return {
      type: "image",
      attrs: { assetId: String(input.attrs?.assetId ?? ""), alt: String(input.attrs?.alt ?? "") },
    };
  if (input.type === "uploadedVideo")
    return { type: "uploadedVideo", attrs: { assetId: String(input.attrs?.assetId ?? "") } };
  if (input.type === "video")
    return { type: "video", attrs: { url: String(input.attrs?.url ?? "") } };
  if (input.type === "legacyMarkdown")
    return { type: "legacyMarkdown", attrs: { markdown: String(input.attrs?.markdown ?? "") } };
  const content = (input.content ?? [])
    .map(canonicalNode)
    .filter((node): node is PostDocumentNode => !!node);
  if (input.type === "heading")
    return {
      type: "heading",
      attrs: { level: input.attrs?.level === 3 ? 3 : 2 },
      ...(content.length ? { content } : {}),
    };
  if (input.type === "orderedList")
    return { type: "orderedList", attrs: { start: Number(input.attrs?.start ?? 1) }, content };
  if (
    input.type === "paragraph" ||
    input.type === "bulletList" ||
    input.type === "listItem" ||
    input.type === "blockquote"
  )
    return { type: input.type, ...(content.length ? { content } : {}) };
  return null;
}
export function canonicalDocument(input: JSONContent): PostDocument {
  const content = (input.content ?? [])
    .map(canonicalNode)
    .filter((node): node is PostDocumentNode => !!node);
  return { version: 1, type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
export function appendImages(document: PostDocument, images: PublicImage[]): PostDocument {
  const placed = new Set(postDocumentImageIds(document));
  const unplaced: PostDocumentNode[] = [];
  for (const image of images) {
    if (placed.has(image.id)) continue;
    placed.add(image.id);
    unplaced.push({ type: "image", attrs: { assetId: image.id, alt: "" } });
  }
  return unplaced.length
    ? { ...document, content: [...document.content, ...unplaced, { type: "paragraph" }] }
    : document;
}
export function legacyDocument(
  markdown: string,
  manager: MarkdownManager,
  images: PublicImage[],
): PostDocument {
  if (!markdown.trim()) return appendImages(EMPTY, images);
  try {
    let complex = false;
    manager.instance.walkTokens(manager.instance.lexer(markdown), (token) => {
      if (
        ["code", "table", "image", "html"].includes(token.type) ||
        (token.type === "list_item" && token.task)
      )
        complex = true;
    });
    if (!complex) {
      const document = canonicalDocument(manager.parse(markdown));
      if (postDocumentToMarkdown(document).trim()) return appendImages(document, images);
    }
  } catch {
    /* Unsupported legacy syntax remains editable without losing its source. */
  }
  return appendImages(
    {
      version: 1,
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "legacyMarkdown", attrs: { markdown } },
        { type: "paragraph" },
      ],
    },
    images,
  );
}
