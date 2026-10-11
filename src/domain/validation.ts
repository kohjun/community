import { DISCUSSION_TYPES } from "./discussions";
import { z } from "zod";
import { venueSchema } from "./discovery";
import { postDocumentSchema, postDocumentImageIds, postDocumentToMarkdown } from "./post-document";
import { CATEGORY_SLUGS } from "./categories";
import { AVATARS, BOARD_TOPICS } from "./boards";
import { normalizePhoneNumber, PROFILE_AGE_BANDS, PROFILE_GENDERS } from "./profile";

export const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
export const authProviderSchema = z.enum(["kakao", "google"]);
export const categorySlugSchema = z.enum(CATEGORY_SLUGS);
const markdown = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, "내용을 입력해주세요.");
const imageAssetIds = z
  .array(uuidSchema)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, "중복된 이미지입니다.");

import { applicationUrlSchema } from "./application-url";
export { applicationUrlSchema } from "./application-url";

export const pollInputSchema = z.strictObject({
  question: z
    .string()
    .trim()
    .min(2, "투표 주제를 2자 이상 입력해주세요.")
    .max(200, "투표 주제는 200자까지 입력할 수 있어요."),
  options: z
    .array(
      z
        .string()
        .trim()
        .min(1, "투표 선택지 내용을 입력해주세요.")
        .max(80, "선택지는 80자까지 입력할 수 있어요."),
    )
    .min(2)
    .max(8)
    .refine(
      (options) =>
        new Set(options.map((value) => value.toLocaleLowerCase())).size === options.length,
      "투표 항목은 서로 다르게 입력해주세요.",
    ),
});
const shortField = (max: number) => z.string().trim().max(max).nullable().default(null);
// Strict input objects prevent clients from supplying authorId, counts, etc.
const postInputSchema = z.strictObject({
  categorySlug: categorySlugSchema,
  kind: z.enum(["모집", "후기", "이야기", "투표"]).default("이야기"),
  applicationUrl: applicationUrlSchema.nullable().default(null),
  location: shortField(120),
  venue: venueSchema.nullable().optional(),
  eventDate: shortField(120),
  eventFee: shortField(120),
  contactInfo: shortField(300),
  discussionType: z.enum(DISCUSSION_TYPES).nullable().optional(),
  spoiler: z.boolean().optional(),
  spoilerTitle: z.string().trim().max(120).nullable().optional(),
  spoilerSummary: z.string().trim().max(200).nullable().optional(),
  topic: shortField(64),
  tags: z
    .array(z.string().trim().min(1).max(24))
    .max(5)
    .refine((tags) => new Set(tags).size === tags.length, "중복 태그를 제거해주세요.")
    .default([]),
  poll: pollInputSchema.nullable().default(null),
  title: z.string().trim().min(1).max(120),
  bodyMarkdown: z.string().max(30_000).default(""),
  bodyDocument: postDocumentSchema.nullable().optional(),
  isAnonymous: z.boolean().default(false),
  imageAssetIds: imageAssetIds.default([]),
});
function validateApplicationLink(value: z.infer<typeof postInputSchema>, context: z.RefinementCtx) {
  if (value.kind !== "이야기" && value.discussionType)
    context.addIssue({
      code: "custom",
      path: ["discussionType"],
      message: "말머리는 이야기 글에서 선택해주세요.",
    });
  if (value.spoiler && (value.kind === "모집" || !value.spoilerTitle?.trim()))
    context.addIssue({
      code: "custom",
      path: ["spoilerTitle"],
      message:
        "스포일러 없는 미리보기 제목을 입력해주세요. 모집글에는 스포일러를 설정할 수 없어요.",
    });
  if (!value.bodyDocument && !value.bodyMarkdown.trim())
    context.addIssue({ code: "custom", path: ["bodyMarkdown"], message: "내용을 입력해주세요." });
  if (
    value.bodyDocument &&
    postDocumentImageIds(value.bodyDocument).some((id) => !value.imageAssetIds.includes(id))
  )
    context.addIssue({
      code: "custom",
      path: ["bodyDocument"],
      message: "본문의 이미지는 첨부 목록에 포함되어야 해요.",
    });
  if (value.kind === "모집" && !value.applicationUrl)
    for (const field of ["location", "eventDate", "eventFee"] as const) {
      if (!value[field]?.trim())
        context.addIssue({
          code: "custom",
          path: [field],
          message: "직접 모집에는 장소, 일정·시간, 비용을 모두 입력해주세요.",
        });
    }
  if (
    value.kind !== "모집" &&
    [value.location, value.eventDate, value.eventFee, value.contactInfo, value.venue].some(Boolean)
  )
    context.addIssue({
      code: "custom",
      path: ["location"],
      message: "행사 정보는 모집글에만 입력해주세요.",
    });
  if ((value.kind === "투표") !== !!value.poll)
    context.addIssue({
      code: "custom",
      path: ["poll"],
      message: "투표글에는 주제와 2~8개 항목이 필요해요.",
    });
  if (
    value.categorySlug in BOARD_TOPICS &&
    (!value.topic ||
      !(
        BOARD_TOPICS[value.categorySlug as keyof typeof BOARD_TOPICS] as readonly string[]
      ).includes(value.topic))
  )
    context.addIssue({
      code: "custom",
      path: ["topic"],
      message: "게시판의 세부 주제를 선택해주세요.",
    });
  if (!(value.categorySlug in BOARD_TOPICS) && value.topic)
    context.addIssue({
      code: "custom",
      path: ["topic"],
      message: "세부 주제는 지식·연구소·크루 게시판에서 사용할 수 있어요.",
    });
  if (value.kind !== "모집" && value.applicationUrl)
    context.addIssue({
      code: "custom",
      path: ["applicationUrl"],
      message: "신청 링크는 모집글에만 사용할 수 있어요.",
    });
}
function derivePostBody<T extends z.infer<typeof postInputSchema>>(value: T): T {
  return {
    ...value,
    bodyMarkdown: value.bodyDocument
      ? postDocumentToMarkdown(value.bodyDocument)
      : value.bodyMarkdown,
  };
}
export const createPostSchema = postInputSchema
  .superRefine(validateApplicationLink)
  .transform(derivePostBody);
