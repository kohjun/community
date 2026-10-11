import "dotenv/config";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { posts, profiles, eventSettings, eventApplications } from "../src/db/schema";
import { participationService } from "../src/server/participation-service";

const address = new URL(process.env.MIGRATION_DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  !["postgres:", "postgresql:"].includes(address.protocol) ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev"
)
  throw new Error("External participation demo is local-only.");

function sampleId(name: string) {
  const hex = createHash("sha256").update(`sliper:sample:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const owner = "00000000-0000-4000-8000-000000000001",
  postId = sampleId("external-participation-approval-demo"),
  connection = createDatabase(address.href, 1),
  db = connection.db,
  service = participationService(db);

try {
  await db.execute(sql`insert into auth.users(id) values(${owner}) on conflict do nothing`);
  await db
    .insert(profiles)
    .values({ analyticsExcluded: true, id: owner, nickname: "슬리퍼 로컬 운영자" })
    .onConflictDoNothing();
  await db
    .insert(posts)
    .values({
      id: postId,
      authorId: owner,
      sample: true,
      categorySlug: "party",
      kind: "모집",
      title: "[기능 체험] 외부 신청 승인과 참가 현황",
      bodyMarkdown:
        "## 외부 신청 참가 승인 · 관리 대시보드 체험\n이 글과 참가자는 로컬 기능 체험을 위한 **허구의 예시**입니다. 실제 행사 모집·외부 신청·결제·환불·정산은 발생하지 않습니다.\n\n외부 신청 링크는 `https://example.com/sliper-event-demo` 예시 주소이며 실제 신청 페이지가 아닙니다. 이름과 `example.invalid` 연락처, `DEMO-EXTERNAL` 신청 번호 역시 모두 허구입니다.\n\n**행사 관리 대시보드**에서 예시 참가자의 승인 대기 내역을 확인하고 승인·반려를 체험하세요. 승인된 참가자는 이 행사 전용 공지방에 자동 참여합니다. 승인·환불 확인은 기능 체험이며 실제 금전 처리를 실행하지 않습니다.\n\n스크립트를 다시 실행해도 기존 승인·반려·환불 상태와 행사 설정은 덮어쓰지 않습니다.",
      location: "테스트 장소 · 실제 행사 없음",
      eventDate: "일정 미정 · 로컬 기능 체험용",
      eventFee: "예시 금액 10,000원 · 실제 신청·결제 없음",
      applicationUrl: "https://example.com/sliper-event-demo",
      contactInfo: "허구의 예시 참가자로 승인·참가 현황을 확인하는 로컬 체험용 모집글입니다.",
    })
    .onConflictDoNothing();
  const [post] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.authorId, owner), eq(posts.sample, true)));
  if (!post) throw new Error("Sample identity is already in use; no existing content was changed.");

  let [settings] = await db.select().from(eventSettings).where(eq(eventSettings.postId, postId));
  if (!settings) {
    await service.configure(owner, postId, {
      amountKRW: 10000,
      capacity: 20,
      approvalMode: "manual",
      open: true,
    });
    [settings] = await db.select().from(eventSettings).where(eq(eventSettings.postId, postId));
  }

  for (let index = 1; index <= 3; index++) {
    const userId = sampleId(`external-participation-demo-member-${index}`);
    const [existing] = await db
      .select({ id: eventApplications.id })
      .from(eventApplications)
      .where(and(eq(eventApplications.postId, postId), eq(eventApplications.userId, userId)))
      .limit(1);
    // Preserve every existing outcome, including rejected, cancelled and refunded examples.
    if (existing || !settings?.open) continue;
    await db.execute(sql`insert into auth.users(id) values(${userId}) on conflict do nothing`);
    await db
      .insert(profiles)
      .values({
        analyticsExcluded: true,
        id: userId,
        publicId: sampleId(`external-participation-demo-profile-${index}`),
        nickname: `예시 참가자${index}`,
        bio: "로컬 기능 체험용 허구의 예시 계정입니다.",
      })
      .onConflictDoNothing();
    await service.claimExternal(userId, postId, {
      attendeeName: `예시 참가자${index}`,
      contact: `demo-${index}@example.invalid`,
      externalReference: `DEMO-EXTERNAL-${String(index).padStart(3, "0")}`,
      note: "허구의 신청 예시입니다. 실제 외부 신청·결제·개인정보는 없습니다.",
      consent: true,
    });
  }

  console.log(`Local external demo dashboard: http://127.0.0.1:3000/management/events/${postId}`);
  console.log(`Local external confirmation demo: http://127.0.0.1:3000/events/${postId}`);
  console.log("Demo entries only; no actual external application or payment occurs.");
} finally {
  await connection.close();
}
