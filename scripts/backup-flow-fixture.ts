import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import ffmpeg from "ffmpeg-static";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDatabase, type Database } from "../src/db/connection";
import {
  eventApplications,
  eventRecords,
  eventSettings,
  mediaAssets,
  posts,
  profiles,
  roomManagers,
  roomMembers,
  roomMessages,
} from "../src/db/schema";
import { videoAssets } from "../src/db/video-schema";
import { eventAdmissions, admissionTickets } from "../src/db/event-operations-schema";
import { eventResults } from "../src/db/player-schema";
import { eventResultRevisions } from "../src/db/records-schema";
import { libraryEntries, libraryVersions, templateProvenance } from "../src/db/library-schema";
import { libraryInputSchema } from "../src/domain/library";
import type { PostDocument } from "../src/domain/post-document";
import { eventOperationsService } from "../src/server/event-operations-service";
import { recordService } from "../src/server/record-service";
import { participationService } from "../src/server/participation-service";
import { readImage } from "../src/server/media";
import { readVideo } from "../src/server/video-media";
import { AppError } from "../src/server/errors";
import { localImageObjectStore } from "../src/server/image-storage-core";
import {
  containedPath,
  ensurePath,
  localConfiguration,
  restoreDatabase,
} from "./lib/local-backup-core";

