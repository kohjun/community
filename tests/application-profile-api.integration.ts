import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import type { ActionResult } from "../src/domain/contracts";
import type { CommunityPost } from "../src/domain/community";
import type { MyProfile } from "../src/domain/profile";
import type { EventOverview, EventDashboard } from "../src/domain/participation";

const origin = "http://127.0.0.1:3000";
const database = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  database.hostname !== "127.0.0.1" ||
  database.port !== "55432" ||
  database.pathname !== "/sliper_dev"
)
  throw new Error("Application-form HTTP checks require the isolated local development database.");
const password = process.env.SLIPER_TEST_PASSWORD;
if (!password) throw new Error("Supply SLIPER_TEST_PASSWORD for this process only.");
async function api<T>(path: string, method = "GET", body?: unknown, cookie = "", from = origin) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: from,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  return {
    status: response.status,
    result: (await response.json()) as ActionResult<T>,
    cookie:
      response.headers
        .getSetCookie()
        .find((value) => value.startsWith("sliper_test_session="))
        ?.split(";")[0] ?? "",
  };
}
function data<T>(response: { status: number; result: ActionResult<T> }): T {
  assert.equal(response.status, 200, "Unexpected application-form HTTP status");
  if (!response.result.ok) throw new Error(response.result.error.message);
  return response.result.data;
}

