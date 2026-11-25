export const CHARACTER_AVATARS = [
  { id: "casual-player", label: "보드게임 단골", src: "/images/examples/player-casual.webp" },
  { id: "puzzle-sleuth", label: "퍼즐 탐정", src: "/images/examples/player-detective.webp" },
  { id: "stage-host", label: "무대 진행자", src: "/images/examples/player-host.webp" },
  { id: "mission-player", label: "미션 탐험가", src: "/images/examples/player-mission.webp" },
  { id: "morning-run", label: "아침 러너", src: "/images/profile-avatars/morning-run.webp" },
  {
    id: "late-night-radio",
    label: "심야 라디오",
    src: "/images/profile-avatars/late-night-radio.webp",
  },
  { id: "film-club", label: "영화 모임", src: "/images/profile-avatars/film-club.webp" },
  { id: "cafe-quiz", label: "카페 퀴즈", src: "/images/profile-avatars/cafe-quiz.webp" },
  { id: "city-walk", label: "도시 산책", src: "/images/profile-avatars/city-walk.webp" },
  { id: "table-mission", label: "테이블 미션", src: "/images/profile-avatars/table-mission.webp" },
  { id: "weekend-garden", label: "주말 정원", src: "/images/profile-avatars/weekend-garden.webp" },
  { id: "storyteller", label: "이야기꾼", src: "/images/profile-avatars/storyteller.webp" },
] as const;

export const SYMBOL_AVATARS = [
  { id: "spark", label: "반짝임", symbol: "✦" },
  { id: "heart", label: "하트", symbol: "♡" },
  { id: "game", label: "깃발", symbol: "⚑" },
  { id: "music", label: "음표", symbol: "♫" },
  { id: "planet", label: "행성", symbol: "◉" },
  { id: "smile", label: "미소", symbol: "☺" },
] as const;

const avatarOptions = [...SYMBOL_AVATARS, ...CHARACTER_AVATARS];
export const PROFILE_AVATAR_IDS = avatarOptions.map(({ id }) => id);
export type ProfileAvatar = (typeof PROFILE_AVATAR_IDS)[number];

export function getProfileAvatar(id: string) {
  return avatarOptions.find((option) => option.id === id) ?? SYMBOL_AVATARS[0];
}
