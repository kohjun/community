import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationSnippet, PARTICIPATION_COPY } from "../src/domain/notification-copy";
test("notification excerpts remove markdown syntax and media URLs and normalize newlines", () => {
  assert.equal(
    notificationSnippet(
      "**반가워요**\n[안내](https://example.com/private-token) ![사진](/private/asset)",
    ),
    "반가워요 안내 사진",
  );
  assert.equal(notificationSnippet("<img src=x onerror=alert(1)>안녕"), "안녕");
  assert.ok(!notificationSnippet("https://example.com/private?token=hidden").includes("token"));
});
test("notification text masks contacts, preserves emoji boundaries and limits length", () => {
  assert.equal(
    notificationSnippet("연락은 010-1234-5678 또는 hello@example.com"),
    "연락은 [연락처] 또는 [이메일]",
  );
  assert.equal(notificationSnippet("😎".repeat(20), 10), "😎".repeat(9) + "…");
  assert.notEqual(PARTICIPATION_COPY.confirmed!.title, PARTICIPATION_COPY.pending_approval!.title);
});
