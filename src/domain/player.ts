import { z } from "zod";
export const PLAYER_ROLES = ["brain", "physical", "strategist", "trickster"] as const;
export type PlayerRole = (typeof PLAYER_ROLES)[number];
export const PLAYER_ROLE_LABELS: Record<PlayerRole, string> = {
  brain: "두뇌형",
  physical: "피지컬형",
  strategist: "전략가",
  trickster: "트릭스터",
};
export const MANNER_TAGS = ["규칙 준수", "배려", "진행 방해"] as const;
export const playerPreferenceSchema = z.strictObject({
  preferredRole: z.enum(PLAYER_ROLES).nullable(),
  matchingVisible: z.boolean(),
  historyPublic: z.boolean(),
});
export const playerDirectorySchema = z.strictObject({
  role: z.enum(PLAYER_ROLES).optional(),
  region: z.string().trim().max(80).optional(),
  cursor: z.string().min(1).max(1024).optional(),
});
export const eventResultSchema = z
  .strictObject({
    applicationId: z.uuid(),
    expectedUpdatedAt: z.iso.datetime().optional(),
    presence: z.enum(["attended", "no_show"]),
    outcome: z.enum(["participated", "won"]),
    observedRole: z.enum(PLAYER_ROLES).nullable(),
    reason: z.string().trim().max(500).default(""),
  })
  .refine(
    (value) =>
      value.presence !== "no_show" ||
      (value.outcome === "participated" && value.observedRole === null),
    {
      message: "미참석 기록에는 우승이나 역할을 지정할 수 없어요.",
    },
  );
export const mannerReviewSchema = z
  .strictObject({
    targetPublicId: z.uuid(),
    sentiment: z.enum(["positive", "negative"]),
    tags: z.array(z.enum(MANNER_TAGS)).min(1).max(2),
  })
  .refine(
    (value) =>
      new Set(value.tags).size === value.tags.length &&
      (value.sentiment === "positive"
        ? value.tags.every((tag) => tag !== "진행 방해")
        : value.tags.every((tag) => tag === "진행 방해")),
    {
      message: "평가에 맞는 항목을 선택해주세요.",
    },
  );
export type PlayerSummary = {
  attended: number;
  noShow: number;
  wins: number;
  hosted: number;
  positive: number;
  negative: number;
  mannerTemperature: number;
  observedRoles: Record<PlayerRole, number>;
};
export type PlayerCard = {
  careerVisible: boolean;
  publicId: string;
  nickname: string;
  bio: string;
  region: string;
  avatar: string;
  preferredRole: PlayerRole | null;
  summary: PlayerSummary;
};
export type PlayerHistory = {
  sample: boolean;
  postId: string;
  title: string;
  endedAt: string;
  presence: "attended" | "no_show";
  outcome: "participated" | "won";
  observedRole: PlayerRole | null;
};
export type PlayerProfileView = PlayerCard & {
  isMe: boolean;
  matchingVisible: boolean;
  historyPublic: boolean;
  history: PlayerHistory[];
};
export type PlayerDirectoryView = {
  items: PlayerCard[];
  nextCursor: string | null;
  myPublicId: string | null;
};
export type PlayerRosterView = {
  postId: string;
  title: string;
  canRecord: boolean;
  endedAt: string | null;
  attendees: Array<{
    applicationId: string;
    publicId: string;
    nickname: string;
    isMe: boolean;
    result: {
      presence: "attended" | "no_show";
      outcome: "participated" | "won";
      observedRole: PlayerRole | null;
      reason: string;
      updatedAt: string;
    } | null;
  }>;
};
export type MannerReviewView = {
  postId: string;
  title: string;
  members: Array<{ publicId: string; nickname: string; reviewed: boolean }>;
};
export function mannerTemperature(
  input: Pick<PlayerSummary, "attended" | "noShow" | "positive" | "negative">,
) {
  return (
    Math.round(
      Math.max(
        0,
        Math.min(
          99.9,
          36.5 +
            input.attended * 0.1 +
            input.positive * 0.2 -
            input.negative * 0.5 -
            input.noShow * 2,
        ),
      ) * 10,
    ) / 10
  );
}
