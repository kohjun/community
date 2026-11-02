/**
 * A deliberately small, deterministic first line of defence.
 *
 * This is not a classifier: references, images, videos and ambiguous context
 * still need member reports and human moderation. Never use a match alone to
 * suspend an account or treat a non-match as proof that content is safe.
 */
export const CONTENT_POLICY_VERSION = "2026-10-18";

export type ContentPolicyCategory = "profanity" | "hate" | "sexual";
export interface ContentPolicyField {
  label: string;
  text: string;
}
export type ContentPolicyResult =
  | { allowed: true }
  | {
      allowed: false;
      category: ContentPolicyCategory;
      field: string;
      message: string;
      ruleId: string;
    };

interface Rule {
  id: string;
  category: ContentPolicyCategory;
  pattern: RegExp;
}

// Keep separators bounded, and preserve line/sentence boundaries. Concatenating
// all whitespace/punctuation could invent words that a member never wrote.
const GAP = "[\\t _*~·•-]{0,3}";
const WORD_END = "(?![\\p{L}\\p{N}])";
function phrase(value: string) {
  return Array.from(value.normalize("NFKC"))
    .map((letter) => letter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(GAP);
}
function choices(values: readonly string[]) {
  return `(?:${values.map(phrase).join("|")})`;
}
function normalize(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "");
}

const targets = choices([
  "여자",
  "여성",
  "남자",
  "남성",
  "흑인",
  "백인",
  "아시아인",
  "조선족",
  "장애인",
  "동성애자",
  "성소수자",
]);
const subjects = choices(["들은", "들이", "는", "은", "이", "가"]);
const quantifiers = choices(["전부", "모두", "다"]);
const hateClaims = choices([
  "죽어야한다",
  "죽어야해요",
  "죽어야해",
  "죽여야한다",
  "죽여야해요",
  "죽여야해",
  "죽여라",
  "말살해야한다",
  "열등하다",
  "사람이아니다",
  "벌레다",
  "살가치가없다",
]);

const rules: readonly Rule[] = [
  {
    id: "ko-explicit-abuse",
    category: "profanity",
    pattern: new RegExp(
      choices(["씨발", "씨빨", "개새끼", "씹새끼", "좆까", "좆같", "병신새끼", "병신아", "병신같"]),
      "u",
    ),
  },
  {
    id: "ko-sibal",
    category: "profanity",
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}])${phrase("시발")}(?!${GAP}${choices(["점", "역", "열차", "차역"])})`,
      "u",
    ),
  },
  {
    id: "ko-explicit-initial-abuse",
    category: "profanity",
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}])${phrase("ㅆㅂ")}${WORD_END}|${choices(["ㅅㅂ새끼", "ㅂㅅ새끼"])}`,
      "u",
    ),
  },
  {
    id: "en-explicit-abuse",
    category: "profanity",
    pattern:
      /(?<![\p{L}\p{N}_])(?:fuck(?:ing|ed|er|s)?|motherfuckers?|bitch(?:es)?|cunt(?:s)?)(?![\p{L}\p{N}_])/iu,
  },
  {
    id: "ko-explicit-identity-slur",
    category: "hate",
    pattern: new RegExp(choices(["한남충", "한녀충", "김치녀", "칭챙총"]), "u"),
  },
  {
    id: "ko-explicit-group-hate",
    category: "hate",
    pattern: new RegExp(
      `${targets}${GAP}${subjects}${GAP}(?:${quantifiers}${GAP})?${hateClaims}${WORD_END}`,
      "u",
    ),
  },
  {
    id: "ko-sexual-service-solicitation",
    category: "sexual",
    pattern: new RegExp(
      `${choices(["성매매", "조건만남"])}${GAP}${choices([
        "예약받습니다",
        "예약받아요",
        "문의주세요",
        "문의환영",
        "알선합니다",
        "가격표",
        "예약문의",
      ])}${WORD_END}`,
      "u",
    ),
  },
  {
    id: "ko-explicit-material-distribution",
    category: "sexual",
    pattern: new RegExp(
      `${choices(["야동", "불법촬영물", "몰카영상", "아동성착취물"])}${GAP}(?:${phrase("무료")}${GAP})?${choices(
        [
          "공유합니다",
          "공유해요",
          "공유방",
          "판매합니다",
          "판매해요",
          "배포합니다",
          "다운로드링크",
          "다운링크",
        ],
      )}${WORD_END}`,
      "u",
    ),
  },
];

const categoryLabels: Record<ContentPolicyCategory, string> = {
  profanity: "욕설",
  hate: "차별·혐오",
  sexual: "성적 서비스·음란물 홍보",
};

/**
 * Check each field independently. Callers should pass only text members intend
 * to publish, not identifiers, URLs, markup or concatenated JSON documents.
 * Existing request schemas remain responsible for field/overall size limits.
 * ruleId is for internal diagnostics and must not be sent as the user message.
 */
export function evaluateContentPolicy(fields: readonly ContentPolicyField[]): ContentPolicyResult {
  for (const field of fields) {
    const text = normalize(field.text);
    for (const rule of rules) {
      if (rule.pattern.test(text)) {
        return {
          allowed: false,
          category: rule.category,
          field: field.label,
          message: `${field.label}에 커뮤니티 정책상 제한되는 ${categoryLabels[rule.category]} 표현이 있습니다. 내용을 수정해 주세요. 잘못 감지되었다면 운영자에게 문의해 주세요.`,
          ruleId: rule.id,
        };
      }
    }
  }
  return { allowed: true };
}
