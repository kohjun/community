import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { posts, profilePhotos, profiles, roomMessages } from "../src/db/schema";
import type { ActionResult } from "../src/domain/contracts";
import type { CommunityPost } from "../src/domain/community";
import type { MyProfile } from "../src/domain/profile";
import type { EventOverview, RoomView, RoomMemberPage } from "../src/domain/participation";
import { isProfilePhotoObjectKey } from "../src/server/profile-photo-service";
import { createLocalTestSession, loadLocalTestAccount } from "../src/server/local-test-auth";

const origin = "http://127.0.0.1:3000",
  database = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  !["postgres:", "postgresql:"].includes(database.protocol) ||
  database.hostname !== "127.0.0.1" ||
  database.port !== "55432" ||
  database.pathname !== "/sliper_dev"
)
  throw new Error("Room photo HTTP checks require the isolated local development database.");
const password = process.env.SLIPER_TEST_PASSWORD;
const configuredRedis = !!process.env.REDIS_URL?.trim();
const account = password ? null : loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!password && !account)
  throw new Error(
    "Set up the existing local test account or supply SLIPER_TEST_PASSWORD for this process only.",
  );
async function api<T>(
  url: string,
  method = "GET",
  body?: unknown,
  cookie = "",
  from = origin,
  timeoutMs = 60000,
) {
  const response = await fetch(origin + url, {
    method,
    headers: {
      Origin: from,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body instanceof FormData || body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    status: response.status,
    result: (await response.json()) as ActionResult<T>,
    cookie:
      response.headers
        .getSetCookie()
        .find((c) => c.startsWith("sliper_test_session="))
        ?.split(";")[0] ?? "",
  };
}
function data<T>(response: { status: number; result: ActionResult<T> }): T {
  assert.equal(response.status, 200);
  if (!response.result.ok) throw new Error(response.result.error.message);
  return response.result.data;
}
function form(bytes: Uint8Array, type = "image/png") {
  const body = new FormData();
  body.set("file", new Blob([new Uint8Array(bytes)], { type }), "photo.png");
  return body;
}
async function image(src: string, cookie = "") {
  return fetch(origin + src, {
    headers: cookie ? { Cookie: cookie } : {},
    signal: AbortSignal.timeout(20000),
  });
}
function events(response: Response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  async function next(
    kind: string,
    predicate: (value: RoomView) => boolean = () => true,
    timeoutMs = 20000,
  ) {
    let timeout: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        void reader.cancel().catch(() => {});
        reject(new Error("Timed out waiting for room stream update"));
      }, timeoutMs);
    });
    try {
      for (;;) {
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const name = /^event: (.*)$/m.exec(frame)?.[1],
            value = /^data: (.*)$/m.exec(frame)?.[1];
          if (name === kind && value) {
            const parsed = JSON.parse(value) as RoomView;
            if (predicate(parsed)) return parsed;
          }
        }
        const chunk = await Promise.race([reader.read(), expired]);
        if (chunk.done) throw new Error("Room stream ended before expected update");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    } finally {
      clearTimeout(timeout!);
    }
  }
  return { next, close: () => reader.cancel().catch(() => {}) };
}