const execute = promisify(execFile),
  manifestName = ".local/f2-backup-fixture.json",
  checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fixtureSchema = z.strictObject({
  version: z.literal(1),
  state: z.enum(["preparing", "prepared"]),
  fixtureId: z.uuid(),
  owner: z.uuid(),
  member: z.uuid(),
  post: z.uuid(),
  application: z.uuid(),
  message: z.uuid(),
  library: z.uuid(),
  edition: z.uuid(),
  image: z.uuid(),
  video: z.uuid(),
  imageBytes: z.number().int().positive().max(10485760),
  videoBytes: z.number().int().min(20).max(26214400),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  videoSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
type Fixture = z.infer<typeof fixtureSchema>;
class FixtureFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FixtureFailure";
  }
}
const fail = (code: string): never => {
  throw new FixtureFailure(code);
};
function argumentsFor() {
  const [mode, ...flags] = process.argv.slice(2);
  if (
    !["prepare", "verify", "cleanup"].includes(mode || "") ||
    new Set(flags).size !== flags.length
  )
    return fail("INVALID_ARGUMENT");
  const values = new Map<string, string>();
  for (const flag of flags) {
    const match = /^--(database|root)=(.+)$/.exec(flag);
    if (!match || values.has(match[1]!)) return fail("INVALID_ARGUMENT");
    values.set(match[1]!, match[2]!);
  }
  if (mode !== "verify" && values.size) return fail("INVALID_ARGUMENT");
  if (mode === "verify" && (values.size !== 2 || !values.get("database") || !values.get("root")))
    return fail("INVALID_ARGUMENT");
  return {
    mode: mode as "prepare" | "verify" | "cleanup",
    database: values.get("database"),
    root: values.get("root"),
  };
}
async function present(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function safeFilePath(workspace: string, relative: string, createParents = false) {
  const directory = path.posix.dirname(relative);
  if (directory === ".") return fail("INVALID_FIXTURE_PATH");
  await ensurePath(workspace, directory, createParents);
  const target = containedPath(workspace, relative);
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      return fail("UNSAFE_FIXTURE_FILE");
  } catch (error) {
    if (!createParents || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}
async function loadFixture(workspace: string): Promise<Fixture> {
  const file = await safeFilePath(workspace, manifestName, false),
    info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
    return fail("UNSAFE_FIXTURE_MANIFEST");
  const parsed = fixtureSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) return fail("INVALID_FIXTURE_MANIFEST");
  const values = [
    parsed.data.fixtureId,
    parsed.data.owner,
    parsed.data.member,
    parsed.data.post,
    parsed.data.application,
    parsed.data.message,
    parsed.data.library,
    parsed.data.edition,
    parsed.data.image,
    parsed.data.video,
  ];
  if (new Set(values).size !== values.length) return fail("INVALID_FIXTURE_MANIFEST");
  return parsed.data;
}
const postTitle = (fixture: Fixture) => "복원 흐름 검증 행사 " + fixture.fixtureId;
const libraryTitle = (fixture: Fixture) => "복원 흐름 검증 템플릿 " + fixture.fixtureId;
const ownerName = (fixture: Fixture) => "복원 검증 주최자 " + fixture.fixtureId.slice(0, 8);
const memberName = (fixture: Fixture) => "복원 검증 참가자 " + fixture.fixtureId.slice(0, 8);
async function mediaFile(
  workspace: string,
  fixture: Fixture,
  kind: "image" | "video",
  create = false,
) {
  return safeFilePath(
    workspace,
    kind === "image"
      ? ".local/uploads/" + fixture.image + ".webp"
      : ".local/videos/" + fixture.video + ".mp4",
    create,
  );
}
async function checkMedia(workspace: string, fixture: Fixture) {
  for (const kind of ["image", "video"] as const) {
    const file = await mediaFile(workspace, fixture, kind),
      info = await lstat(file);
    const bytes = kind === "image" ? fixture.imageBytes : fixture.videoBytes,
      hash = kind === "image" ? fixture.imageSha256 : fixture.videoSha256;
    if (!info.isFile() || info.isSymbolicLink() || info.size !== bytes)
      return fail("FIXTURE_MEDIA_CHANGED");
    if (checksum(await readFile(file)) !== hash) return fail("FIXTURE_MEDIA_CHANGED");
  }
}
async function checkOwnership(db: Database, fixture: Fixture) {
  const accounts = await db
    .select()
    .from(profiles)
    .where(inArray(profiles.id, [fixture.owner, fixture.member]));
  for (const row of accounts) {
    if (row.nickname !== (row.id === fixture.owner ? ownerName(fixture) : memberName(fixture)))
      return fail("FIXTURE_OWNERSHIP_MISMATCH");
  }
  const [post] = await db.select().from(posts).where(eq(posts.id, fixture.post));
  if (post && (post.authorId !== fixture.owner || post.title !== postTitle(fixture)))
    return fail("FIXTURE_OWNERSHIP_MISMATCH");
  const [library] = await db
    .select()
    .from(libraryEntries)
    .where(eq(libraryEntries.id, fixture.library));
  if (library && (library.ownerId !== fixture.owner || library.title !== libraryTitle(fixture)))
    return fail("FIXTURE_OWNERSHIP_MISMATCH");
  const [image] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, fixture.image));
  if (
    image &&
    (image.uploaderId !== fixture.owner ||
      image.objectKey !== fixture.image + ".webp" ||
      image.storageBackend !== "local")
  )
    return fail("FIXTURE_OWNERSHIP_MISMATCH");
  const [video] = await db.select().from(videoAssets).where(eq(videoAssets.id, fixture.video));
  if (
    video &&
    (video.uploaderId !== fixture.owner ||
      video.objectKey !== fixture.video + ".mp4" ||
      video.storageBackend !== "local")
  )
    return fail("FIXTURE_OWNERSHIP_MISMATCH");
}
async function cleanup(db: Database, workspace: string, fixture: Fixture) {
  await checkOwnership(db, fixture);
  // Real completion creates an immutable participant audit. Never disable, truncate or delete that history.
  const revisions = await db
    .select({ id: eventResultRevisions.id })
    .from(eventResultRevisions)
    .where(eq(eventResultRevisions.postId, fixture.post));
  if (revisions.length) return fail("SOURCE_FIXTURE_ALREADY_COMPLETED");
  await db.transaction(async (tx) => {
    await tx
      .delete(mediaAssets)
      .where(and(eq(mediaAssets.id, fixture.image), eq(mediaAssets.uploaderId, fixture.owner)));
    await tx
      .delete(videoAssets)
      .where(and(eq(videoAssets.id, fixture.video), eq(videoAssets.uploaderId, fixture.owner)));
    await tx
      .delete(eventRecords)
      .where(and(eq(eventRecords.postId, fixture.post), eq(eventRecords.ownerId, fixture.owner)));
    await tx
      .delete(templateProvenance)
      .where(
        and(
          eq(templateProvenance.postId, fixture.post),
          eq(templateProvenance.entryId, fixture.library),
        ),
      );
    await tx
      .delete(libraryEntries)
      .where(
        and(eq(libraryEntries.id, fixture.library), eq(libraryEntries.ownerId, fixture.owner)),
      );
    await tx
      .delete(posts)
      .where(and(eq(posts.id, fixture.post), eq(posts.authorId, fixture.owner)));
    for (const id of [fixture.owner, fixture.member])
      await tx.execute(sql`delete from auth.users where id=${id}::uuid`);
  });
  for (const kind of ["image", "video"] as const) {
    const target = containedPath(
      workspace,
      kind === "image"
        ? ".local/uploads/" + fixture.image + ".webp"
        : ".local/videos/" + fixture.video + ".mp4",
    );
    if (await present(target)) {
      const safe = await mediaFile(workspace, fixture, kind);
      const expected = kind === "image" ? fixture.imageSha256 : fixture.videoSha256;
      if (checksum(await readFile(safe)) !== expected) return fail("FIXTURE_MEDIA_CHANGED");
      await unlink(safe);
    }
  }
  const file = await safeFilePath(workspace, manifestName, false);
  const saved = await loadFixture(workspace);
  if (saved.fixtureId !== fixture.fixtureId) return fail("FIXTURE_OWNERSHIP_MISMATCH");
  await unlink(file);
}
function safeDiagnostic(stage: string, error: unknown) {
  const summary: Record<string, string> = { stage };
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const candidate = current as Record<string, unknown>;
    for (const name of ["code", "constraint_name", "table_name"] as const) {
      const value = candidate[name];
      if (typeof value === "string" && /^[A-Za-z0-9_]{1,100}$/.test(value)) summary[name] = value;
    }
    current = candidate.cause;
  }
  return summary;
}
async function prepare(db: Database, workspace: string) {
  const manifest = await safeFilePath(workspace, manifestName, true);
  if (await present(manifest)) return fail("FIXTURE_ALREADY_EXISTS");
  if (!ffmpeg) return fail("MEDIA_GENERATOR_UNAVAILABLE");
  const picture = await sharp({
    create: { width: 32, height: 32, channels: 4, background: "#0A84FE" },
  })
    .webp()
    .toBuffer();
  const movie = await execute(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=32x32:r=8",
      "-t",
      "1",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "frag_keyframe+empty_moov",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 20000, windowsHide: true },
  );
  const bytes = movie.stdout;
  if (bytes.length < 20 || bytes.subarray(4, 8).toString("ascii") !== "ftyp")
    return fail("MEDIA_GENERATOR_FAILED");
  const fixture: Fixture = {
    version: 1,
    state: "preparing",
    fixtureId: randomUUID(),
    owner: randomUUID(),
    member: randomUUID(),
    post: randomUUID(),
    application: randomUUID(),
    message: randomUUID(),
    library: randomUUID(),
    edition: randomUUID(),
    image: randomUUID(),
    video: randomUUID(),
    imageBytes: picture.length,
    videoBytes: bytes.length,
    imageSha256: checksum(picture),
    videoSha256: checksum(bytes),
  };
  await writeFile(manifest, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  let stage = "write_media";
  try {
    await writeFile(await mediaFile(workspace, fixture, "image", true), picture, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(await mediaFile(workspace, fixture, "video", true), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    const now = new Date(),
      startsAt = new Date(now.getTime() - 7200000),
      endsAt = new Date(now.getTime() - 3600000),
      arrival = new Date(now.getTime() - 5400000);
    await db.transaction(async (tx) => {
      const connection = tx as unknown as Database;
      stage = "create_members";
      for (const [id, nickname] of [
        [fixture.owner, ownerName(fixture)],
        [fixture.member, memberName(fixture)],
      ] as const) {
        await tx.execute(sql`insert into auth.users(id) values(${id}::uuid)`);
        await tx.insert(profiles).values({ id, nickname });
      }
      stage = "parse_library";
      const library = libraryInputSchema.parse({
        kind: "template",
        categorySlug: "party",
        title: libraryTitle(fixture),
        summary: "백업과 격리 복원 과정에서 실제 참가와 기록 연결을 확인하는 무료 템플릿입니다.",
        scenario:
          "참가자는 정해진 순서에 따라 짧은 협력 미션을 수행한 뒤 운영 회고를 함께 진행합니다.",
        rules: "서로의 의견을 듣고 정해진 순서와 안전 수칙을 지켜주세요.",
        hostGuide: "진행자는 미션과 시간을 설명하고 마지막에 진행 결과를 정리해주세요.",
        materials: ["기록지"],
        rounds: [{ name: "협력 미션", seconds: 300 }],
        tags: [],
        minPlayers: 1,
        maxPlayers: 4,
        durationMinutes: 60,
        priceKRW: 0,
        usageTerms: "격리된 로컬 복원 검증용 자료입니다.",
        allowDerivatives: true,
        allowCommercialUse: false,
      });
      stage = "create_library";
      await tx.insert(libraryEntries).values({
        ...library,
        id: fixture.library,
        ownerId: fixture.owner,
        status: "published",
        publishedVersion: 1,
      });
      stage = "create_edition";
      await tx.insert(libraryVersions).values({
        id: fixture.edition,
        entryId: fixture.library,
        number: 1,
        content: library,
        changeSummary: "복원 검증용 발행본",
        publisherId: fixture.owner,
      });
      stage = "create_event";
      await tx.insert(posts).values({
        id: fixture.post,
        authorId: fixture.owner,
        kind: "모집",
        categorySlug: "party",
        title: postTitle(fixture),
        bodyMarkdown: "백업 복원을 검증한 뒤 제거하는 임시 행사입니다.",
        location: "로컬 복원 검증 장소",
      });
      stage = "create_settings";
      await tx
        .insert(eventSettings)
        .values({ postId: fixture.post, amountKRW: 0, capacity: 4, startsAt, endsAt });
      const [host] = await tx
        .select({ publicId: profiles.publicId })
        .from(profiles)
        .where(eq(profiles.id, fixture.owner));
      stage = "create_provenance";
      await tx.insert(templateProvenance).values({
        postId: fixture.post,
        entryId: fixture.library,
        versionId: fixture.edition,
        snapshot: {
          title: library.title,
          category: library.categorySlug,
          summary: library.summary,
          author: ownerName(fixture),
          authorPublicId: host!.publicId,
          minPlayers: library.minPlayers,
          maxPlayers: library.maxPlayers,
          durationMinutes: library.durationMinutes,
          sourceId: fixture.library,
          versionId: fixture.edition,
          versionNumber: 1,
          scenario: library.scenario,
          rules: library.rules,
          materials: library.materials,
          hostGuide: library.hostGuide,
          rounds: library.rounds,
          usageTerms: library.usageTerms,
          allowDerivatives: true,
          allowCommercialUse: false,
        },
      });
      stage = "create_application";
      await tx.insert(eventApplications).values({
        id: fixture.application,
        postId: fixture.post,
        userId: fixture.member,
        source: "site",
        attendeeName: memberName(fixture),
        contact: "restore-fixture@example.invalid",
        amountKRW: 0,
        status: "confirmed",
        confirmedAt: arrival,
        expiresAt: new Date(now.getTime() + 1800000),
        eventStartsAt: startsAt,
        refundConsentAt: arrival,
      });
      stage = "create_manager";
      await tx.insert(roomManagers).values({ postId: fixture.post, userId: fixture.owner });
      stage = "verify_automatic_room_join";
      const [membership] = await tx
        .select()
        .from(roomMembers)
        .where(and(eq(roomMembers.postId, fixture.post), eq(roomMembers.userId, fixture.member)));
      assert.equal(membership?.applicationId, fixture.application);
      stage = "create_room_message";
      await tx.insert(roomMessages).values({
        id: fixture.message,
        postId: fixture.post,
        authorId: fixture.owner,
        body: "복원 검증용 공지입니다. 참가자는 공지를 확인해주세요.",
      });
      stage = "issue_qr_ticket";
      const operations = eventOperationsService(connection, () => arrival),
        ticket = await operations.issue(fixture.member, fixture.post, {
          applicationId: fixture.application,
        });
      stage = "scan_qr_ticket";
      await operations.scan(fixture.owner, fixture.post, { code: ticket.code }, true);
      // Attach source fixtures so the retention policy cannot claim them. Move them to the record only in the scratch transaction.
      stage = "create_image_asset";
      await tx.insert(mediaAssets).values({
        id: fixture.image,
        uploaderId: fixture.owner,
        postId: fixture.post,
        objectKey: fixture.image + ".webp",
        storageBackend: "local",
        contentType: "image/webp",
        byteSize: fixture.imageBytes,
        status: "ready",
      });
      stage = "create_video_asset";
      await tx.insert(videoAssets).values({
        id: fixture.video,
        uploaderId: fixture.owner,
        postId: fixture.post,
        objectKey: fixture.video + ".mp4",
        storageBackend: "local",
        contentType: "video/mp4",
        byteSize: fixture.videoBytes,
        width: 32,
        height: 32,
        durationSeconds: 1,
        status: "ready",
      });
      assert.equal(
        (await tx.select().from(eventRecords).where(eq(eventRecords.postId, fixture.post))).length,
        0,
      );
      assert.equal(
        (
          await tx
            .select()
            .from(eventResultRevisions)
            .where(eq(eventResultRevisions.postId, fixture.post))
        ).length,
        0,
      );
    });
    stage = "finish_manifest";
    fixture.state = "prepared";
    await writeFile(manifest, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600 });
    await checkMedia(workspace, fixture);
    console.log(
      JSON.stringify({
        status: "SOURCE_FIXTURE_PREPARED",
        events: 1,
        applications: 1,
        qrAdmissions: 1,
        rooms: 1,
        libraryEditions: 1,
        mediaFiles: 2,
        sourceCompleted: false,
        notificationRequestsCreated: 0,
      }),
    );
  } catch (error) {
    console.error("Source fixture diagnostic: " + JSON.stringify(safeDiagnostic(stage, error)));
    try {
      await cleanup(db, workspace, fixture);
    } catch {
      return fail("FIXTURE_CLEANUP_REQUIRED");
    }
    return fail("SOURCE_FIXTURE_FAILED");
  }
}
async function rejectsCode(work: () => Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => error instanceof AppError && error.code === code);
}
async function verify(db: Database, fixture: Fixture, restoredRoot: string) {
  if (fixture.state !== "prepared") return fail("FIXTURE_NOT_PREPARED");
  await checkMedia(restoredRoot, fixture);
  await checkOwnership(db, fixture);
  const previousCwd = process.cwd(),
    shared = globalThis as unknown as { sliperConnection?: ReturnType<typeof createDatabase> },
    previousDatabase = shared.sliperConnection,
    rollback = new Error("fixture-only-rollback");
  let verified = false;
  try {
    process.chdir(restoredRoot);
    await db.transaction(async (tx) => {
      const connection = tx as unknown as Database;
      shared.sliperConnection = { db: connection, close: async () => {} };
      const [application] = await tx
          .select()
          .from(eventApplications)
          .where(eq(eventApplications.id, fixture.application)),
        [admission] = await tx
          .select()
          .from(eventAdmissions)
          .where(eq(eventAdmissions.applicationId, fixture.application)),
        [ticket] = await tx
          .select()
          .from(admissionTickets)
          .where(eq(admissionTickets.applicationId, fixture.application)),
        [provenance] = await tx
          .select()
          .from(templateProvenance)
          .where(eq(templateProvenance.postId, fixture.post));
      assert.equal(application?.status, "confirmed");
      assert.equal(application?.postId, fixture.post);
      assert.equal(application?.userId, fixture.member);
      assert.equal(admission?.checkedBy, fixture.owner);
      assert.equal(admission?.postId, fixture.post);
      assert.equal(ticket?.codeHash.length, 64);
      assert.equal(provenance?.versionId, fixture.edition);
      const memberRoom = await participationService(connection).room(fixture.member, fixture.post),
        ownerRoom = await participationService(connection).room(fixture.owner, fixture.post);
      assert.equal(memberRoom.canWrite, false);
      assert.equal(ownerRoom.canWrite, true);
      assert.ok(memberRoom.messages.some((message) => message.id === fixture.message));
      await rejectsCode(
        () => participationService(connection).room(null, fixture.post),
        "UNAUTHENTICATED",
      );
      const operations = eventOperationsService(connection),
        records = recordService(connection);
      assert.equal((await operations.finalize(fixture.owner, fixture.post)).recorded, 1);
      const first = await records.detail(fixture.owner, fixture.post);
      assert.equal(first.attended, 1);
      assert.equal(first.qrAttended, 1);
      assert.equal(first.managerAttended, 0);
      assert.equal(first.snapshot.template?.versionId, fixture.edition);
      assert.equal((await operations.finalize(fixture.owner, fixture.post)).recorded, 0);
      assert.equal(
        (await records.detail(fixture.owner, fixture.post)).completedAt,
        first.completedAt,
      );
      await rejectsCode(() => records.detail(fixture.member, fixture.post), "NOT_FOUND");
      await rejectsCode(() => records.detail(null, fixture.post), "UNAUTHENTICATED");
      await tx
        .update(mediaAssets)
        .set({ postId: null })
        .where(and(eq(mediaAssets.id, fixture.image), eq(mediaAssets.uploaderId, fixture.owner)));
      await tx
        .update(videoAssets)
        .set({ postId: null })
        .where(and(eq(videoAssets.id, fixture.video), eq(videoAssets.uploaderId, fixture.owner)));
      const document: PostDocument = {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "격리 복원된 참가·자료·사진·영상을 행사 회고로 연결하고 접근 권한을 검증합니다.",
              },
            ],
          },
          { type: "image", attrs: { assetId: fixture.image, alt: "복원 검증 사진" } },
          { type: "uploadedVideo", attrs: { assetId: fixture.video } },
        ],
      };
      const saved = await records.save(fixture.owner, fixture.post, {
        expectedUpdatedAt: first.updatedAt,
        purpose:
          "백업에서 참가 확인과 운영 자료를 연결한 행사 기록을 다시 만들 수 있는지 확인합니다.",
        execution: "QR 확인된 참가 내역을 완료 처리한 뒤 사진과 영상을 회고에 연결했습니다.",
        highlights: "원본 자료의 발행 버전과 첨부 미디어를 보존했습니다.",
        improvements: "실서비스 환경에서 정기적인 복원 훈련을 진행합니다.",
        bodyDocument: document,
        relatedPostIds: [],
        libraryIds: [fixture.library],
      });
      const [image] = await tx.select().from(mediaAssets).where(eq(mediaAssets.id, fixture.image)),
        [video] = await tx.select().from(videoAssets).where(eq(videoAssets.id, fixture.video));
      assert.equal(image?.recordOriginPostId, fixture.post);
      assert.equal(video?.recordOriginPostId, fixture.post);
      assert.equal(image?.unattachedSince, null);
      assert.equal(video?.unattachedSince, null);
      await rejectsCode(() => readImage(fixture.image, fixture.member), "NOT_FOUND");
      // A fixture-only public-state transition avoids creating even a scratch notification request.
      await tx
        .update(eventRecords)
        .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(eventRecords.postId, fixture.post));
      const ownerRecord = await records.detail(fixture.owner, fixture.post),
        memberRecord = await records.detail(fixture.member, fixture.post);
      assert.equal(memberRecord.images[0]?.id, fixture.image);
      assert.equal(memberRecord.videos[0]?.id, fixture.video);
      assert.equal(
        memberRecord.links.some((link) => link.id === fixture.library),
        true,
      );
      assert.equal(ownerRecord.bodyDocument?.content.length, saved.bodyDocument?.content.length);
      await rejectsCode(() => records.detail(null, fixture.post), "UNAUTHENTICATED");
      for (const user of [fixture.owner, fixture.member]) {
        const imageResponse = await readImage(fixture.image, user);
        assert.equal(imageResponse.headers.get("Cache-Control"), "private, no-store");
        assert.equal(
          checksum(new Uint8Array(await imageResponse.arrayBuffer())),
          fixture.imageSha256,
        );
        const full = await readVideo(
          fixture.video,
          user,
          new Request("http://127.0.0.1:3000/api/videos/" + fixture.video),
        );
        assert.equal(checksum(new Uint8Array(await full.arrayBuffer())), fixture.videoSha256);
        for (const method of ["GET", "HEAD"]) {
          const response = await readVideo(
            fixture.video,
            user,
            new Request("http://127.0.0.1:3000/api/videos/" + fixture.video, {
              method,
              headers: { Range: "bytes=0-9" },
            }),
          );
          assert.equal(response.status, 206);
          assert.equal(response.headers.get("Cache-Control"), "private, no-store");
          assert.equal(response.headers.get("Content-Range"), "bytes 0-9/" + fixture.videoBytes);
          assert.equal((await response.arrayBuffer()).byteLength, method === "HEAD" ? 0 : 10);
        }
      }
      await rejectsCode(() => readImage(fixture.image, null), "UNAUTHENTICATED");
      for (const method of ["GET", "HEAD"])
        await rejectsCode(
          () =>
            readVideo(
              fixture.video,
              null,
              new Request("http://127.0.0.1:3000/api/videos/" + fixture.video, {
                method,
                headers: { Range: "bytes=0-9" },
              }),
            ),
          "UNAUTHENTICATED",
        );
      const store = localImageObjectStore(restoredRoot);
      assert.equal(
        checksum(await store.read("post", fixture.image + ".webp")),
        fixture.imageSha256,
      );
      assert.equal(
        checksum(await store.read("video", fixture.video + ".mp4")),
        fixture.videoSha256,
      );
      verified = true;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    process.chdir(previousCwd);
    if (previousDatabase) shared.sliperConnection = previousDatabase;
    else delete shared.sliperConnection;
  }
  if (!verified) return fail("RESTORE_FLOW_FAILED");
  assert.equal(
    (await db.select().from(eventRecords).where(eq(eventRecords.postId, fixture.post))).length,
    0,
  );
  assert.equal(
    (await db.select().from(eventResults).where(eq(eventResults.postId, fixture.post))).length,
    0,
  );
  assert.equal(
    (
      await db
        .select()
        .from(eventResultRevisions)
        .where(eq(eventResultRevisions.postId, fixture.post))
    ).length,
    0,
  );
  await checkMedia(restoredRoot, fixture);
  console.log(
    JSON.stringify({
      status: "RESTORED_FLOW_VERIFIED",
      backedUp: {
        events: 1,
        applications: 1,
        qrAdmissions: 1,
        rooms: 1,
        editions: 1,
        mediaFiles: 2,
      },
      completionAndRecordVerified: true,
      repeatedCompletionVerified: true,
      recordMediaProtected: true,
      ownerAndMemberMediaVerified: true,
      guestGetHeadRangeDenied: true,
      publicEditionLinked: true,
      mediaReadFromRestoredRoot: true,
      scratchFlowRolledBack: true,
      notificationRequestsCreated: 0,
      deliveryWorkersStarted: false,
      originalDatabaseModified: false,
      originalMediaModified: false,
    }),
  );
}

