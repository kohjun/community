import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CrewAvatar,
  CrewJoinPanel,
  CrewMembers,
  CrewRequests,
  CrewActivityFeed,
  CrewContributions,
} from "../src/components/crew-parts";
import { appendCrewPage, crewDate } from "../src/lib/crew-client";
import type { CrewDetail, CrewJoinRequest, CrewPage } from "../src/domain/crew";
const id = "15119920-eecf-4e6a-ab59-01748e53c9b1",
  postId = "15119920-eecf-4e6a-ab59-01748e53c9b2";
const publicId = "15119920-eecf-4e6a-ab59-01748e53c9b3",
  managerId = "15119920-eecf-4e6a-ab59-01748e53c9b4";
const date = "2026-10-05T00:00:00.000Z";
const request: CrewJoinRequest = {
  id: "15119920-eecf-4e6a-ab59-01748e53c9b5",
  publicId,
  nickname: "새 멤버",
  avatar: "spark",
  message: "기획을 함께 하고 싶어요.",
  status: "pending",
  createdAt: date,
};
const crew: CrewDetail = {
  id,
  name: "즐거운 크루",
  description: "다음 예능 이벤트를 함께 만드는 크루예요.",
  category: "party",
  region: "서울",
  capacity: 20,
  recruiting: true,
  archived: false,
  memberCount: 2,
  eventCount: 0,
  contributionCount: 0,
  myRole: null,
  createdAt: date,
  updatedAt: date,
  members: [
    { publicId, nickname: "리더", avatar: "game", role: "owner", joinedAt: date },
    { publicId: managerId, nickname: "진행자", avatar: "smile", role: "member", joinedAt: date },
  ],
  myRequest: null,
  requests: null,
  activity: { items: [], total: 0, page: 1, nextPage: null },
  events: [],
  contributions: { items: [], total: 0, page: 1, nextPage: null },
};
const noop = () => {},
  mutate = async () => true;
const join = (overrides: Partial<CrewDetail> = {}, canWrite = true) =>
  renderToStaticMarkup(
    createElement(CrewJoinPanel, {
      crew: { ...crew, ...overrides },
      canWrite,
      busy: false,
      onMutate: mutate,
    }),
  );
const members = (overrides: Partial<CrewDetail> = {}) =>
  renderToStaticMarkup(
    createElement(CrewMembers, {
      crew: { ...crew, ...overrides },
      canWrite: true,
      busy: false,
      onMutate: mutate,
    }),
  );
