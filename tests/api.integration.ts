import "dotenv/config";
import { installDevelopmentProfileFixture } from "./helpers/development-profile-fixture";
installDevelopmentProfileFixture();
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type {
  CommunityDetail,
  CommunityPost,
  CommunitySnapshot,
  CommentMutation,
  CommunityComment,
  InboxPage,
} from "../src/domain/community";
import type { ActionResult, PublicImage, CursorPage } from "../src/domain/contracts";

import { createDatabase } from "../src/db/connection";
import { posts, profiles } from "../src/db/schema";
import { awardActivity } from "../src/server/activity";
import { eq, sql } from "drizzle-orm";
import { participationService } from "../src/server/participation-service";
import type {
  EventOverview,
  RoomView,
  ParticipationHome,
  EventDashboard,
} from "../src/domain/participation";
import type { MyProfile } from "../src/domain/profile";

const origin = "http://127.0.0.1:3000";
if (process.env.LOCAL_DATABASE !== "1" || process.env.APP_ORIGIN !== origin)
  throw new Error("API tests require the isolated local development environment.");
let cookie = "";
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  // PATCH follows the public revision contract unless a regression supplies a stale token.
  if (
    method === "PATCH" &&
    path.startsWith("/posts/") &&
    body &&
    typeof body === "object" &&
    !("expectedUpdatedAt" in body)
  ) {
    const detail = data(await api<CommunityDetail>(path));
    body = { ...body, expectedUpdatedAt: detail.post.updatedAt };
  }
  const response = await fetch(`${origin}/api/community${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0]!;
  const result = (await response.json()) as ActionResult<T>;
  return { status: response.status, result, headers: response.headers };
}
function data<T>(value: { status: number; result: ActionResult<T> }): T {
  assert.equal(value.status, 200);
  if (!value.result.ok) throw new Error(value.result.error.message);
  return value.result.data;
}

test("local HTTP CRUD persists PostgreSQL rows, enforces ownership and origin, and serves uploaded media", async () => {
  const initial = data(await api<CommunitySnapshot>(""));
  assert.equal(initial.canWrite, true);
  assert.equal(initial.featured.length, 3);
  const feedPage = data(await api<CommunitySnapshot>("?limit=2"));
  assert.ok(feedPage.nextCursor);
  const nextFeed = data(await api<CommunitySnapshot>(`?limit=2&cursor=${feedPage.nextCursor}`));
  assert.equal(new Set([...feedPage.posts, ...nextFeed.posts].map((p) => p.id)).size, 4);
  assert.equal((await api(`?sort=popular&cursor=${feedPage.nextCursor}`)).status, 400);
  const inboxPage = data(await api<InboxPage>("/notifications?limit=1"));
  assert.ok(Array.isArray(inboxPage.items));
  assert.equal(typeof inboxPage.unreadCount, "number");
  const title = `[API 확인 ${randomUUID().slice(0, 8)}] CRUD`;
  const input = {
    categorySlug: "party",
    kind: "이야기",
    title,
    bodyMarkdown: "## DB 저장 테스트\n익명으로 함께해요.",
    isAnonymous: true,
    imageAssetIds: [] as string[],
  };
  const blocked = await api("/posts", "POST", input, { Origin: "https://untrusted.example" });
  assert.equal(blocked.status, 403);
  const forged = await api("/posts", "POST", { ...input, authorId: randomUUID() });
  assert.equal(forged.status, 400);
  const forbidden = await api(`/posts/${initial.featured[0]!.id}`, "PATCH", input);
  assert.equal(forbidden.status, 403);
  const fake = new FormData();
  fake.append("file", new Blob(["not an image"], { type: "image/png" }), "fake.png");
  assert.equal((await api("/uploads", "POST", fake)).status, 400);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(await readFile("public/images/mystery.png"))], { type: "image/png" }),
    "mystery.png",
  );
  const upload = data(await api<PublicImage>("/uploads", "POST", form));
  input.imageAssetIds = [upload.id];
  const post = data(await api<CommunityPost>("/posts", "POST", input));
  try {
    assert.equal(post.isMine, true);
    assert.equal(post.author, "익명");
    assert.equal(post.images[0]!.id, upload.id);
    const read = data(await api<CommunityDetail>(`/posts/${post.id}`));
    assert.equal(read.post.title, title);
    assert.equal(read.post.body, input.bodyMarkdown);
    const mine = data(await api<CommunitySnapshot>("?view=mine"));
    assert.ok(mine.posts.some((p) => p.id === post.id));
    const imageResponse = await fetch(`${origin}${upload.src}`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/webp");
    const updated = data(
      await api<CommunityPost>(`/posts/${post.id}`, "PATCH", {
        ...input,
        title: `${title} 수정`,
        kind: "후기",
      }),
    );
    assert.equal(updated.kind, "후기");
    const recruitment = data(
      await api<CommunityPost>(`/posts/${post.id}`, "PATCH", {
        ...input,
        kind: "모집",
        applicationUrl: "https://example.com/apply?event=123",
      }),
    );
    assert.equal(recruitment.applicationUrl, "https://example.com/apply?event=123");
    assert.equal(
      data(await api<CommunityDetail>(`/posts/${post.id}`)).post.applicationUrl,
      recruitment.applicationUrl,
    );
    assert.equal(
      (
        await api(`/posts/${post.id}`, "PATCH", {
          ...input,
          kind: "모집",
          applicationUrl: "javascript:alert(1)",
        })
      ).status,
      400,
    );
    await api(`/posts/${post.id}/like`, "POST", { active: true });
    await api(`/posts/${post.id}/like`, "POST", { active: true });
    await api(`/posts/${post.id}/bookmark`, "POST", { active: true });
    const saved = data(await api<CommunitySnapshot>("?view=bookmarks"));
    assert.ok(saved.posts.some((p) => p.id === post.id));
    const firstView = data(await api<CommunityPost>(`/posts/${post.id}/view`, "POST", {}));
    assert.ok(cookie.startsWith("sliper-visitor="));
    const secondView = data(await api<CommunityPost>(`/posts/${post.id}/view`, "POST", {}));
    assert.equal(firstView.views, secondView.views);
    assert.equal(secondView.likes, 1);
    const first = data(
      await api<CommentMutation>("/comments", "POST", {
        postId: post.id,
        bodyMarkdown: "부모 댓글",
        isAnonymous: true,
      }),
    );
    const parentId = first.comment.id;
    await api("/comments", "POST", { postId: post.id, parentId, bodyMarkdown: "답글" });
    await api(`/comments/${parentId}`, "PATCH", { bodyMarkdown: "수정 댓글" });
    const removed = data(await api<CommentMutation>(`/comments/${parentId}`, "DELETE"));
    assert.equal(removed.comment.isDeleted, true);
    assert.equal(
      data(
        await api<CursorPage<CommunityComment>>(`/posts/${post.id}/comments?parentId=${parentId}`),
      ).items[0]!.parentId,
      parentId,
    );
    assert.equal(removed.post.comments, 1);
    for (let i = 0; i < 3; i++)
      data(
        await api<CommentMutation>("/comments", "POST", {
          postId: post.id,
          bodyMarkdown: `페이지 댓글 ${i}`,
        }),
      );
    const commentPage = data(
      await api<CursorPage<CommunityComment>>(`/posts/${post.id}/comments?limit=2`),
    );
    assert.ok(commentPage.nextCursor);
    const nextComments = data(
      await api<CursorPage<CommunityComment>>(
        `/posts/${post.id}/comments?limit=2&cursor=${commentPage.nextCursor}`,
      ),
    );
    assert.equal(new Set([...commentPage.items, ...nextComments.items].map((c) => c.id)).size, 4);
    assert.equal(
      (
        await api(
          `/posts/${post.id}/comments?parentId=${parentId}&cursor=${commentPage.nextCursor}`,
        )
      ).status,
      400,
    );
    assert.equal(JSON.stringify(removed).includes("authorId"), false);
  } finally {
    assert.equal((await api(`/posts/${post.id}`, "DELETE")).status, 200);
  }
  assert.equal((await api(`/posts/${post.id}`)).status, 404);
  assert.equal((await fetch(`${origin}${upload.src}`)).status, 404);
});

test("new boards, direct recruitment, polls and private profile endpoints persist actual PostgreSQL data", async () => {
  const original = data(await api<MyProfile>("/me"));
  assert.equal((await api("/me", "PATCH", { nickname: "위조점수", points: 999999 })).status, 400);
  const basic = {
    nickname: original.nickname,
    bio: original.bio,
    region: original.region,
    avatar: original.avatar,
    interests: original.interests,
  };
  const ids: string[] = [];
  try {
    const saved = data(
      await api<MyProfile>("/me", "PATCH", { ...basic, bio: "[API 확인] 프로필 소개" }),
    );
    assert.equal(saved.bio, "[API 확인] 프로필 소개");
    const visits = data(await api<MyProfile>("/me/visit", "POST", {}));
    const repeat = data(await api<MyProfile>("/me/visit", "POST", {}));
    assert.equal(repeat.points, visits.points);
    const common = {
      categorySlug: "crew",
      topic: "MC",
      title: "[API 확인] 함께 만드는 크루",
      bodyMarkdown: "함께할 진행자를 구해요.",
      tags: ["진행자", "예능 파티"],
    };
    const direct = data(
      await api<CommunityPost>("/posts", "POST", {
        ...common,
        kind: "모집",
        location: "서울 성수",
        eventDate: "10월 10일 14:00",
        eventFee: "무료",
      }),
    );
    ids.push(direct.id);
    assert.equal(direct.applicationUrl, null);
    assert.equal(direct.eventFee, "무료");
    assert.equal(
      data(
        await api<CommunitySnapshot>("?category=crew&topic=MC&tag=%EC%A7%84%ED%96%89%EC%9E%90"),
      ).posts.some((post) => post.id === direct.id),
      true,
    );
    const pollInput = {
      ...common,
      categorySlug: "lab",
      topic: "미션 설계",
      kind: "투표",
      poll: { question: "어떤 미션이 좋을까요?", options: ["팀 레이스", "블라인드 추리"] },
    };
    const poll = data(await api<CommunityPost>("/posts", "POST", pollInput));
    ids.push(poll.id);
    assert.equal(
      (
        await api(
          `/posts/${poll.id}/vote`,
          "POST",
          { optionIndex: 0 },
          { Origin: "https://untrusted.example" },
        )
      ).status,
      403,
    );
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        api<CommunityPost>(`/posts/${poll.id}/vote`, "POST", { optionIndex: 0 }),
      ),
    );
    for (const result of results) assert.equal(data(result).poll?.total, 1);
    const changed = data(
      await api<CommunityPost>(`/posts/${poll.id}/vote`, "POST", { optionIndex: 1 }),
    );
    assert.equal(changed.poll?.options[1]?.votes, 1);
    assert.equal(changed.poll?.selected, 1);
    assert.equal(
      (
        await api(`/posts/${poll.id}`, "PATCH", {
          ...pollInput,
          poll: { question: "투표 후 변경", options: ["A", "B"] },
        })
      ).status,
      409,
    );
    assert.equal((await api(`/posts/${poll.id}/vote`, "POST", { optionIndex: 7 })).status, 400);
    const highlights = data(
      await api<{ featured: CommunityPost[]; hot: CommunityPost[] }>("/highlights"),
    );
    assert.ok(Array.isArray(highlights.hot));
    for (const path of ["/", "/mypage", "/login"]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200);
    }
  } finally {
    for (const id of ids) assert.equal((await api(`/posts/${id}`, "DELETE")).status, 200);
    data(await api<MyProfile>("/me", "PATCH", basic));
  }
});

// A real multi-connection test: PGlite's single engine cannot model this lock cycle.
test("activity awards coexist with foreign-key locks during simultaneous different-post writes", async () => {
  const url = new URL(process.env.DATABASE_URL || "http://missing");
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/sliper_dev")
    throw new Error("Concurrency test requires isolated local PostgreSQL");
  const connection = createDatabase(url.toString(), 2),
    actor = randomUUID(),
    ids = [randomUUID(), randomUUID()];
  let arrived = 0;
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await connection.db.execute(sql`insert into auth.users(id) values(${actor})`);
    await connection.db.insert(profiles).values({ id: actor, nickname: "동시성검사" });
    const results = await Promise.allSettled(
      ids.map((id) =>
        connection.db.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout='5s'`);
          await tx.insert(posts).values({
            id,
            authorId: actor,
            categorySlug: "party",
            title: "[동시성 검사] 임시 글",
            bodyMarkdown: "프로필 외래키 잠금 검사",
          });
          if (++arrived === ids.length) release();
          await barrier;
          await awardActivity(tx, actor, "post", id);
        }),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      2,
      "Parallel writes must not deadlock or time out",
    );
    const [total] = await connection.db.execute<{ points: number }>(
      sql`select coalesce(sum(points),0)::int as points from sliper.activity_events where user_id=${actor}`,
    );
    assert.equal(total?.points, 10);
  } finally {
    for (const id of ids) await connection.db.delete(posts).where(eq(posts.id, id));
    await connection.db.execute(sql`delete from auth.users where id=${actor}`);
    await connection.close();
  }
});

