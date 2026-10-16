import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseReadinessPanel } from "../src/components/release-readiness";
import type { ReleaseReadiness } from "../src/domain/release-readiness";

const snapshot: ReleaseReadiness = {
  checkedAt: "2026-10-15T01:00:00.000Z",
  scope: "configuration-only",
  externalVerification: "not-performed",
  summary: { pass: 1, warn: 1, fail: 1 },
  checks: [
    {
      id: "authentication",
      status: "pass",
      message: "회원 인증 설정 형식 확인. 실제 로그인은 미확인.",
    },
    { id: "advertising", status: "warn", message: "광고 ID가 아직 준비되지 않았습니다." },
    { id: "image-storage", status: "fail", message: "저장소 설정 보완이 필요합니다." },
  ],
};
const render = (data: ReleaseReadiness) =>
  renderToStaticMarkup(createElement(ReleaseReadinessPanel, { data }));

test("configuration results show counts, redacted messages, and explicit limits rather than release approval", () => {
  const markup = render(snapshot);
  assert.match(markup, /실서비스 연결 준비/);
  assert.match(markup, /설정 형식 확인 결과/);
  assert.match(markup, /형식 확인됨/);
  assert.match(markup, /추가 확인/);
  assert.match(markup, /설정 보완/);
  assert.equal((markup.match(/<dd>1<span>개<\/span><\/dd>/g) ?? []).length, 3);
  assert.match(markup, /회원 인증 설정 형식 확인/);
  assert.match(markup, /외부 검증은 수행하지 않았어요/);
  assert.match(markup, /설정 보완은 서비스 장애를 뜻하지 않아요/);
  assert.match(markup, /사이트 승인을 의미하지 않아요/);
  assert.doesNotMatch(markup, /출시 가능|연결 성공 확인|승인 완료|환경변수 저장/);
});

test("unneeded setup steps stay out while actual operating verification remains pending even when all formats pass", () => {
  const markup = render({
    ...snapshot,
    summary: { pass: 3, warn: 0, fail: 0 },
    checks: snapshot.checks.map((check) => ({ ...check, status: "pass" })),
  });
  assert.match(markup, /실제 이용 흐름과 운영 복구 검증/);
  assert.match(markup, /외부 검증은 수행하지 않았어요/);
  assert.doesNotMatch(
    markup,
    /광고 계정과 광고 단위 준비|비공개 미디어 저장소 연결|서비스와 회원 인증 준비/,
  );
  const incomplete = render(snapshot);
  assert.match(incomplete, /광고 계정과 광고 단위 준비/);
  assert.match(incomplete, /비공개 미디어 저장소 연결/);
  assert.doesNotMatch(incomplete, /서비스와 회원 인증 준비/);
});

test("only allowlisted fields render and the sole form performs a read-only refresh", () => {
  const markup = render({
    ...snapshot,
    connectionUrl: "PRIVATE_DATABASE_CONNECTION",
    secret: "PRIVATE_UNRENDERED_KEY",
    checks: [
      {
        id: "PRIVATE_UNKNOWN_IDENTIFIER",
        status: "warn",
        message: "<script>unsafeMarkup()</script>",
        credentials: "PRIVATE_UNRENDERED_CREDENTIALS",
      },
    ],
  } as unknown as ReleaseReadiness);
  assert.match(markup, /기타 설정/);
  assert.ok(markup.includes("&lt;script&gt;unsafeMarkup()&lt;/script&gt;"));
  assert.doesNotMatch(
    markup,
    /PRIVATE_DATABASE_CONNECTION|PRIVATE_UNRENDERED_KEY|PRIVATE_UNKNOWN_IDENTIFIER|PRIVATE_UNRENDERED_CREDENTIALS|<script/,
  );
  assert.equal((markup.match(/<form/g) ?? []).length, 1);
  assert.match(markup, /action="\/admin\/readiness" method="get"/);
  assert.match(markup, /href="\/admin\/health"/);
  assert.doesNotMatch(markup, /method="post"|<input|<textarea|설정 저장|백업 실행|결제 실행/);
});
