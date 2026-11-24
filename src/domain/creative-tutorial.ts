import { CLUE_MODES, DRAWING_MODES, type ClueMode, type DrawingMode } from "./creative-games";
import type { GameTutorialCopy } from "./game-tutorial";

/** 낙서톡·단서각 explain only the chosen mode; mixing every mode in one walkthrough confused players. */
export function creativeTutorial(game: "drawing" | "clue", variant?: string): GameTutorialCopy {
  if (game === "clue")
    return clueTutorial(variant && variant in CLUE_MODES ? (variant as ClueMode) : "photo");
  const drawingMode: DrawingMode =
    variant && variant in DRAWING_MODES ? (variant as DrawingMode) : "mix";
  const mode = DRAWING_MODES[drawingMode];
  const player = mode.steps.map((step) => ({
    title: step.title,
    body: step.detail,
    action: step.action,
  }));
  return {
    title: `낙서톡 · ${mode.emoji} ${mode.title}`,
    summary: mode.description,
    goal:
      drawingMode === "relay"
        ? "점수 없이 이야기가 바뀌는 재미를 즐기고, 가장 웃긴 이야기를 뽑아요."
        : `${mode.rules} 점수를 가장 많이 모으면 우승!`,
    facts: [
      `${mode.minimum}~12명 · ${mode.scoring}`,
      "호스트도 참가 가능",
      "설정 변경 후 준비 유지",
      "결과와 개인 자료는 종료 24시간 보관",
    ],
    player,
    host: [
      {
        title: "모드와 시간을 정해요",
        body: "방 생성 후에도 대기실에서 옵션을 바꿀 수 있어요. 모두 준비하면 시작해요.",
        action: "링크·QR 공유 → 모두 준비 → 시작",
      },
      ...player,
    ],
    finish:
      drawingMode === "relay"
        ? "모든 이야기를 공개하고 재미 투표를 마치면 한 바퀴가 끝나요."
        : "모두 한 번씩 그리면 한 바퀴가 끝나요. 정한 바퀴를 마치면 점수가 가장 높은 사람이 우승이에요.",
    tips: [
      "화면 위 ‘내 할 일’ 카드에 지금 해야 할 일이 크게 나와요.",
      "다른 방식(그림 맞히기 · 전달 + 맞히기 · 그림 전달 놀이)은 대기실 설정에서 바꿀 수 있어요.",
      "호스트는 결과 감상을 잠시 멈추거나 다음 단계로 진행할 수 있어요.",
      "접속이 끊겼다면 같은 브라우저로 돌아와주세요.",
    ],
    questions: [
      {
        question:
          drawingMode === "live" ? "비슷하게 쓴 답도 정답이 되나요?" : "처음 쓴 문장이 정답인가요?",
        answer:
          drawingMode === "live"
            ? "네. 그린 사람이 들어온 답을 보고 같은 뜻이면 ‘정답 인정’을 눌러줘요."
            : "아니에요. 전달하면서 바뀐 마지막 문장이 정답이에요. 많이 바뀔수록 결과 공개가 재미있어요.",
      },
    ],
  };
}

function clueTutorial(clueMode: ClueMode): GameTutorialCopy {
  const mode = CLUE_MODES[clueMode];
  const member = clueMode === "member";
  const player = mode.steps.map((step) => ({
    title: step.title,
    body: step.detail,
    action: step.action,
  }));
  return {
    title: `단서각 · ${mode.emoji} ${mode.title}`,
    summary: mode.description,
    goal: `${mode.rules} 점수를 가장 많이 모으면 우승!`,
    facts: [
      member ? "2~12명 · 한 사람당 한 문제" : "2~12명 · 기본 5문제",
      member ? "직접 찍은 사진 사용" : "실제 네이버 거리뷰 사진",
      "호스트도 참가 가능",
      "결과와 개인 자료는 종료 24시간 보관",
    ],
    player,
    host: [
      {
        title: "모드와 문제 수를 정해요",
        body: member
          ? "모두 대기실에서 사진을 한 장씩 올리면 시작할 수 있어요."
          : "‘바로 시작’을 고르면 실제 거리뷰 문제가 자동으로 나와요. 준비할 게 없어요.",
        action: "링크·QR 공유 → 모두 준비 → 시작",
      },
      ...player,
    ],
    finish: member
      ? "모든 사람의 사진 문제가 끝나면 점수가 가장 높은 사람이 우승이에요. 동점은 공동 우승!"
      : "정한 문제 수가 끝나면 점수가 가장 높은 사람이 우승이에요. 동점은 공동 우승!",
    tips: [
      "화면 위 ‘내 할 일’ 카드에 지금 해야 할 일이 크게 나와요.",
      clueMode === "quiz"
        ? "간판·표지판·건물 모양이 큰 힌트예요. 거리뷰를 끌어서 둘러보세요."
        : "지도는 두 손가락으로 확대할 수 있어요. 대략 맞아도 가장 가까우면 1점!",
      "다른 방식은 대기실 설정에서 바꿀 수 있어요.",
      "접속이 끊겼다면 같은 브라우저로 돌아와주세요.",
    ],
    questions: [
      member
        ? {
            question: "내 사진 문제도 맞히나요?",
            answer: "아니요. 내 사진이 나오면 쉬면서 다른 사람이 맞히는 모습을 지켜봐요.",
          }
        : {
            question: "AI가 만든 사진인가요?",
            answer:
              "아니에요. 실제 거리를 촬영한 네이버 거리뷰를 그대로 보여줘요. 정답 위치는 결과 공개 때 알려줘요.",
          },
      {
        question: "시간 안에 못 내면요?",
        answer: "그 문제는 0점이에요. 모두 제출하면 시간이 남아도 바로 정답이 공개돼요.",
      },
    ],
  };
}
