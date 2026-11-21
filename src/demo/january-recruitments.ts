import type { CategorySlug } from "@/domain/categories";
import type { LightningCategorySlug } from "@/domain/lightning-categories";
import type { MeetupType } from "@/domain/meetup-types";
import { EXAMPLES, type Example } from "./showcase";

type Entry = {
  number: number;
  exampleId: string;
  category: CategorySlug;
  day: number;
  hours: string;
  durationMinutes: number;
  capacity: number;
  amountKRW: number;
  activity?: LightningCategorySlug;
  coordinates?: readonly [number, number];
};

const additionalExamples: readonly Example[] = [
  {
    id: "event-film",
    title: "필름 미션 랩: 다섯 컷의 반전",
    category: "레이스",
    summary: "연남동 골목을 돌며 팀별로 다섯 컷짜리 이야기를 완성하는 사진 미션",
    facts: [["장소", "서울 마포구 연남동"]],
    detail:
      "세 명씩 팀을 나눠 골목에서 색, 물건, 구도를 주제로 다섯 컷을 찍어요. 마지막 컷에는 준비된 반전 키워드를 넣고, 모여서 서로의 이야기를 감상해요. 사진은 휴대폰으로 찍고 편집 경험 없이 참여할 수 있어요.",
  },
  {
    id: "event-strategy",
    title: "실내 전략전: 마지막 인장",
    category: "서바이벌",
    summary: "단서와 자원을 교환하고 마지막 라운드에 인장을 확보하는 팀 전략전",
    facts: [["장소", "서울 영등포구 문래동"]],
    detail:
      "첫 라운드에는 팀마다 다른 지도 조각과 자원을 받아요. 협상과 미션을 통해 다음 라운드에 필요한 정보를 모으고, 마지막에 인장을 확보한 팀이 승리해요. 시작 전에 규칙을 익히는 연습 라운드가 있어요.",
  },
  {
    id: "lightning-puzzle",
    title: "퇴근길, 퍼즐 한 판",
    category: "보드게임",
    summary: "카페에서 짧은 추리 카드 게임을 한두 판 함께 풀어요.",
    facts: [["장소", "서울 마포구 경의선숲길 인근"]],
    detail:
      "각자 받은 단서를 소리 내어 읽고 함께 사건의 순서를 찾아요. 규칙은 모임에서 같이 익혀요. 게임비는 없고 카페 음료는 각자 주문해요.",
  },
  {
    id: "lightning-dessert",
    title: "연남동 겨울 디저트 산책",
    category: "맛집·카페",
    summary: "연남동 골목을 걸으며 따뜻한 음료와 겨울 디저트를 즐겨요.",
    facts: [["장소", "서울 마포구 연남동"]],
    detail:
      "경의선숲길 근처에서 만나 가볍게 산책하고, 함께 정한 카페 한 곳에 들러요. 각자 궁금한 디저트를 하나씩 추천해주세요. 주문한 메뉴는 각자 결제해요.",
  },
];

const schedule: Record<MeetupType, readonly Entry[]> = {
  event: [
    {
      number: 1,
      exampleId: "event-mission",
      category: "race",
      day: 9,
      hours: "14:00",
      durationMinutes: 180,
      capacity: 16,
      amountKRW: 8000,
    },
    {
      number: 2,
      exampleId: "event-detective",
      category: "mind-games",
      day: 15,
      hours: "19:30",
      durationMinutes: 150,
      capacity: 8,
      amountKRW: 12000,
    },
    {
      number: 3,
      exampleId: "event-relay",
      category: "sports",
      day: 24,
      hours: "13:00",
      durationMinutes: 180,
      capacity: 20,
      amountKRW: 5000,
    },
    {
      number: 4,
      exampleId: "event-cooking",
      category: "cooking",
      day: 30,
      hours: "16:00",
      durationMinutes: 150,
      capacity: 12,
      amountKRW: 15000,
    },
    {
      number: 9,
      exampleId: "event-film",
      category: "race",
      day: 17,
      hours: "14:00",
      durationMinutes: 150,
      capacity: 12,
      amountKRW: 8000,
    },
    {
      number: 10,
      exampleId: "event-strategy",
      category: "survival",
      day: 31,
      hours: "14:00",
      durationMinutes: 180,
      capacity: 14,
      amountKRW: 9000,
    },
  ],
  lightning: [
    {
      number: 5,
      exampleId: "lightning-board",
      category: "mind-games",
      day: 8,
      hours: "19:30",
      durationMinutes: 90,
      capacity: 4,
      amountKRW: 0,
      activity: "games",
      coordinates: [37.5496, 126.9138],
    },
    {
      number: 6,
      exampleId: "lightning-photo",
      category: "travel",
      day: 16,
      hours: "15:40",
      durationMinutes: 80,
      capacity: 5,
      amountKRW: 0,
      activity: "photography",
      coordinates: [37.5397, 127.0017],
    },
    {
      number: 7,
      exampleId: "lightning-quiz",
      category: "party",
      day: 23,
      hours: "15:00",
      durationMinutes: 90,
      capacity: 6,
      amountKRW: 0,
      activity: "social",
      coordinates: [37.5088, 127.1042],
    },
    {
      number: 8,
      exampleId: "lightning-music",
      category: "music",
      day: 31,
      hours: "17:00",
      durationMinutes: 90,
      capacity: 5,
      amountKRW: 0,
      activity: "music",
      coordinates: [37.5442, 127.0374],
    },
    {
      number: 11,
      exampleId: "lightning-puzzle",
      category: "mind-games",
      day: 13,
      hours: "19:30",
      durationMinutes: 90,
      capacity: 4,
      amountKRW: 0,
      activity: "games",
      coordinates: [37.556, 126.922],
    },
    {
      number: 12,
      exampleId: "lightning-dessert",
      category: "cooking",
      day: 24,
      hours: "16:00",
      durationMinutes: 90,
      capacity: 5,
      amountKRW: 0,
      activity: "food-cafe",
      coordinates: [37.564, 126.925],
    },
  ],
};

export const JANUARY_RECRUITMENTS = (["event", "lightning"] as const).flatMap((type) =>
  schedule[type].map((entry) => {
    const example = [...EXAMPLES[type], ...additionalExamples].find(
      ({ id }) => id === entry.exampleId,
    );
    if (!example) throw new Error(`Missing recruitment sample: ${entry.exampleId}`);
    return {
      ...entry,
      type,
      postId: `6f027000-2027-4101-8100-${String(entry.number).padStart(12, "0")}`,
      startsAt: `2027-01-${String(entry.day).padStart(2, "0")}T${entry.hours}:00+09:00`,
      example,
    };
  }),
);

export function januaryRecruitmentSample(post: { id: string; sample: boolean }) {
  return post.sample ? JANUARY_RECRUITMENTS.find(({ postId }) => post.id === postId) : undefined;
}

export function isJanuaryRecruitmentSample(post: { id: string; sample: boolean }) {
  return !!januaryRecruitmentSample(post);
}
