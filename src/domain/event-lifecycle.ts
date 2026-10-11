import { z } from "zod";
export const eventChangeInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("cancel"),
    reason: z.string().trim().min(5).max(500),
    expectedRevision: z.number().int().min(0),
    confirmed: z.literal(true),
  }),
  z.strictObject({
    kind: z.literal("reschedule"),
    reason: z.string().trim().min(5).max(500),
    expectedRevision: z.number().int().min(0),
    confirmed: z.literal(true),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
  }),
]);
export interface EventChangeView {
  id: string;
  kind: "cancel" | "reschedule";
  reason: string;
  beforeStartsAt: string | null;
  beforeEndsAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}
export interface EventLifecycleView {
  postId: string;
  title: string;
  canManage: boolean;
  cancelledAt: string | null;
  revision: number;
  startsAt: string | null;
  endsAt: string | null;
  changes: EventChangeView[];
  page: number;
  hasMore: boolean;
}
export interface EventNotice extends EventChangeView {
  postId: string;
  title: string;
  readAt: string | null;
}
export interface EventNoticePage {
  items: EventNotice[];
  page: number;
  hasMore: boolean;
  unread: number;
}
export type RefundCause = "participant" | "host_cancel" | "schedule_change";
