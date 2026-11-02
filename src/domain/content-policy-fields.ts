import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const markdownFields = new Set([
  "bodyMarkdown",
  "body",
  "message",
  "scenario",
  "rules",
  "hostGuide",
  "worldbuilding",
  "victoryCondition",
  "movementRules",
  "facilitatorNotes",
  "scoring",
  "details",
  "budgetNotes",
  "planningIntent",
  "description",
  "summary",
]);
const mixedDisplayFields = new Set(["description", "summary"]);

/** Shared input extraction for client feedback and mandatory server checks. */
export class ContentPolicyInputError extends Error {}

const labels: Record<string, string> = {
  title: "제목",
  name: "이름",
  nickname: "닉네임",
  bio: "소개",
  region: "지역",
  body: "내용",
  text: "내용",
  bodyMarkdown: "본문",
  bodyDocument: "본문",
  description: "설명",
  summary: "요약",
  spoilerTitle: "미리보기 제목",
  spoilerSummary: "미리보기 요약",
  tags: "태그",
  topic: "주제",
  question: "질문",
  prompt: "질문",
  options: "선택지",
  location: "장소",
  contactInfo: "연락 안내",
  note: "안내 내용",
  notes: "안내 내용",
  scenario: "시나리오",
  rules: "규칙",
  materials: "준비물",
  hostGuide: "진행 가이드",
  usageTerms: "이용 조건",
  purpose: "기획 의도",
  execution: "진행 회고",
  highlights: "잘된 점",
  improvements: "개선점",
  venueTips: "장소 운영 팁",
  changeSummary: "변경 요약",
  contribution: "기여 내용",
  correctionNote: "정정 내용",
};
const technical = /(?:Id|Ids|Url|Urls|URL|URI|Key|Token|Hash|Version|Revision|At|Date)$/;
const ignored = new Set([
  "type",
  "kind",
  "status",
  "categorySlug",
  "activityCategory",
  "discussionType",
  "avatar",
  "contentType",
  "refundPolicy",
  "approvalMode",
  "meetupType",
  "gender",
  "ageBand",
  "id",
  "ids",
  "url",
  "urls",
  "uri",
  "href",
  "key",
  "token",
  "hash",
  "version",
  "revision",
  "date",
]);

/** Only validated public mutation payloads belong here; never inspect reads,
 * private reports/support evidence, participant contacts or payment records.
 * This is a synchronous local rule check, with no network, storage or DB calls.
 */
export function contentPolicyFields(input: unknown): { label: string; text: string }[] {
  const fields: { label: string; text: string }[] = [];
  let nodes = 0,
    characters = 0;
  const guard = (depth: number) => {
    if (++nodes > 20000 || depth > 32)
      throw new ContentPolicyInputError("검사할 내용이 너무 복잡해요. 문서를 나누어 작성해주세요.");
  };
  const add = (label: string, text: string) => {
    characters += text.length;
    if (characters > 1_000_000)
      throw new ContentPolicyInputError("내용이 너무 길어요. 문서를 나누어 작성해주세요.");
    if (text) fields.push({ label, text });
  };
  function markdownText(source: string): string {
    if (source.length + characters > 1_000_000)
      throw new ContentPolicyInputError("내용이 너무 길어요. 문서를 나누어 작성해주세요.");
    const tree = markdownParser.parse(source);
    const blocks = new Set([
      "root",
      "paragraph",
      "heading",
      "blockquote",
      "list",
      "listItem",
      "table",
      "tableRow",
      "tableCell",
    ]);
    function visible(node: unknown, depth: number): string {
      guard(depth);
      if (!node || typeof node !== "object") return "";
      const item = node as { type?: string; value?: string; alt?: string; children?: unknown[] };
      if (item.type === "html" || item.type === "definition") return "";
      if (item.type === "break" || item.type === "thematicBreak") return "\n";
      if (item.type === "image" || item.type === "imageReference")
        return "\n" + (item.alt ?? "") + "\n";
      if (item.type === "text" || item.type === "code" || item.type === "inlineCode")
        return item.value ?? "";
      const content = item.children?.map((child) => visible(child, depth + 1)).join("") ?? "";
      return content + (blocks.has(item.type ?? "") ? "\n" : "");
    }
    return visible(tree, 0);
  }
  function document(node: unknown, depth: number): string {
    guard(depth);
    if (!node || typeof node !== "object" || Array.isArray(node)) return "";
    const value = node as Record<string, unknown>;
    if (value.type === "text") return typeof value.text === "string" ? value.text : "";
    if (value.type === "hardBreak" || value.type === "horizontalRule") return "\n";
    const attrs =
      value.attrs && typeof value.attrs === "object"
        ? (value.attrs as Record<string, unknown>)
        : {};
    if (value.type === "legacyMarkdown")
      return typeof attrs.markdown === "string" ? markdownText(attrs.markdown) + "\n" : "";
    if (value.type === "image")
      return typeof attrs.alt === "string" ? "\n" + attrs.alt + "\n" : "\n";
    if (value.type === "video" || value.type === "uploadedVideo") return "\n";
    const content = Array.isArray(value.content)
      ? value.content.map((child) => document(child, depth + 1)).join("")
      : "";
    return content + "\n";
  }
  function visit(value: unknown, label: string, depth: number, field = "") {
    guard(depth);
    if (typeof value === "string") {
      if (markdownFields.has(field)) {
        add(label, markdownText(value));
        if (mixedDisplayFields.has(field)) add(label, value);
      } else add(label, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, label, depth + 1, field);
      return;
    }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (row.type === "doc" && row.version === 1) {
      // Join adjacent styled text nodes exactly as displayed, preserving actual
      // paragraph and hard-break boundaries. IDs and embedded URLs are omitted.
      const text = Array.isArray(row.content)
        ? row.content.map((node) => document(node, depth + 1)).join("\n")
        : "";
      add(label, text);
      return;
    }
    for (const [key, child] of Object.entries(row)) {
      if (ignored.has(key) || technical.test(key)) continue;
      // The validated rich document is what is rendered; its Markdown is only
      // a search/compatibility derivative and can contain hidden video URLs.
      if (
        key === "bodyMarkdown" &&
        row.bodyDocument &&
        typeof row.bodyDocument === "object" &&
        (row.bodyDocument as { type?: string }).type === "doc"
      )
        continue;
      visit(child, labels[key] ?? label, depth + 1, key);
    }
  }
  visit(input, "내용", 0);
  return fields;
}
