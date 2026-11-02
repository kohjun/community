import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { REPORT_REASONS, reportInputSchema } from "../src/domain/safety";
import { ReportOriginalLink } from "../src/components/safety-center";

const id = "1714f183-3c54-4b53-b19e-453c80de45eb";

test("report validation accepts specific hate and sexual reasons and preserves existing reasons", () => {
  for (const reason of [
    "hate",
    "sexual",
    "spam",
    "fraud",
    "harassment",
    "privacy",
    "unsafe",
    "other",
  ]) {
    const result = reportInputSchema.parse({ targetType: "post", targetId: id, reason });
    assert.equal(result.reason, reason);
    assert.ok(REPORT_REASONS[result.reason]);
  }
  assert.equal(
    reportInputSchema.safeParse({ targetType: "post", targetId: id, reason: "automatic-ban" })
      .success,
    false,
  );
});

const original = (targetType: string, canReview: boolean, targetId = id) =>
  renderToStaticMarkup(
    createElement(ReportOriginalLink, { report: { targetType, targetId }, canReview }),
  );

test("review links stay staff-only, use validated internal routes and never invent comment parent routes", () => {
  for (const [targetType, path] of [
    ["post", `/posts/${id}`],
    ["record", `/records/${id}`],
    ["library", `/archive/${id}`],
    ["venue", `/map?place=${id}`],
    ["crew", `/crews/${id}`],
    ["player", `/players/${id}`],
  ]) {
    const markup = original(targetType!, true);
    assert.ok(markup.includes(`href="${path}"`));
    assert.match(markup, /noopener noreferrer/);
    assert.match(markup, /숨김·비공개/);
    assert.equal(original(targetType!, false), "");
  }
  assert.equal(original("comment", true), "");
  assert.equal(original("post", true, "javascript:alert(1)"), "");
  assert.equal(original("unknown", true), "");
});