test("crew join uses profile identity and requires explicit public nickname consent without collecting contact fields", () => {
  const markup = join();
  assert.match(markup, /가입 인사/);
  assert.match(markup, /type="checkbox"[^>]*required/);
  assert.match(markup, /프로필 아이콘이 크루 구성원 목록에 공개/);
  assert.match(markup, /disabled="">가입 신청/);
  assert.doesNotMatch(markup, /type="tel"|name="nickname"|name="contact"|<img/);
});
test("anonymous, full, closed and archived crews do not expose an active join form", () => {
  const anonymous = join({}, false);
  assert.match(anonymous, /\/login\?next=\/crews\//);
  assert.doesNotMatch(anonymous, /<form/);
  for (const overrides of [{ capacity: 2 }, { recruiting: false }, { archived: true }]) {
    const markup = join(overrides);
    assert.doesNotMatch(markup, /<form|가입 신청<\/button>/);
  }
});
test("pending requests expose withdrawal and approved members see their current role instead of another join", () => {
  const pending = join({ myRequest: request });
  assert.match(pending, /신청 취소/);
  assert.doesNotMatch(pending, /<textarea|type="checkbox"/);
  const joined = join({ myRole: "manager" });
  assert.match(joined, /운영진으로 함께/);
  assert.doesNotMatch(joined, /<form|신청 취소/);
});
test("only active crew owners see role changes and removal controls; managers and ordinary members can leave", () => {
  const owner = members({ myRole: "owner" });
  assert.equal((owner.match(/name="role"/g) ?? []).length, 1);
  assert.match(owner, /내보내기/);
  assert.match(owner, /리더는 운영 권한을/);
  for (const role of ["manager", "member"] as const) {
    const markup = members({ myRole: role });
    assert.doesNotMatch(markup, /name="role"|내보내기/);
    assert.match(markup, /탈퇴하기/);
  }
});
test("archived crew member lists remain public while all member mutation controls are removed", () => {
  const markup = members({ myRole: "owner", archived: true });
  assert.match(markup, /\/players\//);
  assert.match(markup, /리더/);
  assert.doesNotMatch(markup, /name="role"|내보내기|탈퇴하기/);
  assert.doesNotMatch(markup, /<img/);
});
test("profile avatar symbols never load a supplied arbitrary image URL", () => {
  const markup = renderToStaticMarkup(
    createElement(CrewAvatar, { nickname: "유저", avatar: "https://private.example/profile.png" }),
  );
  assert.match(markup, /프로필 아이콘/);
  assert.doesNotMatch(markup, /<img|private\.example/);
});
test("private request panels render only supplied manager data and escape application contents", () => {
  assert.equal(
    renderToStaticMarkup(
      createElement(CrewRequests, { page: null, busy: false, onDecision: noop, onMore: noop }),
    ),
    "",
  );
  const page: CrewPage<CrewJoinRequest> = {
    items: [{ ...request, message: "<img src=x onerror=alert(1)>" }],
    total: 1,
    page: 1,
    nextPage: 2,
  };
  const markup = renderToStaticMarkup(
    createElement(CrewRequests, { page, busy: false, onDecision: noop, onMore: noop }),
  );
  assert.match(markup, /운영진만 확인/);
  assert.match(markup, /신청 더 보기/);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(markup, /<img|userId|email|phone/);
});
test("public crew notices render Markdown safely and verified contributions link to actual post detail URLs", () => {
  const activity = renderToStaticMarkup(
    createElement(CrewActivityFeed, {
      page: {
        items: [
          {
            id: "a",
            kind: "announcement",
            message: "**준비물**\n<script>alert(1)</script>",
            nickname: "운영진",
            createdAt: date,
          },
        ],
        total: 1,
        page: 1,
        nextPage: null,
      },
      busy: false,
      onMore: noop,
    }),
  );
  assert.match(activity, /<strong>준비물<\/strong>/);
  assert.doesNotMatch(activity, /<script|<iframe/);
  const contribution = renderToStaticMarkup(
    createElement(CrewContributions, {
      page: {
        items: [
          {
            id: "a",
            postId,
            eventTitle: "추리 파티",
            nickname: "진행자",
            role: "MC",
            note: "현장 진행",
            createdAt: date,
          },
        ],
        total: 1,
        page: 1,
        nextPage: null,
      },
      busy: false,
      onMore: noop,
    }),
  );
  assert.match(contribution, new RegExp('href="/posts/' + postId + '"'));
  assert.match(contribution, /MC|현장 진행/);
});
test("crew pagination keeps one copy of each entry and ignores replayed older pages", () => {
  const first = {
    items: [
      { id: "a", value: 1 },
      { id: "b", value: 1 },
    ],
    total: 4,
    page: 1,
    nextPage: 2,
  };
  const next = {
    items: [
      { id: "b", value: 2 },
      { id: "c", value: 1 },
    ],
    total: 4,
    page: 2,
    nextPage: 3,
  };
  const merged = appendCrewPage(first, next);
  assert.deepEqual(merged.items, [
    { id: "a", value: 1 },
    { id: "b", value: 2 },
    { id: "c", value: 1 },
  ]);
  assert.equal(merged.nextPage, 3);
  assert.equal(appendCrewPage(merged, first), merged);
});
test("crew timestamps use Korean calendar dates and malformed values do not crash the interface", () => {
  assert.match(crewDate("2026-10-04T16:00:00.000Z"), /10\. 5\./);
  assert.equal(crewDate(null), "일정 미정");
  assert.equal(crewDate("broken"), "일정 미정");
});
