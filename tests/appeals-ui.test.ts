import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppealActionCard, AppealActionSummary } from "../src/components/appeals-center";
import { SupportReplyPanel } from "../src/components/safety-center";
import { APPEAL_PUBLIC_REASONS, type AppealAction } from "../src/domain/appeals";
import type { SupportView } from "../src/domain/safety";

const id = "479fd50a-d433-49f7-b0c8-afc9e744a7e4";
const ticketId = "8b44bd1b-330d-40c4-a2fd-7a478c503343";
const createdAt = "2026-10-14T01:00:00.000Z";
const action: AppealAction = {
  id,
  type: "suspend",
  scope: "계정",
  reason: APPEAL_PUBLIC_REASONS.suspend,
  createdAt,
  ticket: null,
};

test("public action summary renders only the published explanation and exact owner action link", () => {
  const enriched = {
    ...action,
    snapshot: "UNPUBLISHED_REPORT_TEXT",
    reporterId: "PRIVATE_REPORTER",
    staffId: "PRIVATE_STAFF",
    contact: "PRIVATE_CONTACT",
    internalReason: "INTERNAL_ACTION_NOTE",
  };
  const markup = renderToStaticMarkup(
    createElement(AppealActionSummary, {
      action: enriched,
      href: `/settings/appeals?actionId=${id}#action-${id}`,
    }),
  );
  assert.match(markup, /계정 이용 제한/);
  assert.match(markup, /커뮤니티 이용 기준과 관련해 계정 이용이 제한되었어요/);
  assert.match(markup, new RegExp(`href="/settings/appeals\\?actionId=${id}#action-${id}"`));
  assert.doesNotMatch(
    markup,
    /UNPUBLISHED_REPORT_TEXT|PRIVATE_REPORTER|PRIVATE_STAFF|PRIVATE_CONTACT|INTERNAL_ACTION_NOTE/,
  );
});

test("an existing appeal offers follow-up in the same request and distinguishes member opinions from staff answers", () => {
  const markup = renderToStaticMarkup(
    createElement(AppealActionCard, {
      action: {
        ...action,
        ticket: {
          id: ticketId,
          body: "이 조치에 대한 확인을 요청합니다.",
          status: "answered",
          revision: 3,
          createdAt,
          updatedAt: createdAt,
          replies: [
            { id: "member-opinion", body: "추가로 확인할 내용입니다.", role: "member", createdAt },
            { id: "staff-answer", body: "<script>response</script>", role: "staff", createdAt },
          ],
        },
      },
      busy: true,
      onSubmit: async () => true,
    }),
  );
  assert.match(markup, /답변 완료/);
  assert.match(markup, /나의 추가 의견/);
  assert.match(markup, /운영팀 답변/);
  assert.match(markup, /같은 신청 내역에 이어지고 재검토/);
  assert.match(markup, /disabled="">추가 의견 작성/);
  assert.match(markup, /&lt;script&gt;response&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /이의신청 작성|<script|name="nickname"|name="contact"/);
});

test("the original moderator or applicant cannot see an appeal reply form while independent staff can reply", () => {
  const ticket: SupportView = {
    id: ticketId,
    category: "account",
    subject: "조치 재검토",
    body: "확인과 재검토를 요청합니다.",
    status: "open",
    createdAt,
    replies: [],
    originalAction: action,
    canReply: false,
    revision: 3,
  };
  const blocked = renderToStaticMarkup(
    createElement(SupportReplyPanel, {
      item: ticket,
      busy: false,
      onReply: async () => {},
    }),
  );
  assert.match(blocked, /다른 운영자가 답변/);
  assert.doesNotMatch(blocked, /<form|<textarea|답변 저장/);
  const allowed = renderToStaticMarkup(
    createElement(SupportReplyPanel, {
      item: { ...ticket, canReply: true },
      busy: false,
      onReply: async () => {},
    }),
  );
  assert.match(allowed, /<form/);
  assert.match(allowed, /name="body"/);
  assert.match(allowed, /답변 저장/);
});
