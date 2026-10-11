import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase, type Database } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { libraryEntries, librarySuggestions, libraryVersions } from "../src/db/library-schema";
import { libraryService } from "../src/server/library-service";
import { libraryCollaborationService } from "../src/server/library-collaboration-service";
import { AppError } from "../src/server/errors";
const url = new URL(process.env.DATABASE_URL ?? "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw Error("Isolated local DB required");
const content = {
  kind: "template" as const,
  categorySlug: "mind-games" as const,
  title: "native-collaboration-" + randomUUID(),
  summary: "실제 PostgreSQL 두 연결에서 원본 보존과 동시 승인을 확인하는 운영 자료입니다.",
  scenario: "참가자가 역할을 정하고 단서를 찾아 협력하는 추리 게임을 순서대로 진행합니다.",
  rules: "참가자는 역할을 서로 공개하지 않으며 라운드마다 단서를 하나씩 제시합니다.",
  hostGuide: "진행자는 각 라운드의 목적과 남은 시간을 안내하고 마지막에 정답을 설명합니다.",
  materials: ["역할 카드"],
  rounds: [{ name: "추리", seconds: 300 }],
  tags: ["검사"],
  minPlayers: 2,
  maxPlayers: 10,
  durationMinutes: 60,
  priceKRW: 0,
  purchaseUrl: null,
};
async function member(db: Database, name: string) {
  const id = randomUUID();
  await db.execute(sql`insert into auth.users(id) values(${id}::uuid)`);
  await db.insert(profiles).values({ id, nickname: name });
  return id;
}
test("native PostgreSQL concurrent approvals create one exact edition and preserve the base", async () => {
  const a = createDatabase(url.toString(), 1),
    b = createDatabase(url.toString(), 1);
  let owner = "",
    reader = "",
    entryId = "";
  try {
    owner = await member(a.db, "동시 승인 작성자");
    reader = await member(a.db, "동시 개선 제안자");
    const entry = await libraryService(a.db).create(owner, content);
    entryId = entry.id;
    const replacement =
      "새 규칙에서는 참가자별 토론 시간을 동일하게 보장하고 모든 팀의 단서를 동시에 공개합니다.";
    const s = await libraryCollaborationService(a.db).propose(reader, entry.id, {
      version: 1,
      field: "rules",
      replacement,
      reason: "두 요청이 동시에 승인되어도 같은 개선이 한 번만 반영되어야 합니다.",
      consent: true,
    });
    const payload = {
      decision: "approve",
      expectedUpdatedAt: s.updatedAt,
      expectedLibraryUpdatedAt: entry.updatedAt,
      note: "동시 승인 검사 결과 반영",
      publicContentConsent: true,
    };
    const results = await Promise.allSettled([
      libraryCollaborationService(a.db).decide(owner, entry.id, s.id, payload),
      libraryCollaborationService(b.db).decide(owner, entry.id, s.id, payload),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected");
    if (rejected?.status === "rejected")
      assert.ok(rejected.reason instanceof AppError && rejected.reason.code === "CONFLICT");
    else assert.fail("Expected a stale concurrent decision");
    const versions = await a.db
      .select()
      .from(libraryVersions)
      .where(eq(libraryVersions.entryId, entry.id));
    assert.equal(versions.length, 2);
    assert.equal(
      (await libraryService(b.db).version(owner, entry.id, 1)).content!.rules,
      content.rules,
    );
    assert.equal(
      (await libraryService(b.db).version(owner, entry.id, 2)).content!.rules,
      replacement,
    );
    assert.equal((await libraryService(b.db).detail(owner, entry.id)).draftContent, null);
    assert.equal(
      (await libraryCollaborationService(b.db).detail(reader, entry.id, s.id)).status,
      "approved",
    );
  } finally {
    try {
      if (entryId) {
        await a.db.delete(librarySuggestions).where(eq(librarySuggestions.entryId, entryId));
        await a.db.delete(libraryEntries).where(eq(libraryEntries.id, entryId));
      }
      for (const id of [owner, reader].filter(Boolean))
        await a.db.execute(sql`delete from auth.users where id=${id}::uuid`);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  }
});
