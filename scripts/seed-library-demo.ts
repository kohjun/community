import "dotenv/config";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { libraryEntries } from "../src/db/library-schema";
import { libraryInputSchema } from "../src/domain/library";
const address = new URL(process.env.MIGRATION_DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  !["postgres:", "postgresql:"].includes(address.protocol) ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev"
)
  throw new Error("Library demo is local-only.");
function sampleId(name: string) {
  const h = createHash("sha256").update(`sliper:sample:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const connection = createDatabase(address.href, 1),
  db = connection.db,
  owner = "00000000-0000-4000-8000-000000000001";
const common = {
  minPlayers: 4,
  maxPlayers: 12,
  durationMinutes: 90,
  tags: ["실내", "팀플레이"],
  materials: ["참가자 이름표", "미션 카드", "화이트보드와 펜", "간단한 선물"],
  rounds: [
    { name: "팀 소개와 규칙 안내", seconds: 300 },
    { name: "첫 번째 미션", seconds: 600 },
    { name: "팀 전략 회의", seconds: 180 },
    { name: "마지막 라운드", seconds: 600 },
  ],
  scenario:
    "## 게임의 시작\n참가자는 두 팀으로 나뉘어 서로 다른 미션 카드를 받습니다. 미션을 수행하면서 상대 팀의 비밀 키워드를 알아내세요.\n\n## 진행 순서\n1. 진행자가 역할과 규칙을 안내합니다.\n2. 팀별 미션을 수행하고 단서를 모읍니다.\n3. 전략 회의에서 답안을 정합니다.\n4. 마지막 라운드에서 정답과 점수를 공개합니다.\n\n이 자료는 **허구의 로컬 기능 체험 예시**입니다. 실제 진행 검증을 받은 시나리오가 아닙니다.",
  rules:
    "## 점수와 안전 규칙\n- 미션 성공 2점, 상대 비밀 키워드 정답 3점\n- 역할 카드를 훔쳐보지 않습니다.\n- 신체 접촉과 위험한 미션은 사용하지 않습니다.\n- 참가자는 불편한 미션을 건너뛸 수 있습니다.\n- 최종 점수가 높은 팀이 승리합니다.",
  hostGuide:
    "## 오프닝\n‘오늘은 누가 가장 웃기고 기발한 팀이 될까요? 미션 카드를 확인해주세요.’\n\n## 라운드 전환\n‘지금부터 팀 전략 회의를 시작합니다. 서로의 아이디어를 존중하고 모두에게 발언 기회를 주세요.’\n\n## 마무리\n‘결과보다 중요한 건 오늘 함께 만든 장면입니다. 서로 수고했다는 인사를 나눠주세요.’",
};
const examples = [
  {
    name: "rulebook-secret-team",
    kind: "rulebook",
    categorySlug: "mind-games",
    title: "[예시] 비밀 키워드 팀 추리전",
    summary:
      "미션과 단서를 모아 상대 팀의 비밀 키워드를 찾는 가벼운 추리 게임. 시나리오·준비물·멘트·타이머를 무료로 체험하세요.",
    priceKRW: 0,
    purchaseUrl: null,
  },
  {
    name: "template-party",
    kind: "template",
    categorySlug: "party",
    title: "[예시] 퇴근 후 미션 파티",
    summary:
      "처음 보는 사람도 팀 미션으로 자연스럽게 친해지는 실내 파티. 일정과 장소를 더해 나만의 모임을 개설해보세요.",
    priceKRW: 0,
    purchaseUrl: null,
  },
  {
    name: "template-premium",
    kind: "template",
    categorySlug: "survival",
    title: "[예시] 마지막 팀 생존 토너먼트",
    summary:
      "팀별 협상과 전략 미션을 결합한 토너먼트의 유료 배포 UI 예시. 외부 구매 링크는 예시 주소이며 실제 구매·결제는 발생하지 않습니다.",
    priceKRW: 12000,
    purchaseUrl: "https://example.com/sliper-rulebook-demo",
  },
] as const;
try {
  await db.execute(sql`insert into auth.users(id) values(${owner}) on conflict do nothing`);
  await db
    .insert(profiles)
    .values({ analyticsExcluded: true, id: owner, nickname: "슬리퍼 로컬 운영자" })
    .onConflictDoNothing();
  for (const example of examples) {
    const id = sampleId(example.name),
      { name: _, ...meta } = example,
      value = libraryInputSchema.parse({ ...common, ...meta });
    await db
      .insert(libraryEntries)
      .values({ ...value, id, ownerId: owner, sample: true })
      .onConflictDoNothing();
    const [exists] = await db
      .select({ id: libraryEntries.id })
      .from(libraryEntries)
      .where(
        and(
          eq(libraryEntries.id, id),
          eq(libraryEntries.ownerId, owner),
          eq(libraryEntries.sample, true),
        ),
      );
    if (!exists) throw new Error("Sample identity in use; existing data was not modified.");
    console.log(
      `http://127.0.0.1:3000/${example.kind === "template" ? "templates" : "archive"}/${id}`,
    );
  }
  console.log(
    "Local library examples ready. Existing edits were preserved; no purchase or verified event was created.",
  );
} finally {
  await connection.close();
}