test("basic member information feeds event questions, immutable applicant snapshots and private management views", async () => {
  const connection = createDatabase(process.env.DATABASE_URL!, 2),
    db = connection.db;
  const login = await api<{ nickname: string; redirect: string }>("/api/auth/test/login", "POST", {
    username: "test@sliper.local",
    password,
  });
  data(login);
  assert.ok(login.cookie, "Signed test login required");
  const own = data(await api<MyProfile>("/api/community/me", "GET", undefined, login.cookie));
  const [original] = await db.select().from(profiles).where(eq(profiles.publicId, own.publicId));
  assert.ok(original, "The authenticated member needs its own profile");
  const restore = {
    nickname: original.nickname,
    bio: original.bio,
    region: original.region,
    avatar: original.avatar,
    interests: original.interests,
    phoneNumber: original.phoneNumber,
    phoneVerifiedAt: original.phoneVerifiedAt,
    profileCompletedAt: original.profileCompletedAt,
    onboardingConsentAt: original.onboardingConsentAt,
    ageBand: original.ageBand,
    gender: original.gender,
  };
  let postId: string | undefined, applicationId: string | undefined;
  try {
    await db
      .update(profiles)
      .set({
        phoneNumber: null,
        phoneVerifiedAt: null,
        profileCompletedAt: null,
        onboardingConsentAt: null,
      })
      .where(eq(profiles.id, original.id));
    const post = data(
      await api<CommunityPost>("/api/community/posts", "POST", {
        categorySlug: "party",
        kind: "모집",
        title: `[신청 질문 확인 ${randomUUID().slice(0, 8)}]`,
        bodyMarkdown: "프로필과 참가 질문을 확인하는 임시 테스트 행사입니다.",
        location: "테스트 행사장",
        eventDate: "예정",
        eventFee: "무료",
      }),
    );
    postId = post.id;
    const textId = randomUUID(),
      choiceId = randomUUID();
    const settings = {
      amountKRW: 0,
      capacity: 2,
      open: true,
      questions: [
        {
          id: textId,
          prompt: "어떤 미션을 해보고 싶나요?",
          type: "text",
          required: true,
          options: [],
        },
        {
          id: choiceId,
          prompt: "원하는 역할을 골라주세요",
          type: "single_choice",
          required: true,
          options: ["전략가", "트릭스터"],
        },
      ],
    };
    data(await api<EventOverview>(`/api/participation/events/${postId}/settings`, "PUT", settings));
    const overview = () =>
      api<EventOverview>(
        `/api/participation/events/${postId}`,
        "GET",
        undefined,
        login.cookie,
      ).then(data);
    const before = await overview();
    assert.equal(before.applicantProfile?.ready, false);
    const base = {
      consent: true,
      note: "팀을 처음 만나도 함께 즐겨볼게요.",
      questionnaireVersion: before.config!.questionnaireVersion,
      answers: [
        { questionId: textId, value: "협동 추리 미션" },
        { questionId: choiceId, value: "전략가" },
      ],
    };
    assert.equal(
      (await api(`/api/participation/events/${postId}/applications`, "POST", base, login.cookie))
        .status,
      400,
    );
    const onboarding = {
      nickname: own.nickname,
      phoneNumber: "010-1234-5678",
      consent: true,
      region: own.region,
      interests: own.interests,
      ageBand: "30s",
      gender: null,
    };
    assert.equal(
      (
        await api(
          "/api/community/me/onboarding",
          "POST",
          onboarding,
          login.cookie,
          "https://untrusted.example.invalid",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await api(
          "/api/community/me/onboarding",
          "POST",
          { ...onboarding, phoneVerifiedAt: new Date().toISOString() },
          login.cookie,
        )
      ).status,
      400,
    );
    const ready = data(
      await api<MyProfile>("/api/community/me/onboarding", "POST", onboarding, login.cookie),
    );
    assert.equal(ready.phoneNumber, "01012345678");
    assert.equal(ready.phoneVerifiedAt, null);
    assert.ok(ready.profileCompletedAt);
    assert.ok(ready.onboardingConsentAt);
    assert.equal((await overview()).applicantProfile?.ready, true);
    const guest = data(
      await api<EventOverview>(
        `/api/participation/events/${postId}`,
        "GET",
        undefined,
        "sliper_test_session=invalid",
      ),
    );
    assert.equal(guest.applicantProfile, null);
    assert.equal(guest.application, null);
    assert.equal(
      (
        await api(
          `/api/participation/events/${postId}/applications`,
          "POST",
          { ...base, attendeeName: "다른 사람", contact: "01099999999" },
          login.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await api(
          `/api/participation/events/${postId}/applications`,
          "POST",
          { ...base, answers: [] },
          login.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await api(
          `/api/participation/events/${postId}/applications`,
          "POST",
          {
            ...base,
            answers: [
              { questionId: textId, value: "미션" },
              { questionId: choiceId, value: "조작된 옵션" },
            ],
          },
          login.cookie,
        )
      ).status,
      400,
    );
    const applied = data(
      await api<EventOverview>(
        `/api/participation/events/${postId}/applications`,
        "POST",
        base,
        login.cookie,
      ),
    );
    applicationId = applied.application!.id;
    assert.equal(applied.application!.status, "confirmed");
    assert.equal(applied.application!.attendeeName, own.nickname);
    assert.equal(applied.application!.contact, "01012345678");
    assert.equal(applied.application!.answers.length, 2);
    const dashboard = data(
      await api<EventDashboard>(`/api/participation/events/${postId}/dashboard`),
    );
    assert.equal(dashboard.attendees[0]?.answers[0]?.answer, "협동 추리 미션");
    assert.equal(
      (await api(`/api/participation/events/${postId}/dashboard`, "GET", undefined, login.cookie))
        .status,
      403,
    );
    assert.equal(
      (await api(`/api/participation/rooms/${postId}`, "GET", undefined, login.cookie)).status,
      200,
    );
    data(
      await api<MyProfile>(
        "/api/community/me",
        "PATCH",
        {
          nickname: "프로필변경테스트",
          phoneNumber: "01023456789",
          region: own.region,
          avatar: own.avatar,
          bio: own.bio,
          interests: own.interests,
        },
        login.cookie,
      ),
    );
    data(
      await api<EventOverview>(`/api/participation/events/${postId}/settings`, "PUT", {
        ...settings,
        questions: [
          { ...settings.questions[0], prompt: "새로운 참가 질문" },
          settings.questions[1],
        ],
      }),
    );
    const oldSnapshot = (await overview()).application!;
    assert.equal(oldSnapshot.attendeeName, own.nickname);
    assert.equal(oldSnapshot.contact, "01012345678");
    assert.equal(oldSnapshot.answers[0]?.prompt, "어떤 미션을 해보고 싶나요?");
    assert.equal(
      data(
        await api<EventOverview>(
          `/api/participation/events/${postId}/applications`,
          "POST",
          base,
          login.cookie,
        ),
      ).application!.id,
      applicationId,
    );
    const stale = { ...base, questionnaireVersion: "q1-" + "0".repeat(64) };
    // After cancelling, a genuinely new request must use the current questions.
    data(
      await api(
        `/api/participation/applications/${applicationId}`,
        "DELETE",
        undefined,
        login.cookie,
      ),
    );
    applicationId = undefined;
    assert.equal(
      (await api(`/api/participation/events/${postId}/applications`, "POST", stale, login.cookie))
        .status,
      409,
    );
  } finally {
    try {
      if (applicationId)
        data(
          await api(
            `/api/participation/applications/${applicationId}`,
            "DELETE",
            undefined,
            login.cookie,
          ),
        );
      if (postId) data(await api(`/api/community/posts/${postId}`, "DELETE"));
    } finally {
      await db
        .update(profiles)
        .set(restore)
        .where(eq(profiles.id, original.id))
        .catch(() => {
          throw new Error("The temporary member profile could not be restored.");
        });
      await api("/api/auth/test/logout", "POST", {}, login.cookie);
      await connection.close();
    }
  }
});