test("room roster and private photo uploads work through HTTP and SSE, with cancellation revoking access", async () => {
  const fixtureTitle = "[멤버 확인 " + randomUUID() + "]";
  const connection = createDatabase(process.env.DATABASE_URL!, 2),
    db = connection.db;
  let loginCookie: string;
  if (password) {
    const response = await api("/api/auth/test/login", "POST", {
      username: "test@sliper.local",
      password,
    });
    data(response);
    loginCookie = response.cookie;
  } else {
    assert.ok(account);
    loginCookie = "sliper_test_session=" + createLocalTestSession(account, new URL(origin).host);
  }
  const login = { cookie: loginCookie };
  assert.ok(login.cookie);
  const guest = await api("/api/auth/test/logout", "POST", {}, login.cookie);
  data(guest);
  assert.ok(guest.cookie);
  const own = data(await api<MyProfile>("/api/community/me", "GET", undefined, login.cookie));
  const [original] = await db.select().from(profiles).where(eq(profiles.publicId, own.publicId));
  assert.ok(original);
  const [originalPhoto] = await db
    .select()
    .from(profilePhotos)
    .where(eq(profilePhotos.userId, original.id));
  const folder = path.resolve(process.cwd(), ".local", "profile-photos");
  if (originalPhoto) assert.ok(isProfilePhotoObjectKey(originalPhoto.objectKey));
  const originalBytes = originalPhoto
    ? await readFile(path.join(folder, originalPhoto.objectKey))
    : null;
  const restore = {
    phoneNumber: original.phoneNumber,
    phoneVerifiedAt: original.phoneVerifiedAt,
    profileCompletedAt: original.profileCompletedAt,
    onboardingConsentAt: original.onboardingConsentAt,
  };
  const abort = new AbortController();
  let postId: string | undefined,
    applicationId: string | undefined,
    stream: ReturnType<typeof events> | undefined;
  try {
    await db
      .update(profiles)
      .set({
        phoneNumber: "01012345678",
        phoneVerifiedAt: null,
        profileCompletedAt: new Date(),
        onboardingConsentAt: new Date(),
      })
      .where(eq(profiles.id, original.id));
    const png = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#0A84FE" },
    })
      .png()
      .withExif({ IFD0: { Artist: "private upload test" } })
      .toBuffer();
    assert.equal(
      (await api("/api/community/me/photo", "POST", form(png), guest.cookie)).status,
      401,
    );
    assert.equal(
      (
        await api(
          "/api/community/me/photo",
          "POST",
          form(png),
          login.cookie,
          "https://outsider.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await api(
          "/api/community/me/photo",
          "POST",
          form(Buffer.from("not an image")),
          login.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await api(
          "/api/community/me/photo",
          "POST",
          form(Buffer.from("<svg></svg>"), "image/svg+xml"),
          login.cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await api(
          "/api/community/me/photo",
          "POST",
          form(Buffer.alloc(5 * 1024 * 1024 + 1)),
          login.cookie,
        )
      ).status,
      400,
    );
    const forged = form(png);
    forged.set("userId", "00000000-0000-4000-8000-000000000001");
    assert.equal((await api("/api/community/me/photo", "POST", forged, login.cookie)).status, 400);
    const first = data(
      await api<MyProfile>("/api/community/me/photo", "POST", form(png), login.cookie),
    );
    assert.ok(first.photoSrc);
    const ownImage = await image(first.photoSrc, login.cookie);
    assert.equal(ownImage.status, 200);
    assert.equal(ownImage.headers.get("content-type"), "image/webp");
    assert.equal(ownImage.headers.get("cache-control"), "private, no-store");
    const metadata = await sharp(Buffer.from(await ownImage.arrayBuffer())).metadata();
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal((await image(first.photoSrc)).status, 404);
    assert.equal((await image(first.photoSrc, guest.cookie)).status, 401);
    const post = data(
      await api<CommunityPost>("/api/community/posts", "POST", {
        categorySlug: "party",
        kind: "모집",
        title: fixtureTitle,
        bodyMarkdown: "사진과 멤버 목록을 확인하는 임시 행사입니다.",
        location: "테스트 행사장",
        eventDate: "예정",
        eventFee: "무료",
      }),
    );
    postId = post.id;
    data(
      await api(`/api/participation/events/${postId}/settings`, "PUT", {
        amountKRW: 0,
        capacity: 3,
        open: true,
      }),
    );
    assert.equal(
      (await api(`/api/participation/rooms/${postId}/members`, "GET", undefined, login.cookie))
        .status,
      403,
    );
    const application = data(
      await api<EventOverview>(
        `/api/participation/events/${postId}/applications`,
        "POST",
        { consent: true, note: "비공개 요청사항" },
        login.cookie,
      ),
    ).application!;
    applicationId = application.id;
    const room = data(
      await api<RoomView>(`/api/participation/rooms/${postId}`, "GET", undefined, login.cookie),
    );
    assert.equal(room.memberCount, 2);
    assert.equal(room.canWrite, false);
    const members = data(
      await api<RoomMemberPage>(
        `/api/participation/rooms/${postId}/members`,
        "GET",
        undefined,
        login.cookie,
      ),
    );
    assert.equal(members.memberCount, 2);
    assert.equal(members.members.find((m) => m.isMe)?.nickname, own.nickname);
    const memberPhoto = members.members.find((m) => m.isMe)?.photoSrc;
    assert.ok(memberPhoto);
    assert.equal((await image(memberPhoto)).status, 200);
    const serialized = JSON.stringify({ room, members });
    assert.equal(serialized.includes(original.id), false);
    assert.equal(serialized.includes("01012345678"), false);
    assert.equal(serialized.includes("비공개 요청사항"), false);
    assert.equal(
      (await api(`/api/participation/events/${postId}/attendees`, "GET", undefined, login.cookie))
        .status,
      403,
    );
    assert.equal(
      (
        await api(
          `/api/participation/rooms/${postId}/messages`,
          "POST",
          { body: "unauthorized" },
          login.cookie,
        )
      ).status,
      403,
    );
    const sse = await fetch(origin + `/api/participation/rooms/${postId}/stream`, {
      headers: { Cookie: login.cookie },
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]),
    });
    stream = events(sse);
    const initial = await stream.next("room");
    assert.equal(initial.memberCount, 2);
    const second = data(
      await api<MyProfile>("/api/community/me/photo", "POST", form(png), login.cookie),
    );
    assert.ok(second.photoSrc);
    assert.notEqual(second.photoSrc, first.photoSrc);
    assert.equal((await image(first.photoSrc, login.cookie)).status, 404);
    const announcement = "사진 갱신 공지 " + randomUUID();
    const announcementStarted = Date.now();
    const published = data(
      await api<RoomView>(
        `/api/participation/rooms/${postId}/messages`,
        "POST",
        { body: announcement },
        "",
        origin,
        configuredRedis ? 3000 : 60000,
      ),
    );
    assert.equal(published.isOwner, true);
    assert.equal(published.canWrite, true);
    assert.ok(published.messages.some((message) => message.body === announcement));
    const announcementCompleted = Date.now();
    const updated = await stream.next(
      "room",
      (value) =>
        value.memberRevision !== initial.memberRevision &&
        value.messages.some((message) => message.body === announcement),
      configuredRedis ? Math.max(1, 3000 - (Date.now() - announcementStarted)) : 20000,
    );
    if (configuredRedis)
      assert.ok(
        Date.now() - announcementStarted < 3000,
        "Committed announcements must reach SSE within three seconds.",
      );

    assert.equal(
      updated.memberPreview.find((m) => m.isMe)?.photoSrc,
      `${second.photoSrc}?room=${postId}`,
    );
    // Respect the existing per-author announcement rate limit before cancelling.
    await delay(Math.max(0, 2100 - (Date.now() - announcementCompleted)));
    data(
      await api(
        `/api/participation/applications/${applicationId}`,
        "DELETE",
        undefined,
        login.cookie,
      ),
    );
    applicationId = undefined;
    const revocationStarted = Date.now();
    const afterCancellation = data(
      await api<RoomView>(
        `/api/participation/rooms/${postId}/messages`,
        "POST",
        { body: "참가 취소 후 공지 " + randomUUID() },
        "",
        origin,
        configuredRedis ? 3000 : 60000,
      ),
    );
    assert.equal(afterCancellation.memberCount, 1);
    const revoked = await stream.next(
      "revoked",
      () => true,
      configuredRedis ? Math.max(1, 3000 - (Date.now() - revocationStarted)) : 20000,
    );
    assert.deepEqual(revoked, {});
    if (configuredRedis)
      assert.ok(
        Date.now() - revocationStarted < 3000,
        "Revoked members must be rejected before a new announcement reaches SSE.",
      );

    assert.equal(
      (await api(`/api/participation/rooms/${postId}/members`, "GET", undefined, login.cookie))
        .status,
      403,
    );
    assert.equal((await image(`${second.photoSrc}?room=${postId}`)).status, 404);
    assert.equal((await image(second.photoSrc, login.cookie)).status, 200);
    const remaining = data(await api<RoomView>(`/api/participation/rooms/${postId}`));
    assert.equal(remaining.memberCount, 1);
    const cleared = data(
      await api<MyProfile>("/api/community/me/photo", "DELETE", undefined, login.cookie),
    );
    assert.equal(cleared.photoSrc, null);
    assert.equal((await image(second.photoSrc, login.cookie)).status, 404);
  } finally {
    abort.abort();
    await stream?.close();
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
      if (postId) {
        const [fixture] = await db
          .select({ id: posts.id })
          .from(posts)
          .where(and(eq(posts.id, postId), eq(posts.title, fixtureTitle)));
        assert.ok(fixture, "Only the exact post created by this test may be removed.");
        try {
          data(await api(`/api/community/posts/${postId}`, "DELETE"));
        } finally {
          // The soft-delete trigger replaces the title; the verified fixture ID stays immutable.
          const removed = await db
            .delete(posts)
            .where(eq(posts.id, fixture.id))
            .returning({ id: posts.id });
          assert.equal(removed.length, 1);
          const leftovers = await db
            .select({ id: roomMessages.id })
            .from(roomMessages)
            .where(eq(roomMessages.postId, postId));
          assert.equal(leftovers.length, 0);
        }
      }
    } finally {
      try {
        data(await api("/api/community/me/photo", "DELETE", undefined, login.cookie));
        if (originalPhoto && originalBytes) {
          await mkdir(folder, { recursive: true });
          await writeFile(path.join(folder, originalPhoto.objectKey), originalBytes);
          await db.insert(profilePhotos).values(originalPhoto);
        }
        await db.update(profiles).set(restore).where(eq(profiles.id, original.id));
        await api("/api/auth/test/logout", "POST", {}, login.cookie);
      } finally {
        await connection.close();
      }
    }
  }
});
