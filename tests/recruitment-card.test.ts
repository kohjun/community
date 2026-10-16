import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommunityPost } from "../src/domain/community";
import { CommunityRecruitmentCard } from "../src/components/community-recruitment-card";

const example: CommunityPost = {
  id: "8b067e61-82c8-44b1-8e0b-4c0b76b1b792",
  category: "party",
  kind: "모집",
  title: "금요일 함께하는 게임 모임",
  excerpt: "새로운 사람들과 함께 게임을 즐겨요.",
  body: "새로운 사람들과 함께 게임을 즐겨요.",
  author: "진행자",
  anonymous: false,
  time: "방금",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  likes: 4,
  views: 30,
  comments: 2,
  images: [],
  location: "서울 성수동",
  eventStartsAt: "2026-10-08T15:30:00Z",
  eventAmountKRW: 15000,
  applicationUrl: null,
  eventFee: null,
  contactInfo: null,
  topic: null,
  tags: ["보드게임"],
  poll: null,
  featured: false,
  sample: false,
  isMine: false,
  isLiked: false,
  isBookmarked: false,
};

function render(
  post: Partial<CommunityPost> = {},
  guards: { busy?: boolean; canWrite?: boolean } = {},
) {
  return renderToStaticMarkup(
    createElement(CommunityRecruitmentCard, {
      post: { ...example, ...post },
      busy: guards.busy ?? false,
      canWrite: guards.canWrite ?? true,
      onOpen() {},
      onLike() {},
      onSave() {},
      onTag() {},
    }),
  );
}

test("recruitment card shows real image, location, price and the Korean calendar date", () => {
  const html = render({ image: "/api/media/cover" });
  assert.ok(html.includes('src="/api/media/cover"'));
  assert.ok(html.includes("서울 성수동"));
  assert.ok(html.includes("15,000"));
  assert.ok(html.includes("10월 9일"));
  assert.ok(html.includes("00:30"));
  assert.ok(html.includes("금요일 함께하는 게임 모임"));
});

test("image array is used when the lead image is missing and no fake image is inserted", () => {
  const html = render({
    images: [{ id: "picture", src: "/api/media/picture", contentType: "image/webp", sortOrder: 0 }],
  });
  assert.ok(html.includes('src="/api/media/picture"'));
  assert.ok(!/<img\b/.test(render()));
});

test("unknown fees never become free while known zero and author fee text are retained", () => {
  assert.ok(render({ eventAmountKRW: 0 }).includes("무료"));
  assert.ok(!render({ eventAmountKRW: null }).includes("무료"));
  assert.ok(
    render({ eventAmountKRW: null, eventFee: "현장 결제 1만원" }).includes("현장 결제 1만원"),
  );
});

test("an invalid structured date preserves the author's date instead of showing Invalid Date", () => {
  const html = render({ eventStartsAt: "invalid", eventDate: "10월 둘째 주 금요일 저녁" });
  assert.ok(html.includes("10월 둘째 주 금요일 저녁"));
  assert.ok(!html.includes("Invalid Date"));
});

test("external applications preserve the new tab while cancelled cards show the cancellation route", () => {
  const external = render({ applicationUrl: "https://apply.example/event" });
  assert.ok(external.includes('href="https://apply.example/event"'));
  assert.ok(external.includes('target="_blank"'));
  assert.ok(external.includes('rel="noopener noreferrer"'));
  const cancelled = render({
    applicationUrl: "https://apply.example/event",
    eventCancelledAt: "2026-10-01T00:00:00Z",
  });
  assert.ok(cancelled.includes("모집 취소"));
  assert.ok(cancelled.includes("취소 안내 보기"));
  assert.ok(!cancelled.includes('href="https://apply.example/event"'));
});

test("reactions respect login and busy guards and every action remains outside post anchors", () => {
  for (const guards of [{ canWrite: false }, { busy: true }]) {
    const html = render({}, guards);
    const reactions = [...html.matchAll(/<button\b[^>]*>/g)]
      .map((match) => match[0])
      .filter((button) => /aria-label="[^"]*(좋아요|북마크)"/.test(button));
    assert.equal(reactions.length, 2);
    assert.ok(reactions.every((button) => button.includes('disabled=""')));
  }
  for (const anchor of render().matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
    assert.ok(!/<button\b|<a\b/.test(anchor[1] ?? ""));
  }
});

test("availability states reflect supplied values and cancellation takes priority", () => {
  assert.ok(render({ eventAvailable: true }).includes("모집 중"));
  assert.ok(render({ eventAvailable: false }).includes("모집 마감"));
  const unknown = render();
  assert.ok(!unknown.includes("모집 중"));
  assert.ok(!unknown.includes("모집 마감"));
  const cancelled = render({ eventAvailable: true, eventCancelledAt: "2026-10-01T00:00:00Z" });
  assert.ok(cancelled.includes("모집 취소"));
  assert.ok(!cancelled.includes("모집 중"));
});

test("card tag and reaction controls preserve one application link and readonly guards without duplicate statistics", () => {
  const html = render(
    {
      applicationUrl: "https://apply.example/one-event",
      tags: ["아주 긴 모집 태그 이름", "보드게임"],
      isLiked: true,
      isBookmarked: true,
    },
    { canWrite: false },
  );
  assert.equal((html.match(/href="https:\/\/apply.example\/one-event"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-label="조회 30회"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-label="댓글 2개"/g) ?? []).length, 1);
  assert.match(html, /#아주 긴 모집 태그 이름/);
  const reactions = [...html.matchAll(/<button\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((button) => /aria-label="[^"]*(좋아요|북마크)"/.test(button));
  assert.equal(reactions.length, 2);
  assert.ok(
    reactions.every(
      (button) => button.includes('disabled=""') && button.includes('aria-pressed="true"'),
    ),
  );
  for (const anchor of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g))
    assert.doesNotMatch(anchor[1] ?? "", /<button\b|<a\b/);
});
