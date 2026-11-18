import { z } from "zod";
import { uuidSchema } from "./validation";
import type { CrewRole } from "./crew";

export const crewChatInputSchema = z.strictObject({
  clientId: uuidSchema,
  body: z
    .string()
    .trim()
    .min(1, "메시지를 입력해주세요.")
    .max(2000, "메시지는 2,000자까지 보낼 수 있어요.")
    .refine(
      (value) => !/[\u0000\uD800-\uDFFF]/u.test(value),
      "사용할 수 없는 문자가 포함되어 있어요.",
    ),
});
export const crewChatQuerySchema = z.strictObject({
  cursor: z
    .string()
    .min(1)
    .max(1024)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export interface CrewChatMessage {
  id: string;
  body: string;
  createdAt: string;
  author: { publicId: string; nickname: string; avatar: string } | null;
  mine: boolean;
  removed: boolean;
  canDelete: boolean;
}
export interface CrewChatRoom {
  crewId: string;
  name: string;
  memberCount: number;
  myRole: CrewRole;
  canSend: boolean;
  messages: CrewChatMessage[];
  nextCursor: string | null;
}
