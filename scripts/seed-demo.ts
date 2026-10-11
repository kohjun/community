import "dotenv/config";
import { createHash } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { comments, mediaAssets, posts, profiles } from "../src/db/schema";
import { DEMO_COMMENTS, DEMO_POSTS } from "../src/demo/data";

const url = new URL(process.env.MIGRATION_DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw new Error("Demo seed only supports the isolated local Sliper database.");
const connection = createDatabase(url.toString(), 1);
const db = connection.db;
function sampleId(name: string) {
  const hex = createHash("sha256").update(`sliper:sample:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
try {
  const members = new Map(
    [...DEMO_POSTS, ...DEMO_COMMENTS].map((item) => [sampleId(item.author), item.author]),
  );
  members.set(sampleId("슬리퍼 콘텐츠팀"), "슬리퍼 콘텐츠팀");
  members.set("00000000-0000-4000-8000-000000000001", "슬리퍼 개발자");
  await db.transaction(async (tx) => {
    for (const [id, nickname] of members) {
      await tx.execute(sql`insert into auth.users (id) values (${id}) on conflict do nothing`);
      await tx
        .insert(profiles)
        .values({ analyticsExcluded: true, id, nickname })
        .onConflictDoNothing();
    }
    for (const [index, item] of DEMO_POSTS.entries()) {
      await tx
        .insert(posts)
        .values({
          id: item.id,
          authorId: sampleId(item.author),
          isAnonymous: item.anonymous,
          categorySlug: item.category,
          kind: item.kind,
          title: item.title,
          bodyMarkdown: item.body,
          featured: item.featured ?? false,
          sample: true,
          location: item.location ?? null,
          eventDate: item.eventDate ?? null,
          createdAt: new Date(Date.now() - index * 3600_000),
        })
        .onConflictDoNothing();
      if (item.image) {
        const source = path.join(process.cwd(), "public", item.image);
        const info = await stat(source);
        const id = sampleId(item.image),
          objectKey = `${id}.png`;
        await mkdir(".local/uploads", { recursive: true });
        await copyFile(source, path.join(".local/uploads", objectKey));
        await tx
          .insert(mediaAssets)
          .values({
            id,
            postId: item.id,
            uploaderId: sampleId(item.author),
            objectKey,
            contentType: "image/png",
            byteSize: info.size,
            status: "ready",
          })
          .onConflictDoNothing();
      }
    }
    const extraPosts: (typeof posts.$inferInsert)[] = [
      {
        id: sampleId("knowledge-mission"),
        categorySlug: "knowledge",
        topic: "미션",
        kind: "이야기",
        title: "팀 미션을 만들 때 먼저 정하면 좋은 세 가지",
        bodyMarkdown:
          "## 미션 설계 노트\n목표, 승리 조건, 안전 규칙을 먼저 정리해보세요. 동선은 짧게, 설명은 한 문장으로 시작하면 이해하기 쉬워요.\n\n※ 기능 확인용 예시 콘텐츠입니다.",
        tags: ["미션 설계", "팀워크"],
      },
      {
        id: sampleId("lab-blind-date"),
        categorySlug: "lab",
        topic: "소개팅 기법",
        kind: "이야기",
        title: "블라인드 소개팅, 첫 대화를 여는 미션을 연구해요",
        bodyMarkdown:
          "## 어떤 방식으로 대화를 열까요?\n취향 카드로 질문을 고른 뒤 서로의 공통점을 찾는 방식은 어떨까요? 익명 대화, 단계별 공개, 선택권을 보장하는 진행을 함께 연구해요.\n\n※ 기능 확인용 예시 콘텐츠입니다.",
        tags: ["블라인드 소개팅", "대화 미션"],
      },
      {
        id: sampleId("crew-mc"),
        categorySlug: "crew",
        topic: "MC",
        kind: "모집",
        title: "우리의 추리 에피소드를 함께 진행할 MC를 찾아요",
        bodyMarkdown:
          "## 함께 만드는 크루\n미션 설명과 팀별 진행을 함께할 MC 역할을 소개하는 예시입니다. 일정·역할·보상 조건을 본문에 자세히 안내해주세요.\n\n※ 실제 모집이 아닌 기능 확인용 예시입니다.",
        tags: ["MC", "추리게임"],
        location: "서울 · 예시 장소",
        eventDate: "일정 협의 · 예시",
        eventFee: "무료 · 예시",
        contactInfo: "실제 모집이 아닙니다. 작성 화면에서 직접 모집 양식을 확인해보세요.",
      },
      {
        id: sampleId("poll-next-mission"),
        categorySlug: "party",
        kind: "투표",
        title: "다음 에피소드, 어떤 미션이 가장 재밌을까요?",
        bodyMarkdown:
          "팀 미션, 블라인드 대화, 심리 추리 중 어떤 콘텐츠를 가장 좋아하나요? 투표하고 그 이유를 댓글로 나눠주세요.\n\n※ 투표 기능을 확인하는 예시이며 실제 행사를 예약하지 않습니다.",
        tags: ["다음 에피소드", "아이디어"],
        poll: {
          question: "함께 해보고 싶은 미션은?",
          options: ["팀 레이스", "블라인드 대화", "심리 추리"],
        },
      },
    ];
    for (const item of extraPosts)
      await tx
        .insert(posts)
        .values({ ...item, authorId: sampleId("슬리퍼 콘텐츠팀"), sample: true })
        .onConflictDoNothing();
    for (const [index, item] of DEMO_COMMENTS.entries()) {
      await tx
        .insert(comments)
        .values({
          id: item.id,
          postId: item.postId,
          parentId: item.parentId,
          authorId: sampleId(item.author),
          isAnonymous: item.anonymous,
          bodyMarkdown: item.body,
          createdAt: new Date(Date.now() - (DEMO_COMMENTS.length - index) * 60_000),
        })
        .onConflictDoNothing();
    }
  });
  console.log(
    "Local sample posts, images and comments seeded. Existing content was preserved; activity counts use real records.",
  );
} finally {
  await connection.close();
}
