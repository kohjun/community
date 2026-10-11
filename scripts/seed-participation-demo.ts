import "dotenv/config";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { posts, profiles, eventSettings, roomMessages } from "../src/db/schema";
import { participationService } from "../src/server/participation-service";
const address = new URL(process.env.MIGRATION_DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev"
)
  throw new Error("Participation demo is local-only.");
function sampleId(name: string) {
  const hex = createHash("sha256").update(`sliper:sample:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const owner = sampleId("슬리퍼 콘텐츠팀"),
  postId = sampleId("participation-announcement-demo"),
  connection = createDatabase(address.href, 1),
  db = connection.db,
  service = participationService(db);
try {
  await db.execute(sql`insert into auth.users(id) values(${owner}) on conflict do nothing`);
  await db
    .insert(profiles)
    .values({ analyticsExcluded: true, id: owner, nickname: "슬리퍼 콘텐츠팀" })
    .onConflictDoNothing();
  await db
    .insert(posts)
    .values({
      id: postId,
      authorId: owner,
      sample: true,
      categorySlug: "party",
      kind: "모집",
      title: "[기능 체험] 신청하고 전용 공지방에 참여해보세요",
      bodyMarkdown:
        "## 참가 신청 · 공지방 기능 체험\n이 글은 실제 행사 모집이 아닌 로컬 기능 체험용 예시입니다.\n\n신청하기를 누르고 이름·연락처를 입력한 뒤, **테스트 결제 확인 (실제 결제 없음)** 버튼을 눌러보세요. 참가가 확정되면 전용 공지방에서 담당자 공지를 읽을 수 있습니다.\n\n예시 담당자가 만든 방이므로 참가자에게 메시지 입력창이 표시되지 않습니다. 실제 결제·정산·행사는 발생하지 않습니다.",
      location: "서울 · 테스트 장소",
      eventDate: "일정 미정 · 기능 체험용",
      eventFee: "테스트 금액 10,000원 · 실제 결제 없음",
      contactInfo: "샘플 공지방 체험용 모집글입니다.",
    })
    .onConflictDoNothing();
  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.authorId, owner), eq(posts.sample, true)));
  if (!post) throw new Error("Sample identity is already in use; no existing content was changed.");
  const [settings] = await db.select().from(eventSettings).where(eq(eventSettings.postId, postId));
  if (!settings)
    await service.configure(owner, postId, { amountKRW: 10000, capacity: 100, open: true });
  const [message] = await db
    .select({ id: roomMessages.id })
    .from(roomMessages)
    .where(eq(roomMessages.postId, postId))
    .limit(1);
  if (!message)
    await service.send(owner, postId, {
      body: "## 우리의 다음 에피소드에 오신 걸 환영해요!\n참가 신청이 확인되어 이 공지방에 자동 참여하셨어요.\n\n- 이 방에서는 담당자만 공지를 보낼 수 있습니다.\n- 참가자는 준비물과 일정을 읽고 확인할 수 있어요.\n- 실제 행사 안내가 아닌 **기능 체험용 예시 공지**입니다.\n\n실제 결제나 정산은 발생하지 않습니다.",
    });
  console.log(`Local participation demo: http://127.0.0.1:3000/events/${postId}`);
} finally {
  await connection.close();
}
