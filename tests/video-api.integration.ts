import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import ffmpeg from "ffmpeg-static";
import ffprobe from "@ffprobe-installer/ffprobe";
import postgres from "postgres";
import type { ActionResult, PublicVideo } from "../src/domain/contracts";
import type { VideoUploadReceipt, VideoProcessingStatus } from "../src/domain/video-processing";
import type { CommunityPost, CommunityDetail } from "../src/domain/community";
import {
  createLocalTestGuestSession,
  createLocalTestSession,
  loadLocalTestAccount,
} from "../src/server/local-test-auth";
import { localImageObjectStore } from "../src/server/image-storage-core";
import { localVideoSourceStore } from "../src/server/video-source-storage";
import { runMediaProcess } from "../src/server/video-transcoding-core";

const origin = "http://127.0.0.1:3000";
const url = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev" ||
  !["", "local"].includes(process.env.MEDIA_STORAGE_BACKEND || "")
)
  throw new Error("Video HTTP checks require the isolated local database and local storage.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account || !ffmpeg)
  throw new Error("Set up the existing local test account and FFmpeg before video HTTP checks.");
const ownerId = account.userId;
const foreignId = "00000000-0000-4000-8000-000000000001";
assert.notEqual(ownerId, foreignId);
const ownerCookie = "sliper_test_session=" + createLocalTestSession(account, "127.0.0.1:3000");
const guestCookie = "sliper_test_session=" + createLocalTestGuestSession(account, "127.0.0.1:3000");
const db = postgres(url.toString(), { prepare: false, max: 1 });
type LimitRow = { window_started_at: string; count: number };
type LimitFixture = {
  userId: string;
  action: string;
  previous: LimitRow | null;
  attempts: number;
  attemptWindow: number;
};
async function api<T>(route: string, method = "GET", body?: unknown, cookie = ownerCookie) {
  const isForm = body instanceof FormData;
  const response = await fetch(origin + route, {
    method,
    headers: {
      Origin: origin,
      ...(!isForm ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? null : isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  return {
    status: response.status,
    result: (await response.json()) as ActionResult<T>,
    headers: response.headers,
  };
}
function data<T>(response: { status: number; result: ActionResult<T> }) {
  assert.equal(response.status, 200, "Video API must return a successful response.");
  assert.ok(response.result.ok, "Video API returned an error.");
  return response.result.data;
}
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const requestWindow = () => Math.floor(Date.now() / 3600000) * 3600000;
async function waitForVideo(jobId: string): Promise<PublicVideo> {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const response = await api<VideoProcessingStatus>("/api/videos/jobs/" + jobId);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const status = data(response);
    assert.deepEqual(Object.keys(status).sort(), ["error", "jobId", "status", "video"]);
    assert.equal(status.jobId, jobId);
    assert.ok(["queued", "processing", "ready", "failed"].includes(status.status));
    const serialized = JSON.stringify(status);
    for (const privateValue of [
      ownerId,
      "uploaderId",
      "objectKey",
      "storageBackend",
      ".bin",
      "video-sources",
    ])
      assert.equal(serialized.includes(privateValue), false);
    if (status.status === "ready") {
      assert.ok(status.video);
      assert.equal(status.error, null);
      return status.video;
    }
    assert.equal(status.video, null);
    assert.notEqual(
      status.status,
      "failed",
      "The independent video worker must process valid media successfully.",
    );
    assert.equal(status.error, null);
    await delay(500);
  }
  throw new Error(
    "Start the separate video worker before HTTP checks; this fixture did not become ready within three minutes.",
  );
}
async function waitForOriginalRemoval(jobId: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const [job] = await db`select source_removed_at from sliper.video_processing_jobs
      where id=${jobId} and uploader_id=${ownerId}`;
    if (job?.source_removed_at) return;
    await delay(250);
  }
  throw new Error("The independent video worker did not acknowledge private original cleanup.");
}

test("queued videos are compressed by a separate worker, retain owner-only job privacy and support authorized attachments and playback ranges", async () => {
  const fixtureId = randomUUID();
  const fixtureTitle = "영상 HTTP 검사 " + fixtureId;
  const foreignFixtureTitle = "타인 영상 차단 " + fixtureId;
  const fixtureVideos: PublicVideo[] = [];
  const fixtureJobs: string[] = [];
  const limits: LimitFixture[] = [];
  const directory = await mkdtemp(path.join(tmpdir(), "sliper-video-api-"));
  assert.ok(path.basename(directory).startsWith("sliper-video-api-"));
  const sourcePath = path.join(directory, "source.mp4");
  const store = localImageObjectStore();
  const sourceStore = localVideoSourceStore();
  async function noteAttempt(userId: string, action: string) {
    let fixture = limits.find((row) => row.userId === userId && row.action === action);
    if (!fixture) {
      const [previous] = await db<LimitRow[]>`
        select window_started_at::text, count from sliper.request_limits
        where user_id=${userId} and action=${action}
      `;
      fixture = {
        userId,
        action,
        previous: previous ?? null,
        attempts: 0,
        attemptWindow: requestWindow(),
      };
      limits.push(fixture);
    }
    fixture.attempts++;
    fixture.attemptWindow = requestWindow();
  }
  try {
    await runMediaProcess(
      ffmpeg!,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1280x720:rate=30",
        "-t",
        "2",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-metadata",
        "title=Private source fixture",
        "-movflags",
        "+faststart",
        "-threads",
        "1",
        "-n",
        sourcePath,
      ],
      30000,
    );
    const source = await readFile(sourcePath);
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(source)], { type: "video/mp4" }), "fixture.mp4");
    assert.equal((await api("/api/videos", "POST", form, guestCookie)).status, 401);
    await noteAttempt(ownerId, "video-upload");
    const receipt = data(await api<VideoUploadReceipt>("/api/videos", "POST", form));
    fixtureJobs.push(receipt.jobId);
    assert.deepEqual(Object.keys(receipt).sort(), ["jobId", "status", "statusUrl"]);
    assert.match(receipt.jobId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(receipt.status, "queued");
    const statusUrl = "/api/videos/jobs/" + receipt.jobId;
    assert.equal(receipt.statusUrl, statusUrl);
    assert.equal((await api(statusUrl, "GET", undefined, guestCookie)).status, 401);
    assert.equal((await api(statusUrl, "GET", undefined, "")).status, 404);
    assert.equal(
      (await fetch(origin + "/api/videos/" + receipt.jobId, { headers: { Cookie: ownerCookie } }))
        .status,
      404,
    );
    const [reserved] = await db`
      select status, source_ready, source_byte_size, source_storage_backend, result_asset_id
      from sliper.video_processing_jobs where id=${receipt.jobId} and uploader_id=${ownerId}
    `;
    assert.ok(reserved);
    assert.equal(reserved.source_ready, true);
    assert.equal(reserved.source_byte_size, source.byteLength);
    assert.equal(reserved.source_storage_backend, "local");
    if (reserved.status === "queued" || reserved.status === "processing")
      assert.equal(
        reserved.result_asset_id,
        null,
        "Queued jobs cannot publish pending video placeholders.",
      );
    const video = await waitForVideo(receipt.jobId);
    fixtureVideos.push(video);
    assert.notEqual(video.id, receipt.jobId);
    await waitForOriginalRemoval(receipt.jobId);
    await assert.rejects(
      readFile(path.join(process.cwd(), ".local", "video-sources", receipt.jobId + ".bin")),
      { code: "ENOENT" },
    );
    assert.match(video.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(video.src, "/api/videos/" + video.id);
    assert.equal(video.contentType, "video/mp4");
    assert.ok(video.byteSize > 0 && video.byteSize < source.byteLength);
    assert.ok(video.width <= 1280 && video.height <= 720);
    assert.ok(video.durationSeconds >= 1.9 && video.durationSeconds <= 2.2);
    const [stored] = await db`
      select byte_size, object_key, storage_backend, uploader_id, post_id
      from sliper.video_assets where id=${video.id}
    `;
    assert.ok(stored);
    assert.equal(stored.byte_size, video.byteSize);
    assert.equal(stored.object_key, video.id + ".mp4");
    assert.equal(stored.storage_backend, "local");
    assert.equal(stored.uploader_id, ownerId);
    assert.equal(stored.post_id, null);
    assert.equal(
      (await fetch(origin + video.src, { headers: { Cookie: guestCookie } })).status,
      404,
    );
    assert.equal((await fetch(origin + video.src)).status, 404);
    const privateResponse = await fetch(origin + video.src, { headers: { Cookie: ownerCookie } });
    assert.equal(privateResponse.status, 200);
    const encoded = Buffer.from(await privateResponse.arrayBuffer());
    assert.equal(encoded.byteLength, video.byteSize);
    const encodedPath = path.join(process.cwd(), ".local", "videos", video.id + ".mp4");
    const probe = JSON.parse(
      await runMediaProcess(
        ffprobe.path,
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_name,width,height:format_tags=title",
          "-of",
          "json",
          encodedPath,
        ],
        15000,
      ),
    ) as {
      streams: { codec_name: string; width: number; height: number }[];
      format?: { tags?: { title?: string } };
    };
    assert.equal(probe.streams[0]?.codec_name, "h264");
    assert.equal(probe.streams[0]?.width, video.width);
    assert.equal(probe.streams[0]?.height, video.height);
    assert.equal(probe.format?.tags?.title, undefined);

    const document = {
      version: 1,
      type: "doc",
      content: [
        paragraph("영상 앞 첫 문장"),
        { type: "uploadedVideo", attrs: { assetId: video.id } },
        paragraph("영상 다음 마지막 문장"),
      ],
    };
    const input = {
      categorySlug: "party",
      kind: "이야기",
      title: fixtureTitle,
      bodyMarkdown: "",
      bodyDocument: document,
      isAnonymous: false,
      imageAssetIds: [],
    };
    await noteAttempt(foreignId, "post");
    assert.equal(
      (await api("/api/community/posts", "POST", { ...input, title: foreignFixtureTitle }, ""))
        .status,
      403,
    );
    const [unclaimed] = await db`select post_id from sliper.video_assets where id=${video.id}`;
    assert.equal(unclaimed?.post_id, null);
    await noteAttempt(ownerId, "post");
    const created = data(await api<CommunityPost>("/api/community/posts", "POST", input));
    assert.deepEqual(
      created.bodyDocument?.content.map((node) => node.type),
      ["paragraph", "uploadedVideo", "paragraph"],
    );
    assert.deepEqual(
      created.videos?.map((item) => item.id),
      [video.id],
    );
    const loaded = data(
      await api<CommunityDetail>(
        "/api/community/posts/" + created.id,
        "GET",
        undefined,
        guestCookie,
      ),
    );
    assert.deepEqual(loaded.post.bodyDocument, created.bodyDocument);
    assert.deepEqual(
      loaded.post.videos?.map((item) => item.id),
      [video.id],
    );

    // A public post does not make the private processing record visible to visitors.
    assert.equal((await api(statusUrl, "GET", undefined, guestCookie)).status, 401);
    assert.equal((await api(statusUrl, "GET", undefined, "")).status, 404);
    const publicResponse = await fetch(origin + video.src, { headers: { Cookie: guestCookie } });
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers.get("content-type"), "video/mp4");
    assert.equal(publicResponse.headers.get("accept-ranges"), "bytes");
    assert.equal(publicResponse.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await publicResponse.arrayBuffer()), encoded);
    const ranged = await fetch(origin + video.src, {
      headers: { Cookie: guestCookie, Range: "bytes=0-63" },
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), "bytes 0-63/" + encoded.byteLength);
    assert.equal(ranged.headers.get("content-length"), "64");
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), encoded.subarray(0, 64));
    const head = await fetch(origin + video.src, {
      method: "HEAD",
      headers: { Cookie: guestCookie },
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(encoded.byteLength));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const badRange = await fetch(origin + video.src, {
      headers: { Cookie: guestCookie, Range: "bytes=" + encoded.byteLength + "-" },
    });
    assert.equal(badRange.status, 416);
    assert.equal(badRange.headers.get("content-range"), "bytes */" + encoded.byteLength);

    const detached = data(
      await api<CommunityPost>("/api/community/posts/" + created.id, "PATCH", {
        ...input,
        bodyDocument: { version: 1, type: "doc", content: [paragraph("영상을 제거한 본문")] },
        expectedUpdatedAt: created.updatedAt,
      }),
    );
    assert.deepEqual(detached.videos ?? [], []);
    assert.equal(
      (await fetch(origin + video.src, { headers: { Cookie: guestCookie } })).status,
      404,
    );
    assert.equal(
      (await fetch(origin + video.src, { headers: { Cookie: ownerCookie } })).status,
      200,
    );
    const reattached = data(
      await api<CommunityPost>("/api/community/posts/" + created.id, "PATCH", {
        ...input,
        expectedUpdatedAt: detached.updatedAt,
      }),
    );
    assert.deepEqual(
      reattached.videos?.map((item) => item.id),
      [video.id],
    );
    data(await api("/api/community/posts/" + created.id, "DELETE"));
    assert.equal(
      (await fetch(origin + video.src, { headers: { Cookie: guestCookie } })).status,
      404,
    );
    assert.equal(
      (await api("/api/community/posts/" + created.id, "GET", undefined, guestCookie)).status,
      404,
    );
  } finally {
    try {
      // Exact unpredictable titles also recover rows if the HTTP response failed after commit.
      const committed = await db`select id, author_id from sliper.posts
        where (author_id=${ownerId} and title=${fixtureTitle})
        or (author_id=${foreignId} and title=${foreignFixtureTitle})`;
      for (const row of committed) {
        await db`delete from sliper.activity_events where user_id=${row.author_id} and source_key=${"post:" + row.id}`;
        await db`delete from sliper.posts where id=${row.id} and author_id=${row.author_id}`;
      }
      // Fence only this test's exact jobs. Retain an active attempt's cleanup addresses until
      // its worker acknowledges removal, rather than deleting the ledger during an object write.
      for (const jobId of fixtureJobs) {
        const current = await db.begin(async (tx) => {
          const [job] = await tx`
            select id, status, lock_token from sliper.video_processing_jobs
            where id=${jobId} and uploader_id=${ownerId} for update
          `;
          if (job && (job.status === "queued" || job.status === "processing"))
            await tx`update sliper.video_processing_jobs set status='failed', lock_token=null,
              lease_expires_at=null, last_error_code='PROCESSING_FAILED'
              where id=${jobId} and uploader_id=${ownerId}`;
          return job;
        });
        if (!current) continue;
        if (current.lock_token) {
          let settled = false;
          for (let attempt = 0; attempt < 20; attempt++) {
            const [active] =
              await db`select published_at, removed_at from sliper.video_processing_outputs
              where id=${current.lock_token} and job_id=${jobId}`;
            if (!active || active.published_at || active.removed_at) {
              settled = true;
              break;
            }
            await delay(250);
          }
          if (!settled) {
            console.error("Video HTTP fixture cleanup deferred until its active worker finishes.");
            continue;
          }
        }
        const outputs = await db`select output.id, output.object_key, output.storage_backend
          from sliper.video_processing_outputs output
          join sliper.video_processing_jobs job on job.id=output.job_id
          where job.id=${jobId} and job.uploader_id=${ownerId}`;
        assert.ok(outputs.every((output) => output.storage_backend === "local"));
        for (const output of outputs) await store.remove("video", output.object_key);
        await sourceStore.remove(jobId + ".bin");
        await db.begin(async (tx) => {
          await tx`delete from sliper.video_processing_outputs output
            using sliper.video_processing_jobs job
            where output.job_id=job.id and job.id=${jobId} and job.uploader_id=${ownerId}`;
          await tx`delete from sliper.video_processing_jobs where id=${jobId} and uploader_id=${ownerId}`;
          for (const output of outputs)
            await tx`delete from sliper.video_assets where id=${output.id} and uploader_id=${ownerId}`;
        });
      }
      for (const video of fixtureVideos) {
        await db`delete from sliper.video_assets where id=${video.id} and uploader_id=${ownerId}`;
        await store.remove("video", video.id + ".mp4");
      }
      // Restore only exactly matching test increments; never overwrite concurrent user activity.
      for (const fixture of limits) {
        await db.begin(async (tx) => {
          const [current] = await tx<LimitRow[]>`
            select window_started_at::text, count from sliper.request_limits
            where user_id=${fixture.userId} and action=${fixture.action} for update
          `;
          if (!current || new Date(current.window_started_at).getTime() !== fixture.attemptWindow)
            return;
          const oldInWindow =
            fixture.previous &&
            new Date(fixture.previous.window_started_at).getTime() === fixture.attemptWindow
              ? fixture.previous.count
              : 0;
          if (current.count !== oldInWindow + fixture.attempts) return;
          if (fixture.previous)
            await tx`update sliper.request_limits
              set window_started_at=${fixture.previous.window_started_at}::timestamptz, count=${fixture.previous.count}
              where user_id=${fixture.userId} and action=${fixture.action}`;
          else
            await tx`delete from sliper.request_limits where user_id=${fixture.userId} and action=${fixture.action}`;
        });
      }
    } finally {
      await unlink(sourcePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await rmdir(directory);
      await db.end();
    }
  }
});
