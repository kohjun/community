import { unified } from "unified";
import remarkParse from "remark-parse";
const parser = unified().use(remarkParse);
type TextNode = { type: string; value?: string; children?: TextNode[] };
export function notificationSnippet(value: string, limit = 120): string {
  function text(node: TextNode): string {
    if (node.type === "image" || node.type === "imageReference") return " 사진 ";
    if (node.type === "html") return " ";
    if (node.value !== undefined) return node.value;
    return (node.children ?? []).map(text).join(node.type === "root" ? " " : "");
  }
  const plain = text(parser.parse(value))
    .replace(/https?:\/\/[^\s]+/gi, "링크")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일]")
    .replace(/(?<!\d)(?:\+82[- .]?)?0?1[016789][- .]?\d{3,4}[- .]?\d{4}(?!\d)/g, "[연락처]")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(plain);
  return characters.length > limit ? characters.slice(0, limit - 1).join("") + "…" : plain;
}
export const PARTICIPATION_COPY: Record<string, { title: string; body: string }> = {
  confirmed: {
    title: "모임 참가가 확정됐어요",
    body: "공지방에서 만나는 장소와 준비물을 확인해주세요.",
  },
  pending_approval: {
    title: "참가 신청이 접수됐어요",
    body: "담당자가 승인하면 공지방에 입장할 수 있어요.",
  },
  review: { title: "신청 내역 확인이 필요해요", body: "내 참가 내역에서 확인 상태를 살펴보세요." },
  rejected: {
    title: "참가 신청이 승인되지 않았어요",
    body: "내 참가 내역에서 담당자 안내를 확인해주세요.",
  },
  cancelled: {
    title: "참가 신청이 취소됐어요",
    body: "내 참가 내역에서 처리 결과를 확인할 수 있어요.",
  },
  refunded: {
    title: "환불 완료가 확인됐어요",
    body: "내 참가 내역에서 환불 처리 결과를 확인해주세요.",
  },
};
