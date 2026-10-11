export const ACTIVITY_REWARDS = {
  post: { label: "이야기 작성", points: 5, dailyCap: 30 },
  comment: { label: "댓글 작성", points: 2, dailyCap: 20 },
  vote: { label: "투표 참여", points: 1, dailyCap: 10 },
  visit: { label: "오늘의 방문", points: 2, dailyCap: 2 },
  crew: { label: "행사 기여 확인", points: 5, dailyCap: 10 },
} as const;
export type ActivityReason = keyof typeof ACTIVITY_REWARDS;