export const updatePostSchema = postInputSchema
  .extend({ postId: uuidSchema, expectedUpdatedAt: z.iso.datetime() })
  .superRefine(validateApplicationLink)
  .transform(derivePostBody);

export const createCommentSchema = z.strictObject({
  postId: uuidSchema,
  parentId: uuidSchema.nullable().default(null),
  bodyMarkdown: markdown(5_000),
  isAnonymous: z.boolean().default(false),
});
export const updateCommentSchema = z.strictObject({
  commentId: uuidSchema,
  bodyMarkdown: markdown(5_000),
});

export const setPostReactionSchema = z.strictObject({ postId: uuidSchema, active: z.boolean() });
export const recordPostViewSchema = z.strictObject({ postId: uuidSchema });
export const markNotificationReadSchema = z.strictObject({ notificationId: uuidSchema });
export const phoneNumberSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value) => normalizePhoneNumber(value) ?? "")
  .refine((value) => value !== "", "올바른 휴대폰 번호를 입력해주세요.");
export const profileInputSchema = z.strictObject({
  phoneNumber: z.preprocess(
    (value) => (value === "" ? null : value),
    phoneNumberSchema.nullable().optional(),
  ),
  ageBand: z.enum(PROFILE_AGE_BANDS).nullable().optional(),
  gender: z.enum(PROFILE_GENDERS).nullable().optional(),
  nickname: z.string().trim().min(2).max(24),
  bio: z.string().trim().max(300).default(""),
  region: z.string().trim().max(80).default(""),
  avatar: z.enum(AVATARS).default("spark"),
  interests: z
    .array(categorySlugSchema)
    .max(12)
    .refine((values) => new Set(values).size === values.length)
    .default([]),
});
export const onboardingInputSchema = profileInputSchema.extend({
  phoneNumber: phoneNumberSchema,
  consent: z.literal(true, { error: "기본정보 저장 안내에 동의해주세요." }),
});
export type OnboardingInput = z.infer<typeof onboardingInputSchema>;
export const voteInputSchema = z.strictObject({ optionIndex: z.number().int().min(0).max(7) });
export type ProfileInput = z.infer<typeof profileInputSchema>;
export const imageUploadSchema = z.strictObject({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  byteSize: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