test("HEAD remains read-only and malformed multipart input returns validation rather than a server error", async () => {
  const head = await fetch(`${origin}/api/community`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const response = await fetch(`${origin}/api/community/uploads`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "multipart/form-data; boundary=broken" },
    body: "not multipart",
  });
  assert.equal(response.status, 400);
  const result = (await response.json()) as ActionResult<unknown>;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "VALIDATION");
});

test("activity timestamps use the reward moment rather than an earlier transaction start", async () => {
  const url = new URL(process.env.DATABASE_URL || "http://missing");
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/sliper_dev")
    throw new Error("Requires isolated local PostgreSQL");
  const connection = createDatabase(url.toString(), 1),
    actor = randomUUID();
  try {
    await connection.db.execute(sql`insert into auth.users(id) values(${actor})`);
    await connection.db.insert(profiles).values({ id: actor, nickname: "적립시각검사" });
    await connection.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_sleep(0.05)`);
      const [threshold] = await tx.execute<{ time: string }>(
        sql`select clock_timestamp()::text as time`,
      );
      await awardActivity(tx, actor, "visit");
      const [event] = await tx.execute<{ valid: boolean }>(
        sql`select created_at >= ${threshold!.time}::timestamptz as valid from sliper.activity_events where user_id=${actor}`,
      );
      assert.equal(
        event?.valid,
        true,
        "Rewards must not be dated at transaction start before a lock wait",
      );
    });
  } finally {
    await connection.db.execute(sql`delete from auth.users where id=${actor}`);
    await connection.close();
  }
});

test("parallel edits based on the same revision save once and reject stale content with 409", async () => {
  const input = {
    categorySlug: "party",
    kind: "이야기",
    title: "[API 확인] 편집 충돌",
    bodyMarkdown: "같은 글을 두 탭에서 열었어요.",
  };
  const post = data(await api<CommunityPost>("/posts", "POST", input));
  try {
    const results = await Promise.all(
      ["첫 번째 편집", "두 번째 편집"].map((title) =>
        api<CommunityPost>(`/posts/${post.id}`, "PATCH", {
          ...input,
          title,
          expectedUpdatedAt: post.updatedAt,
        }),
      ),
    );
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    const saved = results.find((result) => result.status === 200)!;
    assert.equal(
      data(await api<CommunityDetail>(`/posts/${post.id}`)).post.title,
      data(saved).title,
    );
    const noRevision = await fetch(`${origin}/api/community/posts/${post.id}`, {
      method: "PATCH",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    assert.equal(noRevision.status, 400);
  } finally {
    assert.equal((await api(`/posts/${post.id}`, "DELETE")).status, 200);
  }
});

test("localhost Chrome requests can open posts and count views while cross-origin aliases stay blocked", async () => {
  const alternate = "http://localhost:3000";
  const feed = data(await api<CommunitySnapshot>(""));
  const id = feed.posts[0]!.id;
  for (const base of [origin, alternate]) {
    const response = await fetch(`${base}/api/community/posts/${id}`);
    assert.equal(response.status, 200);
    const view = await fetch(`${base}/api/community/posts/${id}/view`, {
      method: "POST",
      headers: {
        Origin: base,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(view.status, 200);
  }
  const denied = await fetch(`${origin}/api/community/posts/${id}/view`, {
    method: "POST",
    headers: { Origin: alternate, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  const visit = await fetch(`${alternate}/api/community/me/visit`, {
    method: "POST",
    headers: { Origin: alternate, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(visit.status, 200);
});

async function participationApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
  originHeader = origin,
) {
  const response = await fetch(`${origin}/api/participation${path}`, {
    method,
    headers: { Origin: originHeader, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, result: (await response.json()) as ActionResult<T> };
}
test("internal applications, local payment confirmation, announcement stream and staff rights persist in PostgreSQL", async () => {
  const post = data(
    await api<CommunityPost>("/posts", "POST", {
      categorySlug: "party",
      kind: "모집",
      title: `[참가 흐름 확인 ${randomUUID().slice(0, 8)}]`,
      bodyMarkdown: "행사 테스트",
      isAnonymous: true,
      location: "서울",
      eventDate: "토요일 오후",
      eventFee: "1인 10,000원",
      imageAssetIds: [],
    }),
  );
  const connection = createDatabase(process.env.DATABASE_URL!, 2),
    service = participationService(connection.db),
    participant = randomUUID();
  const actor = "00000000-0000-4000-8000-000000000001";
  try {
    assert.equal(
      (
        await participationApi(
          `/events/${post.id}/settings`,
          "PUT",
          { amountKRW: 10000, capacity: 2, open: true },
          "https://evil.example",
        )
      ).status,
      403,
    );
    data(
      await participationApi<EventOverview>(`/events/${post.id}/settings`, "PUT", {
        amountKRW: 10000,
        capacity: 2,
        open: true,
      }),
    );
    const app = data(
      await participationApi<EventOverview>(`/events/${post.id}/applications`, "POST", {
        note: "",
        consent: true,
      }),
    ).application!;
    assert.equal(app.status, "pending_payment");
    assert.ok(app.orderId);
    assert.equal(
      (
        await participationApi(
          `/orders/${app.orderId}/simulate`,
          "POST",
          { status: "paid" },
          "https://evil.example",
        )
      ).status,
      403,
    );
    data(await participationApi(`/orders/${app.orderId}/simulate`, "POST", { status: "paid" }));
    assert.equal(
      data(await participationApi<EventOverview>(`/events/${post.id}`)).application?.status,
      "confirmed",
    );
    assert.ok(
      data(await participationApi<ParticipationHome>("/me")).rooms.some(
        (room) => room.postId === post.id,
      ),
    );
    data(
      await participationApi<RoomView>(`/rooms/${post.id}/messages`, "POST", {
        body: "## 만나는 장소\n오후 2시에 만나요.",
      }),
    );
    const controller = new AbortController();
    const stream = await fetch(`${origin}/api/participation/rooms/${post.id}/stream`, {
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    assert.ok(stream.headers.get("content-type")?.startsWith("text/event-stream"));
    const reader = stream.body!.getReader();
    try {
      const chunk = await reader.read();
      assert.ok(new TextDecoder().decode(chunk.value).includes("event: room"));
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
    // Different actors are exercised directly against the same PostgreSQL service,
    // without introducing any browser header that can impersonate a user.
    await connection.db.execute(sql`insert into auth.users(id) values(${participant})`);
    await connection.db.insert(profiles).values({
      id: participant,
      nickname: "읽기전용테스트",
      phoneNumber: "01012345678",
      profileCompletedAt: new Date(),
      onboardingConsentAt: new Date(),
    });
    const other = (await service.apply(participant, post.id, { consent: true }, "bridge-test"))
      .application!;
    await assert.rejects(service.room(participant, post.id));
    await service.payment("bridge-test", {
      eventId: `paid-${other.orderId}`,
      orderId: other.orderId!,
      paymentId: `receipt-${other.orderId}`,
      amountKRW: 10000,
      currency: "KRW",
      status: "paid",
    });
    assert.equal((await service.room(participant, post.id)).canWrite, false);
    await assert.rejects(service.send(participant, post.id, { body: "forbidden" }));
    const [member] = await connection.db
      .select({ publicId: profiles.publicId })
      .from(profiles)
      .where(eq(profiles.id, participant));
    await service.setManager(actor, post.id, { publicId: member!.publicId, enabled: true });
    assert.equal((await service.room(participant, post.id)).canWrite, true);
    await service.setManager(actor, post.id, { publicId: member!.publicId, enabled: false });
    assert.equal((await service.room(participant, post.id)).canWrite, false);
    await service.payment("bridge-test", {
      eventId: `refund-${other.orderId}`,
      orderId: other.orderId!,
      paymentId: `receipt-${other.orderId}`,
      amountKRW: 10000,
      currency: "KRW",
      status: "refunded",
    });
    await assert.rejects(service.room(participant, post.id));
    const page = await fetch(`${origin}/events/${post.id}`);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes("나의 참가 신청"));
    const roomPage = await fetch(`${origin}/rooms/${post.id}`);
    assert.equal(roomPage.status, 200);
    assert.ok((await roomPage.text()).includes("새 공지 작성"));
    assert.equal(
      (
        await participationApi(`/events/${post.id}/settings`, "PUT", {
          amountKRW: 0,
          capacity: 1,
          open: false,
        })
      ).status,
      200,
    );
  } finally {
    // Remove only this test's payment audit and event, preserving real local content.
    await connection.db.execute(
      sql`delete from sliper.payment_events where order_id in(select o.id from sliper.payment_orders o join sliper.event_applications a on a.id=o.application_id where a.post_id=${post.id})`,
    );
    await connection.db.execute(
      sql`delete from sliper.payment_orders where application_id in(select id from sliper.event_applications where post_id=${post.id})`,
    );
    await connection.db.execute(
      sql`delete from sliper.event_applications where post_id=${post.id}`,
    );
    await connection.db.execute(sql`delete from auth.users where id=${participant}`);
    await connection.db.execute(sql`delete from sliper.posts where id=${post.id}`);
    await connection.close();
  }
});

test("external recruitment sends applicants to the platform and exposes manual approval in the host dashboard", async () => {
  const post = data(
    await api<CommunityPost>("/posts", "POST", {
      categorySlug: "party",
      kind: "모집",
      title: `[외부 참가 검증 ${randomUUID().slice(0, 8)}]`,
      bodyMarkdown: "외부 플랫폼에서 신청·결제",
      applicationUrl: "https://example.com/external-event",
      isAnonymous: false,
      imageAssetIds: [],
    }),
  );
  const connection = createDatabase(process.env.DATABASE_URL!, 2),
    db = connection.db;
  try {
    data(
      await participationApi(`/events/${post.id}/settings`, "PUT", {
        amountKRW: 10000,
        capacity: 3,
        open: true,
        approvalMode: "manual",
      }),
    );
    assert.equal(
      (
        await participationApi(`/events/${post.id}/applications`, "POST", {
          consent: true,
        })
      ).status,
      409,
    );
    const html = await (await fetch(`${origin}/events/${post.id}`)).text();
    assert.ok(html.includes("외부 플랫폼에서 신청하기"));
    assert.ok(html.includes("결제 후 참가 확인"));
    assert.equal(html.includes("무료 참가 확정하기"), false);
    const claim = data(
      await participationApi<EventOverview>(`/events/${post.id}/external-confirmation`, "POST", {
        externalReference: `order-${post.id}`,
        consent: true,
      }),
    ).application!;
    assert.equal(claim.status, "pending_approval");
    assert.equal(claim.orderId, null);
    const dashboard = data(
      await participationApi<EventDashboard>(
        `/events/${post.id}/dashboard?status=pending_approval`,
      ),
    );
    assert.equal(dashboard.stats.pendingApproval, 1);
    assert.equal(dashboard.attendees[0]?.id, claim.id);
    assert.equal(
      (
        await participationApi(
          `/applications/${claim.id}/decision`,
          "POST",
          { decision: "approve", paymentChecked: true, reason: "checked" },
          "https://evil.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await participationApi(`/applications/${claim.id}/decision`, "POST", {
          decision: "approve",
          paymentChecked: false,
          reason: "",
        })
      ).status,
      400,
    );
    data(
      await participationApi(`/applications/${claim.id}/decision`, "POST", {
        decision: "approve",
        paymentChecked: true,
        reason: "외부 내역 확인",
      }),
    );
    assert.equal(
      data(await participationApi<EventDashboard>(`/events/${post.id}/dashboard`)).stats.confirmed,
      1,
    );
    assert.equal(
      data(await participationApi<EventOverview>(`/events/${post.id}`)).application?.status,
      "confirmed",
    );
    const dashboardHtml = await (await fetch(`${origin}/management/events/${post.id}`)).text();
    assert.ok(dashboardHtml.includes("참가 현황"));
    assert.ok(dashboardHtml.includes("외부 플랫폼 참가 금액"));
    const management = await fetch(`${origin}/management`);
    assert.equal(management.status, 200);
    assert.ok((await management.text()).includes("내 행사 관리"));
    data(
      await participationApi(`/applications/${claim.id}/decision`, "POST", {
        decision: "refund",
        paymentChecked: true,
        reason: "외부 환불 확인",
      }),
    );
    assert.equal(
      data(await participationApi<EventOverview>(`/events/${post.id}`)).application?.status,
      "refunded",
    );
  } finally {
    await db.execute(sql`delete from sliper.external_webhook_events where post_id=${post.id}`);
    await db.execute(sql`delete from sliper.external_receipts where post_id=${post.id}`);
    await db.execute(sql`delete from sliper.posts where id=${post.id}`);
    await connection.close();
  }
});
