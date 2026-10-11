import assert from "node:assert/strict";
import test from "node:test";
import { applicationUrlSchema, createPostSchema, updatePostSchema } from "../src/domain/validation";

const input = {
  categorySlug: "party",
  kind: "모집",
  title: "함께할 사람 모집",
  bodyMarkdown: "외부 플랫폼에서 신청해주세요.",
};

test("recruitment posts require an external link or complete direct event information", () => {
  assert.equal(createPostSchema.safeParse(input).success, false);
  assert.equal(
    updatePostSchema.safeParse({
      ...input,
      postId: "10000000-0000-4000-8000-000000000001",
      expectedUpdatedAt: "2026-01-01T00:00:00.123456Z",
    }).success,
    false,
  );
  const url = "https://example.com/events/apply?event=123&from=sliper#form";
  assert.equal(
    createPostSchema.parse({ ...input, applicationUrl: `  ${url}  ` }).applicationUrl,
    url,
  );
});

test("application URLs reject script schemes, relative destinations, credentials and malformed links", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,example",
    "//example.com/apply",
    "/apply",
    "https:",
    "https:example.com",
    "https://user:secret@example.com/apply",
    "https://example.com/\napply",
    "https://example.com\\@other.example",
    "",
  ]) {
    assert.equal(applicationUrlSchema.safeParse(value).success, false, value);
  }
  assert.equal(
    applicationUrlSchema.safeParse(`https://example.com/${"x".repeat(2048)}`).success,
    false,
  );
  assert.equal(
    applicationUrlSchema.parse("https://EXAMPLE.COM/apply"),
    "https://example.com/apply",
  );
  assert.equal(applicationUrlSchema.safeParse("http://example.com/apply").success, true);
});

test("ordinary posts cannot carry a recruitment link", () => {
  assert.equal(
    createPostSchema.safeParse({
      ...input,
      kind: "후기",
      applicationUrl: "https://example.com/apply",
    }).success,
    false,
  );
  assert.equal(createPostSchema.parse({ ...input, kind: "이야기" }).applicationUrl, null);
});

test("direct recruitment accepts venue, schedule and fee without an external link", () => {
  const details = {
    ...input,
    location: "서울 성수",
    eventDate: "10월 10일 14:00~17:00",
    eventFee: "무료",
    contactInfo: "댓글로 문의해주세요",
  };
  assert.equal(createPostSchema.parse(details).applicationUrl, null);
  assert.equal(
    updatePostSchema.parse({
      ...details,
      postId: "10000000-0000-4000-8000-000000000001",
      expectedUpdatedAt: "2026-01-01T00:00:00.123456Z",
    }).location,
    "서울 성수",
  );
  for (const key of ["location", "eventDate", "eventFee"] as const)
    assert.equal(createPostSchema.safeParse({ ...details, [key]: "  " }).success, false);
  assert.equal(createPostSchema.safeParse({ ...details, kind: "이야기" }).success, false);
});
