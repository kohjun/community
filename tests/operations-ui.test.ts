import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OperationsQueueItem } from "../src/components/operations-center";
import type { OperationsItem } from "../src/domain/operations";

const id = "1f27a26e-b993-4e14-9327-a63c21993f73";
const item: OperationsItem = {
  kind: "support",
  id,
  sourceStatus: "open",
  stage: "pending",
  title: "행사 환불 문의",
  summary: "외부 플랫폼의 처리 내역을 확인해주세요.",
  category: "환불",
  createdAt: "2026-10-14T01:00:00.000Z",
  revision: 3,
  assignee: null,
  reviewStartedAt: null,
  dueAt: null,
  lastResponse: null,
  href: `/admin?tab=support&id=${id}`,
  allowedActions: ["claim"],
  canTriage: true,
};
const render = (overrides: Partial<OperationsItem> = {}, busy = false) =>
  renderToStaticMarkup(
    createElement(OperationsQueueItem, {
      item: { ...item, ...overrides },
      busy,
      onAction: () => {},
    }),
  );

test("triage controls require the server canTriage flag and permitted action list", () => {
  const permitted = render();
  assert.match(permitted, /내가 맡기/);
  assert.doesNotMatch(permitted, /검토 시작|담당 해제|<form/);
  const restricted = render({
    canTriage: false,
    allowedActions: ["claim", "start_review", "release", "set_due"],
  });
  assert.doesNotMatch(restricted, /<button|<form|type="datetime-local"/);
  assert.match(restricted, /href="\/admin\?tab=support&amp;id=1f27a26e/);
  assert.match(restricted, /내용·응답 이력 확인/);
});

test("review state comes from the server and deadline editing uses explicit Korean time", () => {
  const markup = render(
    {
      sourceStatus: "answered",
      stage: "reviewing",
      assignee: { publicId: id, nickname: "운영 담당", isMine: true, active: false },
      reviewStartedAt: "2026-10-14T02:00:00.000Z",
      dueAt: "2026-10-14T03:00:00.000Z",
      allowedActions: ["start_review", "release", "set_due"],
    },
    true,
  );
  assert.match(markup, /검토 중/);
  assert.match(markup, /운영 담당 · 나 · 확인 필요/);
  assert.match(markup, /한국 시간/);
  assert.match(
    markup,
    /<input(?=[^>]*type="datetime-local")(?=[^>]*value="2026-10-14T12:00")(?=[^>]*disabled="")[^>]*>/,
  );
  assert.match(markup, /disabled="">검토 시작/);
  assert.match(markup, /disabled="">담당 해제/);
  assert.match(markup, /disabled="">기한 해제/);
  assert.doesNotMatch(markup, /답변 완료|내가 맡기/);
});

test("completed disputes keep the exact original link and escape response text without processing controls", () => {
  const purchaseId = "6c45e98d-14d8-4589-8596-5e221db47928";
  const markup = render({
    kind: "dispute",
    stage: "completed",
    sourceStatus: "resolved",
    href: `/archive/purchases/${purchaseId}#dispute-${id}`,
    lastResponse: { body: "<script>alert('response')</script>", at: null },
    allowedActions: [],
    canTriage: false,
  });
  assert.match(markup, new RegExp(`href="/archive/purchases/${purchaseId}#dispute-${id}"`));
  assert.match(markup, /자료 거래 분쟁/);
  assert.match(markup, /최종 응답/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script|<button|<form|최종 응답 ·/);
});
