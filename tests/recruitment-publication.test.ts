import assert from "node:assert/strict";
import { test } from "node:test";
import { createPostSchema, publishPostSchema } from "../src/domain/validation";
import { publishTemplateHostSchema } from "../src/domain/library";
const direct = {
  categorySlug: "party",
  kind: "모집",
  title: "주말 모임",
  bodyMarkdown: "함께 놀아요",
  location: "서울",
  eventDate: "토요일",
  eventFee: "무료",
};
test("public posting requires an external link even if all former direct fields are provided", () => {
  assert.equal(createPostSchema.safeParse(direct).success, true);
  const result = publishPostSchema.safeParse(direct);
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.issues[0]!.path[0], "applicationUrl");
  assert.equal(
    publishPostSchema.safeParse({ ...direct, applicationUrl: "https://example.com/apply" }).success,
    true,
  );
  assert.equal(
    publishPostSchema.safeParse({ ...direct, applicationUrl: "javascript:alert(1)" }).success,
    false,
  );
  assert.equal(
    publishPostSchema.safeParse({
      categorySlug: "party",
      kind: "이야기",
      title: "우리 이야기",
      bodyMarkdown: "반가워요",
    }).success,
    true,
  );
});
test("public template hosting requires an external application link", () => {
  const input = {
    title: "주말 모임",
    location: "서울",
    startsAt: "2099-01-01T03:00:00+09:00",
    endsAt: "2099-01-01T05:00:00+09:00",
    amountKRW: 10000,
    capacity: 6,
    description: "함께 즐겁게 게임하는 모임입니다.",
  };
  assert.equal(publishTemplateHostSchema.safeParse(input).success, false);
  assert.equal(
    publishTemplateHostSchema.safeParse({ ...input, applicationUrl: "https://example.com/apply" })
      .success,
    true,
  );
});
