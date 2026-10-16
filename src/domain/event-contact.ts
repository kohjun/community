import { z } from "zod";

export const EVENT_CONTACT_CHANNELS = ["phone", "email", "link"] as const;
export type EventContactChannel = (typeof EVENT_CONTACT_CHANNELS)[number];
export interface EventPrivateContactView {
  revision: number;
  canManage: boolean;
  contact: { channel: EventContactChannel; value: string; note: string } | null;
}
function normalizedValue(channel: EventContactChannel, value: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (channel === "phone") {
    if (!/^[+\d ()-]+$/.test(value)) return null;
    let phone = value.replace(/[ ()-]/g, "");
    if (phone.startsWith("+82")) phone = "0" + phone.slice(3).replace(/^0/, "");
    return /^(?:\+[1-9][0-9]{7,14}|0[1-9][0-9]{7,9})$/.test(phone) ? phone : null;
  }
  if (channel === "email") return z.email().safeParse(value).success ? value : null;
  try {
    const address = new URL(value);
    return /^https:\/\//i.test(value) &&
      address.protocol === "https:" &&
      address.hostname &&
      !address.username &&
      !address.password &&
      !/[\s\\]/.test(value)
      ? address.href
      : null;
  } catch {
    return null;
  }
}
const expectedRevision = z.number().int().min(0).max(2147483646);
export const eventPrivateContactPutSchema = z
  .strictObject({
    expectedRevision,
    channel: z.enum(EVENT_CONTACT_CHANNELS),
    value: z.string().trim().min(1).max(2048),
    note: z
      .string()
      .trim()
      .max(300)
      .refine(
        (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
        "안내 내용을 확인해주세요.",
      )
      .default(""),
  })
  .superRefine((value, context) => {
    if (normalizedValue(value.channel, value.value) === null)
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "올바른 전화번호, 이메일 또는 HTTPS 연락 링크를 입력해주세요.",
      });
  })
  .transform((value) => ({ ...value, value: normalizedValue(value.channel, value.value)! }));
export const eventPrivateContactDeleteSchema = z.strictObject({ expectedRevision });