let connection: ReturnType<typeof createDatabase> | undefined;
try {
  const args = argumentsFor();
  localConfiguration(process.env);
  const workspace = await realpath(process.cwd()),
    sourceUrl = new URL(process.env.DATABASE_URL!);
  if (args.mode === "verify") {
    const database = restoreDatabase(args.database!),
      expected = containedPath(workspace, ".local/restores/" + database);
    if (path.resolve(args.root!).toLowerCase() !== expected.toLowerCase())
      fail("INVALID_RESTORE_ROOT");
    const safe = await ensurePath(workspace, ".local/restores/" + database, false),
      restoredRoot = await realpath(safe);
    if (restoredRoot.toLowerCase() !== expected.toLowerCase()) fail("INVALID_RESTORE_ROOT");
    const verifiedFile = await safeFilePath(
      workspace,
      ".local/restores/" + database + "/verified.json",
      false,
    );
    const verified = JSON.parse(await readFile(verifiedFile, "utf8"));
    if (
      verified.status !== "RESTORE_VERIFIED" ||
      verified.scratchDatabase !== database ||
      verified.deliveryWorkersStarted !== false
    )
      fail("BASELINE_RESTORE_VERIFICATION_REQUIRED");
    const fixture = await loadFixture(workspace);
    sourceUrl.pathname = "/" + database;
    connection = createDatabase(sourceUrl.href, 1);
    await verify(connection.db, fixture, restoredRoot);
  } else {
    connection = createDatabase(sourceUrl.href, 1);
    if (args.mode === "prepare") await prepare(connection.db, workspace);
    else {
      const fixture = await loadFixture(workspace);
      await cleanup(connection.db, workspace, fixture);
      console.log(
        JSON.stringify({
          status: "SOURCE_FIXTURE_REMOVED",
          existingAccountsModified: false,
          originalUserDataModified: false,
          permanentAuditDeleted: false,
          backupOrScratchDeleted: false,
        }),
      );
    }
  }
} catch (error) {
  console.error(
    "Backup flow fixture failed: " +
      (error instanceof FixtureFailure ? error.code : "FIXTURE_FAILED"),
  );
  process.exitCode = 1;
} finally {
  if (connection) await connection.close();
}
