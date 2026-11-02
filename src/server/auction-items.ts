// Server-only catalogue. Appraisals are randomized per round, never tied to an item's name.
import type { AuctionItem } from "../domain/auction-game";
export const AUCTION_ITEMS: readonly AuctionItem[] = [
  {
    name: "절대 식지 않는 머그컵",
    description: "마지막 한 모금까지 따뜻한 커피. 충전이 필요할까요? 판매자의 설명을 들어보세요.",
    icon: "☕",
  },
  {
    name: "월요일을 지워주는 지우개",
    description: "일주일에 딱 한 번, 달력보다 마음이 먼저 가벼워지는 물건.",
    icon: "🗓️",
  },
  {
    name: "속마음이 들리는 헤드폰",
    description: "소음 대신 진심을 들려준다는 소문. 어디까지 믿으시겠어요?",
    icon: "🎧",
  },
  {
    name: "한 번 더 기회를 주는 동전",
    description: "후회되는 순간을 바꾸고 싶은 사람에게 추천하는 작은 가능성.",
    icon: "🪙",
  },
  {
    name: "분위기를 읽는 선글라스",
    description: "첫 만남의 어색함 속에서 지금 필요한 말을 알려준다고 해요.",
    icon: "🕶️",
  },
  {
    name: "거짓말을 꽃피우는 화분",
    description: "누군가 거짓말할 때마다 꽃이 핀다면, 얼마나 큰 화분이 필요할까요?",
    icon: "🪴",
  },
  {
    name: "길을 잃지 않는 운동화",
    description: "처음 가는 곳에서도 자신 있게 한 걸음. 목적지는 누구 마음일까요?",
    icon: "👟",
  },
  {
    name: "미래의 날씨가 담긴 우산",
    description: "비가 오기 전 펴고 싶어지는, 예보보다 조금 신기한 우산.",
    icon: "☂️",
  },
  {
    name: "잠깐 멈추는 모래시계",
    description: "마감 직전의 시간을 조금 더 길게 쓸 수 있다는 이야기.",
    icon: "⌛",
  },
  {
    name: "칭찬을 돌려주는 거울",
    description: "외출 전 자신감이 필요한 당신. 거울은 어떤 말을 해줄까요?",
    icon: "🪞",
  },
  {
    name: "꿈을 녹음하는 베개",
    description: "일어나면 잊어버리는 기막힌 아이디어를 간직해보세요.",
    icon: "🌙",
  },
  {
    name: "잃어버린 물건을 부르는 종",
    description: "열쇠, 리모컨, 사라진 양말까지. 한 번 울려보고 싶지 않나요?",
    icon: "🔔",
  },
  {
    name: "행운을 담는 유리병",
    description: "눈에 보이지 않는 좋은 일을 모아둔다는 수상한 수집품.",
    icon: "🍀",
  },
  {
    name: "추억이 나오는 카메라",
    description: "셔터를 누르면 지금이 아닌 오래된 순간이 찍힌다고 해요.",
    icon: "📷",
  },
  {
    name: "입맛을 맞추는 숟가락",
    description: "오늘 먹고 싶은 맛을 가장 먼저 아는 식탁 위의 친구.",
    icon: "🥄",
  },
  {
    name: "집중력을 빌려주는 책갈피",
    description: "한 페이지만 읽으려다 끝까지 읽게 될지도 몰라요.",
    icon: "📖",
  },
  {
    name: "용기를 충전하는 배터리",
    description: "발표 전, 고백 전, 새로운 도전 전. 잔량은 어떻게 확인할까요?",
    icon: "🔋",
  },
  {
    name: "생각을 정리하는 퍼즐",
    description: "흩어진 마음을 한 조각씩 맞추는 아주 특별한 퍼즐.",
    icon: "🧩",
  },
  {
    name: "파티를 여는 초대장",
    description: "받은 사람이라면 누구나 주인공이 되는 밤을 약속해요.",
    icon: "🎟️",
  },
  {
    name: "박수를 불러오는 마이크",
    description: "평범한 한마디도 멋진 무대처럼 들리게 한다는 마이크.",
    icon: "🎤",
  },
  {
    name: "완벽한 타이밍의 알람",
    description: "언제 울릴지 정하지 않아도 딱 필요한 순간에 울린대요.",
    icon: "⏰",
  },
  {
    name: "친구를 만드는 보드게임",
    description: "설명서를 읽지 않아도 웃음이 시작된다는 작은 상자.",
    icon: "🎲",
  },
  {
    name: "기분 좋은 길만 찾는 지도",
    description: "가장 빠른 길보다 가장 즐거운 길이 필요할 때 펼쳐보세요.",
    icon: "🗺️",
  },
  {
    name: "비밀을 지켜주는 자물쇠",
    description: "비밀번호를 몰라도 마음만 맞으면 열린다는 수수께끼.",
    icon: "🔐",
  },
];
