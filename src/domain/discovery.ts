import { z } from "zod";
import { lightningCategorySchema } from "./lightning-categories";
import { applicationUrlSchema } from "./application-url";
export const venueSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  communityVenueId: z.uuid().optional(),
  communityVenueVersion: z.number().int().positive().optional(),
});
export type VenuePoint = z.infer<typeof venueSchema>;
export const lightningInputSchema = z
  .strictObject({
    categorySlug: z.enum([
      "travel",
      "dating",
      "race",
      "mind-games",
      "survival",
      "music",
      "sports",
      "cooking",
      "party",
    ]),
    activityCategory: lightningCategorySchema.optional(),
    activityTags: z
      .array(z.string().trim().min(1).max(24))
      .max(5)
      .refine((tags) => new Set(tags).size === tags.length, "활동 태그는 중복 없이 선택해주세요.")
      .default([]),
    title: z.string().trim().min(2).max(80),
    description: z.string().trim().min(10).max(3000),
    location: z.string().trim().min(2).max(120),
    venue: venueSchema,
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    capacity: z.number().int().min(2).max(12),
    priceKRW: z.number().int().min(0).max(10000000).default(0),
    applicationUrl: applicationUrlSchema.nullable().default(null),
  })
  .superRefine((value, context) => {
    if (value.priceKRW > 0 && !value.applicationUrl)
      context.addIssue({
        code: "custom",
        path: ["applicationUrl"],
        message: "유료 번개는 외부 신청·결제 링크를 연결해주세요. 슬리퍼 직접 참가는 무료예요.",
      });
    const duration = Date.parse(value.endsAt) - Date.parse(value.startsAt);
    if (duration < 15 * 60000 || duration > 12 * 3600000)
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "번개 진행 시간은 15분부터 12시간까지 설정해주세요.",
      });
  });
