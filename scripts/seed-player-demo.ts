import "dotenv/config";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { posts, profiles, eventSettings, eventApplications, roomManagers } from "../src/db/schema";
import { playerPreferences, eventResults } from "../src/db/player-schema";
import { participationService } from "../src/server/participation-service";
import { playerService } from "../src/server/player-service";
import type { PlayerRole } from "../src/domain/player";
const address = new URL(process.env.MIGRATION_DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  !["postgres:", "postgresql:"].includes(address.protocol) ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev"
)
  throw new Error("Player demo is local-only.");
function sampleId(name: string) {
  const hex = createHash("sha256").update(`sliper:sample:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const owner = "00000000-0000-4000-8000-000000000001",
  postId = sampleId("player-result-demo"),
  connection = createDatabase(address.href, 1),
  db = connection.db,
  players = playerService(db),
  participation = participationService(db);
const demos: Array<{ id: string; nickname: string; preferredRole: PlayerRole; region: string }> = [
  {
    id: sampleId("player-demo-brain"),
    nickname: "예시 플레이어 · 두뇌형",
    preferredRole: "brain",
    region: "서울",
  },
  {
    id: sampleId("player-demo-physical"),
    nickname: "예시 플레이어 · 피지컬",
    preferredRole: "physical",
    region: "경기",
  },
  {
    id: sampleId("player-demo-trickster"),
    nickname: "예시 플레이어 · 트릭스터",
    preferredRole: "trickster",
    region: "부산",
  },
];
try {
  await db.execute(sql`insert into auth.users(id) values(${owner}) on conflict do nothing`);
  await db
    .insert(profiles)
    .values({ analyticsExcluded: true, id: owner, nickname: "슬리퍼 로컬 운영자" })
    .onConflictDoNothing();
  for (const demo of demos) {
    await db.execute(sql`insert into auth.users(id) values(${demo.id}) on conflict do nothing`);
    await db
      .insert(profiles)
      .values({
        analyticsExcluded: true,
        id: demo.id,
        publicId: sampleId(`player-public-${demo.preferredRole}`),
        nickname: demo.nickname,
        bio: "허구의 기능 체험용 플레이어입니다. 실제 참가자나 신뢰 전적이 아닙니다.",
        region: demo.region,
      })
      .onConflictDoNothing();
    // Only these explicitly fictional accounts opt in; existing users' privacy is preserved.
    await db
      .insert(playerPreferences)
      .values({
        userId: demo.id,
        preferredRole: demo.preferredRole,
        matchingVisible: true,
        historyPublic: true,
      })
      .onConflictDoNothing();
  }
  await db
    .insert(posts)
    .values({
      id: postId,
      authorId: owner,
      sample: true,
      categorySlug: "party",
      kind: "모집",
      title: "예능 파티 참가 전적 체험",
      location: "가상 공간 · 실제 행사 없음",
      eventDate: "완료된 행사 예시 · 실제 행사 없음",
      eventFee: "무료 기능 체험 · 실제 신청·결제 없음",
      bodyMarkdown:
        "## 플레이어 참가 전적과 매너 평가 체험\n이 행사는 허구의 **로컬 기능 체험**입니다. 실제 행사나 참가·결제가 이루어지지 않습니다.\n\n전적 관리에서 예시 참가자의 참가 여부·역할·우승을 확인하고 수정할 수 있습니다. 기존 전적을 변경하려면 사유를 적어주세요. 자신의 전적은 다른 지정 담당자가 확인해야 합니다.\n\n예시 행사의 전적은 프로필 상세에 **기능 체험**으로 표시되며 실제 참가 횟수·매너 온도·현장 검증에 포함되지 않습니다. 연락처는 `example.invalid`의 허구 데이터입니다.",
    })
    .onConflictDoNothing();
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post || post.authorId !== owner || !post.sample || post.status !== "published")
    throw new Error("Demo identity changed; existing data is preserved.");
  let [settings] = await db.select().from(eventSettings).where(eq(eventSettings.postId, postId));
  const initialSetup = !settings;
  if (!settings) {
    await participation.configure(owner, postId, {
      amountKRW: 0,
      capacity: 20,
      open: true,
      startsAt: "2020-01-01T01:00:00Z",
      endsAt: "2020-01-01T03:00:00Z",
    });
    [settings] = await db.select().from(eventSettings).where(eq(eventSettings.postId, postId));
  }
  if (
    settings?.amountKRW === 0 &&
    settings.endsAt &&
    settings.endsAt.getTime() < Date.now() &&
    !post.applicationUrl
  ) {
    const staff = demos[0]!.id;
    await db.insert(roomManagers).values({ postId, userId: staff }).onConflictDoNothing();
    for (const [index, userId] of [owner, ...demos.map((d) => d.id)].entries()) {
      const [existing] = await db
        .select({ id: eventApplications.id, status: eventApplications.status })
        .from(eventApplications)
        .where(and(eq(eventApplications.postId, postId), eq(eventApplications.userId, userId)))
        .limit(1);
      let applicationId = existing?.id;
      if (!existing) {
        // Replay fictional past registrations directly; the live application endpoint
        // correctly rejects new signups to an already started or closed event.
        await db.transaction(async (tx) => {
          await tx.select({ id: posts.id }).from(posts).where(eq(posts.id, postId)).for("update");
          const [application] = await tx
            .insert(eventApplications)
            .values({
              postId,
              userId,
              attendeeName: `허구의 참가자${index}`,
              contact: `player-demo-${index}@example.invalid`,
              note: "기능 체험용 허구의 참가 내역",
              amountKRW: 0,
              status: "confirmed",
              expiresAt: new Date("2020-01-01T04:00:00Z"),
              confirmedAt: new Date("2020-01-01T00:30:00Z"),
            })
            .returning({ id: eventApplications.id });
          applicationId = application!.id;
        });
      }
      const [result] = await db
        .select({ id: eventResults.applicationId })
        .from(eventResults)
        .where(and(eq(eventResults.postId, postId), eq(eventResults.userId, userId)));
      if (!result && applicationId && (!existing || existing.status === "confirmed"))
        await players.recordResult(userId === owner ? staff : owner, postId, {
          applicationId,
          presence: "attended",
          outcome: index === 0 ? "won" : "participated",
          observedRole: index === 0 ? "strategist" : demos[index - 1]!.preferredRole,
          reason: "허구의 기능 체험 기록 · 실제 참가·평가 집계 제외",
        });
    }
  }
  if (initialSetup)
    await participation.configure(owner, postId, { amountKRW: 0, capacity: 20, open: false });
  const [profile] = await db
    .select({ publicId: profiles.publicId })
    .from(profiles)
    .where(eq(profiles.id, owner));
  console.log("Local player directory: http://127.0.0.1:3000/players");
  console.log(`Local player profile: http://127.0.0.1:3000/players/${profile!.publicId}`);
  console.log(`Local record management: http://127.0.0.1:3000/management/events/${postId}`);
  console.log(
    "Fictional profiles only; sample attendance never contributes to actual reputation scores.",
  );
} finally {
  await connection.close();
}
