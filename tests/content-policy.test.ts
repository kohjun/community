import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import {
  CONTENT_POLICY_VERSION,
  evaluateContentPolicy,
  type ContentPolicyCategory,
} from "../src/domain/content-policy";

function blocked(text: string, category: ContentPolicyCategory = "profanity") {
  const result = evaluateContentPolicy([{ label: "본문", text }]);
  assert.equal(result.allowed, false, text);
  if (!result.allowed) {
    assert.equal(result.category, category);
    assert.equal(result.field, "본문");
    assert.ok(result.ruleId);
    return result;
  }
  assert.fail("Expected a blocked result");
}

test("content policy has a stable version and accepts empty fields", () => {
  assert.equal(CONTENT_POLICY_VERSION, "2026-10-18");
  assert.deepEqual(evaluateContentPolicy([]), { allowed: true });
  assert.deepEqual(evaluateContentPolicy([{ label: "소개", text: "" }]), { allowed: true });
});

test("explicit Korean abuse and bounded obfuscation are blocked", () => {
  for (const text of [
    "씨발",
    "시발",
    "너 개새끼야",
    "씨-발",
    "개 새 끼",
    "씨\u200b발",
    "좆_같다",
    "병신같은",
    "ㅆㅂ",
    "ㅅㅂ새끼",
    "ㅂㅅ새끼",
    "씨\u2060*발",
  ]) {
    blocked(text);
  }
});

test("English abuse uses case-insensitive full-word boundaries and NFKC", () => {
  for (const text of ["FUCK!", "ｆｕｃｋ", "you fucking loser", "motherfucker", "bitches"]) {
    blocked(text);
  }
  for (const text of ["Scunthorpe", "Scunthorpes", "classical", "butterfly", "fuckup_identifier"]) {
    assert.deepEqual(evaluateContentPolicy([{ label: "제목", text }]), { allowed: true }, text);
  }
});

test("event planning, dating, gender ratios, history and ordinary criticism stay allowed", () => {
  const values = [
    "남성 10명, 여성 10명으로 성비를 맞추는 연애 프로그램입니다.",
    "흑인 배우와 아시아인 배우가 출연한 영화 연출을 토론해요.",
    "섹스와 성교육에 관한 건강한 대화를 다루는 자료입니다.",
    "이번 이벤트는 미친 듯이 재밌었고 마지막 바보 역할도 좋았어요.",
    "이 규칙은 별로였어요. 진행자의 설명이 부족하다고 생각합니다.",
    "조선족 참가자를 차별하면 안 됩니다.",
    "성차별과 인종차별 발언을 신고해 주세요.",
    "시발점과 시발역, 시발열차에 대한 설명입니다.",
    "문제의 시 발 점을 파악하고 개발 계획을 세워요.",
    "도시 발전을 주제로 한 지역 이벤트예요.",
    "낚시 발판과 안전 장비를 준비해 주세요.",
    "한남역에서 만나 김치 요리를 배우는 모임입니다.",
    "병신년의 역사적 사건을 공부합니다.",
    "ㅅㅂ은 초성 퀴즈의 수박 정답입니다.",
    "성매매 피해 예방 안내와 조건만남 범죄 신고 절차",
    "불법촬영물 공유 금지. 사진은 동의를 받고 찍어 주세요.",
    "이 기사는 '여성은 열등하다는 주장'을 비판합니다.",
  ];
  for (const text of values) {
    assert.deepEqual(evaluateContentPolicy([{ label: "본문", text }]), { allowed: true }, text);
  }
});

test("a small explicit identity-slur set is blocked without matching plain identity labels", () => {
  for (const text of ["한남충", "한녀충", "김치녀", "칭챙총", "한남 충들", "김치\u200b녀"]) {
    blocked(text, "hate");
  }
  for (const text of ["한남", "여성", "남성", "흑인", "조선족"]) {
    assert.deepEqual(evaluateContentPolicy([{ label: "본문", text }]), { allowed: true }, text);
  }
});

test("concrete dehumanization and threats to a protected group are blocked", () => {
  for (const text of [
    "여자는 다 죽어야 한다.",
    "흑인은 사람이 아니다",
    "장애인들은 살 가치가 없다.",
    "남성은 모두 열등하다.",
    "성소수자는 말살해야 한다",
  ]) {
    blocked(text, "hate");
  }
});

test("concrete sexual-service offers and explicit-material distribution are blocked", () => {
  for (const text of [
    "성매매 예약 받습니다",
    "조건만남 문의 주세요",
    "성매매 가격표",
    "야동 무료 공유합니다",
    "야동 다운로드 링크",
    "불법촬영물 판매합니다",
    "아동성착취물 공유방",
  ]) {
    blocked(text, "sexual");
  }
});

test("fields, lines and sentences are not concatenated into invented offences", () => {
  const cases = [
    [
      { label: "제목", text: "씨" },
      { label: "본문", text: "발표해 주세요" },
    ],
    [{ label: "본문", text: "개\n새끼 고양이는 보호 중입니다." }],
    [{ label: "본문", text: "씨. 발아 과정을 살펴봅시다." }],
    [{ label: "본문", text: "개! 새끼 고양이 발견" }],
    [{ label: "본문", text: "씨    발아에 필요한 조건" }],
  ];
  for (const fields of cases) {
    assert.deepEqual(evaluateContentPolicy(fields), { allowed: true });
  }
});

test("rejection identifies the first field and never echoes abuse in the message", () => {
  const result = evaluateContentPolicy([
    { label: "제목", text: "정상 제목" },
    { label: "투표 선택지 2", text: "씨발" },
    { label: "태그", text: "개새끼" },
  ]);
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.field, "투표 선택지 2");
    assert.match(result.message, /투표 선택지 2.*욕설/);
    assert.match(result.message, /수정.*운영자/);
    assert.doesNotMatch(result.message, /씨발|개새끼|ko-explicit|blacklist/i);
  }
});

test("repeated evaluation is stateless and does not depend on an author's identity", () => {
  const fields = [{ label: "댓글", text: "씨발" }];
  assert.deepEqual(evaluateContentPolicy(fields), evaluateContentPolicy(fields));
  assert.deepEqual(evaluateContentPolicy([{ label: "댓글", text: "좋은 모임이었어요." }]), {
    allowed: true,
  });
  blocked("씨발");
});

test("large adversarial text completes within a generous linear-time budget", () => {
  const text = `${"여자_는 남성_은 씨___ 개___야동___".repeat(10_000)}끝`;
  const start = performance.now();
  assert.deepEqual(evaluateContentPolicy([{ label: "본문", text }]), { allowed: true });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 2_000, `Bounded patterns took ${elapsed.toFixed(1)} ms`);
  blocked(`${"a".repeat(100_000)} 씨발`);
});
