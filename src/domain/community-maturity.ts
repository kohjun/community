import { z } from "zod";
import type { TopicSlug } from "./topics";
export const TOPIC_STARTERS: Record<
  TopicSlug,
  { intro: string; question: string; preparation: string; improvement: string }
> = {
  mystery: {
    intro: "처음에는 역할과 승리 조건이 단순하고, 탈락 후에도 함께할 수 있는 게임부터 골라보세요.",
    question: "초보 참가자가 추리게임에서 소외되지 않으려면 어떤 규칙이 필요할까요?",
    preparation: "스포일러를 구분하고 역할 설명·질문 시간을 미리 준비해요.",
    improvement: "규칙을 다시 물어본 지점 한 가지를 다음 안내에서 개선해요.",
  },
  "mission-race": {
    intro: "짧은 동선과 적은 수의 미션으로 시작하고, 실제 이동 시간을 먼저 확인해보세요.",
    question: "이동이 느린 팀도 끝까지 즐길 수 있는 미션 레이스는 어떻게 만들까요?",
    preparation: "이동 동선·휴식·집결 장소와 진행 중 연락 방법을 안내해요.",
    improvement: "대기 시간이 길었던 미션 한 가지를 다음 회차에서 조정해요.",
  },
  "social-party": {
    intro: "혼자 온 사람도 참여할 수 있는 짧은 소개와 가벼운 공동 활동부터 시작해보세요.",
    question: "혼자 온 참가자도 자연스럽게 어울릴 수 있는 첫 10분은 어떻게 만들까요?",
    preparation: "참여를 강요하지 않는 규칙과 예상 현장 비용을 먼저 알려요.",
    improvement: "말하기 어려웠던 순간이나 편했던 활동을 물어 다음 회차에 반영해요.",
  },
};
export const pilotPlanSchema = z.strictObject({
  region: z.string().trim().min(1, "활동 지역을 입력해주세요.").max(80),
  hosts: z.number().int().min(3).max(5),
  topics: z
    .array(z.enum(["mystery", "mission-race", "social-party"]))
    .min(1)
    .max(3)
    .refine((v) => new Set(v).size === v.length),
});
export function pilotPlanMarkdown(input: unknown): string {
  const v = pilotPlanSchema.parse(input);
  return [
    "# Sliper 4주 반복 운영 계획",
    "직접 작성하는 운영 초안입니다. 주최자 섭외·행사 개최가 확정된 것은 아닙니다.",
    "활동 지역: " + v.region,
    "동의 후 함께할 주최자 목표: " + v.hosts + "명",
    "선택 주제: " + v.topics.join(", "),
    "## 준비 주",
    "- 주최자 동의와 크루 구성",
    "- 주최·현장 보조·문의 담당 배정",
    "- 첫 참가 안내, 예상 비용과 장소 사용 가능 여부 확인",
    "## 1주: 작은 첫 행사",
    "- 소규모 모집 → 담당자 승인 → 공지방 안내",
    "- 출석 확인 → 완료 처리 → 인증 후기와 회고",
    "## 2주: 한 가지 개선",
    "- 지난 질문 중 반복된 내용을 안내에 반영",
    "- 같은 형식으로 재개최하고 개선한 부분 확인",
    "## 3주: 다른 호스트가 진행",
    "- 사용 자료와 발행 버전 연결",
    "- 다른 진행자가 재사용한 결과와 달라진 점 기록",
    "## 4주: 다음 달 결정",
    "- 실제 참가·완료 기록과 인증 후기를 함께 검토",
    "- 유지할 것 / 바꿀 것 / 중단할 것 정리",
    "## 매회 남길 회고",
    "- 참가자가 자주 물은 질문:",
    "- 실제 진행과 잘된 점:",
    "- 개선할 점 한 가지:",
    "- 다음 회차 담당자와 확인 방법:",
    "## 주제별 발제",
    ...v.topics.map((t) => "- " + TOPIC_STARTERS[t].question),
    "개인 연락처·신청 답변은 공개 회고에 넣지 않습니다. 기존 행사 관리와 회원 전용 기록에서 확인합니다.",
  ].join("\n\n");
}
export function handlingExplanation(status: string, kind: "report" | "support") {
  if (status === "open")
    return {
      stage: 1,
      title: "접수되었어요",
      text: "아직 처리 결과가 등록되지 않았어요. 이 상태만으로 담당자의 검토 시작 여부를 알 수는 없어요.",
    };
  if (status === "answered")
    return {
      stage: 2,
      title: "답변이 도착했어요",
      text: "아래 답변을 확인해주세요. 추가 설명이 필요하면 문의 번호와 함께 알려주세요.",
    };
  if (["actioned", "dismissed", "closed"].includes(status))
    return {
      stage: 3,
      title:
        status === "actioned"
          ? "조치 결과가 등록되었어요"
          : status === "dismissed"
            ? "검토 결과가 등록되었어요"
            : "처리가 마무리되었어요",
      text:
        kind === "report"
          ? "아래 처리 안내를 확인해주세요. 추가 근거가 있으면 신고 처리 문의로 전달할 수 있어요."
          : "답변으로 해결되지 않았다면 문의 번호와 필요한 내용을 함께 보내주세요.",
    };
  return {
    stage: 0,
    title: "상태 확인이 필요해요",
    text: "새로고침하거나 도움 요청하기에서 문의해주세요.",
  };
}
