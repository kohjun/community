import type { LibraryInput } from "./library";
import { emptyEventPlan, type EventMission } from "./event-plan";

const missions: EventMission[] = [
  {
    name: "식재료 찾기",
    zone: "1구역",
    kind: "mission",
    summary: "메뉴에 필요한 식재료를 식품관에서 찾아 사진으로 인증해요.",
    rules: "10분 안에 지정된 식재료 사진을 모두 찍어오면 성공합니다. 총 4번의 기회가 있습니다.",
    facilitatorNotes: "스태프는 현대백화점 식품관 입구에서 대기하고 사진으로 재료를 확인합니다.",
    scoring: "성공 시 1구역 점령",
    durationMinutes: 10,
  },
  {
    name: "텔레파시 코디",
    zone: "2구역",
    kind: "mission",
    summary: "대화 없이 각자 고른 의상으로 하나의 컨셉 코디를 완성해요.",
    rules:
      "5명이 상의·하의·아우터·모자·악세서리를 릴레이로 찾아 전달합니다. 제한 시간은 7분이며 실패하면 30초를 추가해 재도전합니다.",
    facilitatorNotes:
      "유니클로 매장에서 진행합니다. 받은 옷은 바구니에 숨겨 다음 사람이 보지 못하게 합니다.",
    scoring: "성공 시 2구역 점령",
    durationMinutes: 7,
  },
  {
    name: "닮은 인형 찾기",
    zone: "3구역",
    kind: "mission",
    summary: "팀원과 닮은 인형을 찾고 누구의 인형인지 맞혀요.",
    rules:
      "1명은 대기하고 4명이 10분 동안 버터샵에서 닮은 인형을 찾습니다. 대기자가 4명의 인형을 모두 올바르게 매칭하면 성공합니다.",
    facilitatorNotes: "재도전할 때 정답을 맞히는 사람을 교체하고 인형은 중복으로 고르지 않습니다.",
    scoring: "성공 시 3구역 점령",
    durationMinutes: 10,
  },
  {
    name: "정총무가 쏜다",
    zone: "4구역",
    kind: "mission",
    summary: "식당가 메뉴 가격의 총합을 예측하는 추리 미션이에요.",
    rules:
      "휴대폰을 제출하고 식당가를 4분 동안 관찰합니다. 스태프가 보여주는 5개 메뉴의 가격 총합을 오차 10% 이내로 맞히면 성공합니다.",
    facilitatorNotes: "재도전 시 관찰 시간은 2분으로 줄이고 메뉴를 바꿉니다.",
    scoring: "성공 시 4구역 점령",
    durationMinutes: 4,
  },
  {
    name: "숨바꼭질 대결",
    zone: "5구역",
    kind: "duel",
    summary: "두 팀이 스태프를 피해 더 많은 인원을 남기는 특별 대결이에요.",
    rules:
      "잠금 해제 후 먼저 도착한 두 팀이 5분 동안 숨습니다. 이후 스태프가 10분 동안 사진을 찍어 찾고, 더 많이 살아남은 팀이 승리합니다.",
    facilitatorNotes:
      "숨은 뒤에는 이동할 수 없습니다. 매장·화장실·비상구 등 지정 외 구역에 숨으면 반칙패입니다.",
    scoring: "승리 팀이 5구역 영구 점령",
    durationMinutes: 15,
  },
  {
    name: "가장 긴 책 제목 찾기",
    zone: "6구역",
    kind: "special",
    summary: "별마당 도서관에서 가장 긴 한글 책 제목을 찾아요.",
    rules:
      "레이스 종료까지 제목을 등록하고 한글 음절 수로 순위를 정합니다. 띄어쓰기와 부제는 제외합니다. 한 번에 한 권만 등록할 수 있습니다.",
    facilitatorNotes: "기록을 갱신하려면 다른 구역의 미션을 수행한 뒤 다시 도전합니다.",
    scoring: "종료 후 1위 팀이 6구역 점령",
    durationMinutes: null,
  },
  {
    name: "길찾기 및 멀리뛰기",
    zone: "7구역",
    kind: "mission",
    summary: "단어를 찾아 목적지로 이동하고 단체 멀리뛰기에 도전해요.",
    rules:
      "책에서 단어 3개를 찾고 what3words 앱으로 장소를 확인해 이동합니다. 도착지에서 5명의 멀리뛰기 총합이 800점을 넘으면 성공합니다.",
    facilitatorNotes: "what3words 앱 사용법을 안내하고 팀원별 점수를 합산합니다.",
    scoring: "성공 시 7구역 점령",
    durationMinutes: null,
  },
  {
    name: "패션 코디 대결",
    zone: "8구역",
    kind: "duel",
    summary: "예산 내에서 컨셉에 맞는 커플룩을 완성하고 촬영해요.",
    rules:
      "잠금 해제 후 선착순 두 팀이 대결합니다. 자라 매장에서 20분 안에 80만원 이하의 컨셉 커플룩을 만들고 사진을 찍습니다.",
    facilitatorNotes:
      "80만원은 코디 구성의 예산으로, 아래 운영 예산과 별도입니다. 초과하면 감점하고 컨셉 충실도·사진 퀄리티로 평가합니다.",
    scoring: "승리 팀이 8구역 점령",
    durationMinutes: 20,
  },
  {
    name: "책에서 특정 단어 찾기",
    zone: "9구역",
    kind: "mission",
    summary: "영풍문고의 책 본문에서 제시된 단어 세트를 찾아요.",
    rules:
      "8분 안에 선택한 세트의 단어를 찾아 스태프에게 확인받습니다. 겉표지의 단어는 인정하지 않습니다.",
    facilitatorNotes: "실패하면 2분 쉬고 다른 단어 세트로 재도전할 수 있습니다.",
    scoring: "성공 시 9구역 점령",
    durationMinutes: 8,
  },
  {
    name: "포즈 따라 사진 찍기",
    zone: "10구역",
    kind: "mission",
    summary: "영화·드라마 퀴즈를 풀고 단체 포즈 사진을 찍어요.",
    rules:
      "이어말하기 퀴즈의 정답 수에 따라 어려움·보통·쉬움 중 포즈 난이도를 정합니다. 부여된 포즈 2개를 촬영하면 성공합니다.",
    facilitatorNotes: "퀴즈는 한 바퀴 왕복으로 최대 9문제입니다.",
    scoring: "성공 시 10구역 점령",
    durationMinutes: null,
  },
  {
    name: "나는 가수다",
    zone: "11구역",
    kind: "mission",
    summary: "팀원이 부른 노래의 점수를 예측해요.",
    rules:
      "2명은 노래하고 3명은 점수를 예측합니다. 실제 점수와 오차가 3점 이내면 성공하며 공식 기회는 2번입니다.",
    facilitatorNotes: "노래 전에 1분 동안 상의합니다. 음정은 위아래 한 키만 조절할 수 있습니다.",
    scoring: "성공 시 11구역 점령",
    durationMinutes: null,
  },
  {
    name: "나는 배우다",
    zone: "12구역",
    kind: "special",
    summary: "메가박스에서 주어진 주제로 짧은 영화를 만들어요.",
    rules: "주제 중 하나를 골라 1명은 촬영하고 4명은 출연해 2분 내외의 영상을 만듭니다.",
    facilitatorNotes:
      "레이스 종료 후 촬영 구도·연기력·연출력·재미를 종합 평가합니다. 영상 길이 2분은 미션 제한 시간과 다릅니다.",
    scoring: "가장 잘 찍은 팀이 12구역 점령",
    durationMinutes: null,
  },
  {
    name: "사진 맞추기",
    zone: "13구역",
    kind: "mission",
    summary: "네 컷 사진으로 표현한 제시어를 팀원이 맞혀요.",
    rules:
      "3명이 제시어 4개를 몸으로 표현해 촬영합니다. 나머지 2명이 20개 보기에서 3개 이상 맞히면 성공합니다. 기회는 1번입니다.",
    facilitatorNotes: "포토이즘의 소품을 사용할 수 있고 촬영 전 회의가 가능합니다.",
    scoring: "성공 시 13구역 점령",
    durationMinutes: null,
  },
];
/** User-provided reference content. It is never saved or published automatically. */
export const COEX_PLAYBOOK_EXAMPLE: LibraryInput = {
  kind: "template",
  categorySlug: "race",
  title: "이구역 점령전: 코엑스편",
  summary:
    "코엑스 공간을 활용한 팀 기반 미션 레이스입니다. 제한 시간 동안 여러 구역을 이동하며 미션을 수행하고, 가장 많은 인접 구역을 점령한 팀이 승리합니다.",
  scenario:
    "각 팀은 코엑스 내부의 다양한 구역을 미션을 통해 점령합니다. 상대 팀의 전략을 읽고 팀워크를 발휘해 미션에 성공하세요. 원본 행사 소개의 모집 인원은 20명이며, 운영 예시에 기재된 참가 인원은 23명입니다.",
  rules:
    "구역을 이동할 때는 톡방에 선착순으로 고지합니다. 일반 구역은 미션 성공, 대결 구역은 상대 팀과의 승부, 특별 구역은 종료 후 평가로 점령합니다. 종료 시 가장 많은 인접 구역을 점령한 팀이 최종 승리합니다.",
  hostGuide:
    "집결 후 출석을 확인하고 구역 이동·인접 구역 규칙과 금지 사항을 안내합니다. 에티켓과 안전 주의사항을 설명하고, 특별 구역 오픈 시간을 공지합니다. 종료 후 베이스캠프로 복귀해 결과를 취합하고 우승 팀을 발표합니다.",
  materials: [],
  rounds: [
    { name: "식재료 찾기", seconds: 600 },
    { name: "텔레파시 코디", seconds: 420 },
    { name: "패션 코디 대결", seconds: 1200 },
  ],
  minPlayers: 20,
  maxPlayers: 20,
  durationMinutes: 240,
  tags: ["미션레이스", "팀플레이", "코엑스"],
  priceKRW: 0,
  purchaseUrl: null,
  usageTerms: "예시를 바탕으로 실제 운영 조건과 자료 이용 조건을 확인해 작성해주세요.",
  allowDerivatives: false,
  allowCommercialUse: false,
  eventPlan: {
    ...emptyEventPlan(),
    reference: {
      organizer: "B",
      date: "2026-02-27",
      startTime: "14:00",
      endTime: "18:00",
      location: "서울 코엑스(삼성역)",
      participants: 23,
      participantFeeKRW: 3000,
    },
    planningIntent:
      "단순 관람보다 직접 참여하고 체험하는 이벤트를 만들고자 기획했습니다. 예능의 미션형 레이스를 현실 공간에 적용하고, 복합문화공간인 코엑스 자체를 게임 요소로 활용합니다.",
    concept: "도시 점령 레이스",
    worldbuilding:
      "코엑스는 여러 구역으로 나뉜 하나의 거대한 도시입니다. 참가자는 도시의 구역을 점령하는 탐험가 팀이 되어 서로 다른 미션을 수행하며 전략적으로 이동합니다.",
    format: "구역 점령 미션 레이스 · 팀 단위 참가",
    teamSize: 5,
    victoryCondition: "이벤트 종료 시 가장 많은 인접 구역을 점령한 팀이 최종 승리합니다.",
    movementRules:
      "구역 이동 전 톡방에 선착순으로 고지합니다. 일반·대결·특별 구역별 점령 조건과 잠금 해제 시간을 확인합니다.",
    missions,
    timeline: [
      {
        time: "14:00",
        phase: "preparation",
        program: "참가자 집합",
        details: "집결 및 출석 확인",
        notes: "",
      },
      {
        time: "14:20",
        phase: "preparation",
        program: "규칙 설명",
        details: "구역 이동·인접 구역 규칙·금지 사항 안내",
        notes: "에티켓 및 안전 주의사항 강조",
      },
      {
        time: "14:30",
        phase: "main",
        program: "레이스 시작",
        details: "참가자 미션 돌입",
        notes: "톡방을 통한 구역 이동 고지 시작",
      },
      {
        time: "14:30",
        phase: "main",
        program: "구역 미션 진행",
        details: "각 구역 스태프 NPC 안내 및 미션 수행",
        notes: "",
      },
      {
        time: "15:40",
        phase: "main",
        program: "특별 구역 오픈",
        details: "5구역·8구역 등 대결 구역 잠금 해제 공지",
        notes: "16:10 유예시간까지 대기",
      },
      {
        time: "17:30",
        phase: "wrapup",
        program: "레이스 종료",
        details: "모든 미션 중단 및 베이스캠프 복귀",
        notes: "6구역·12구역 결과 취합",
      },
      {
        time: "17:40",
        phase: "wrapup",
        program: "결과 정산",
        details: "인접 구역 계산 및 특별 구역 점수 합산",
        notes: "",
      },
      {
        time: "17:50",
        phase: "wrapup",
        program: "우승 팀 발표",
        details: "최종 승리 팀 시상",
        notes: "",
      },
      { time: "18:00", phase: "wrapup", program: "이벤트 종료", details: "해산", notes: "" },
    ],
    budget: [
      { category: "지원금", description: "노래방 지원금", amountKRW: 4000 },
      { category: "지원금", description: "인생네컷 사진 지원금", amountKRW: 5000 },
    ],
    budgetNotes:
      "제공된 예시에는 지원금 두 항목이 포함돼요. 전체 비용이나 1인당 비용을 의미하는지는 실제 운영 전에 확인해주세요.",
  },
};
