import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { contentRestrictions, memberBlocks } from "../src/db/safety-schema";
import type { Database } from "../src/db/connection";
import { CATEGORIES } from "../src/domain/categories";
import { participationService } from "../src/server/participation-service";
import { communityService } from "../src/server/community-service";
import { libraryService } from "../src/server/library-service";
import { legacyLocalActorAllowed } from "../src/server/local-test-access";
import { AppError } from "../src/server/errors";
const pg = new PGlite(),
  db = drizzle(pg),
  database = db as unknown as Database,
  service = participationService(database);
let owner: string, viewer: string, other: string;
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
before(async () => {
  await pg.exec(
    "create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;",
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.categories).values([...CATEGORIES]);
});
beforeEach(async () => {
  await pg.exec("truncate auth.users cascade");
  [owner, viewer, other] = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of [owner, viewer, other]) {
    await pg.query("insert into auth.users values($1)", [id]);
    await db.insert(schema.profiles).values({
      id,
      nickname: "권한검증",
      phoneNumber: "01012345678",
      profileCompletedAt: new Date(),
      onboardingConsentAt: new Date(),
    });
  }
});
after(() => pg.close());
async function event(authorId: string | null = owner) {
  const [p] = await db
    .insert(schema.posts)
    .values({
      authorId,
      categorySlug: "party",
      kind: "모집",
      title: "권한 확인 모집",
      bodyMarkdown: "공개 범위 확인",
      location: "테스트 장소",
    })
    .returning();
  await db
    .insert(schema.eventSettings)
    .values({ postId: p!.id, capacity: 2, amountKRW: 0, open: true });
  return p!.id;
}
test("public event API agrees with normal detail on moderator hiding; private owner management remains available", async () => {
  const id = await event();
  await db
    .insert(contentRestrictions)
    .values({ targetType: "post", targetId: id, hidden: true, reason: "검증", updatedBy: owner });
  await assert.rejects(service.overview(null, id), code("NOT_FOUND"));
  await assert.rejects(service.overview(owner, id), code("NOT_FOUND"));
  await assert.rejects(communityService(database).detail(id, null), code("NOT_FOUND"));
  const configured = await service.configure(owner, id, { amountKRW: 0, capacity: 3, open: false });
  assert.equal(configured.isOwner, true);
  assert.equal(configured.config!.capacity, 3);
  await assert.rejects(
    service.configure(viewer, id, { amountKRW: 0, capacity: 3, open: false }),
    code("FORBIDDEN"),
  );
});
test("blocked and hidden applications are refused before any application mutation", async () => {
  const id = await event();
  await db
    .insert(memberBlocks)
    .values({ blockerId: viewer, blockedId: owner, displayLabel: "차단검증" });
  await assert.rejects(service.overview(viewer, id), code("NOT_FOUND"));
  await assert.rejects(
    service.apply(viewer, id, { consent: true, note: "" }, null),
    code("NOT_FOUND"),
  );
  assert.equal((await db.select().from(schema.eventApplications)).length, 0);
  await db
    .update(schema.posts)
    .set({ applicationUrl: "https://example.com/apply" })
    .where(eq(schema.posts.id, id));
  await assert.rejects(
    service.claimExternal(viewer, id, { externalReference: "ORDER-TEST", consent: true }),
    code("NOT_FOUND"),
  );
  assert.equal((await db.select().from(schema.eventApplications)).length, 0);
  assert.equal((await service.overview(other, id)).isOwner, false);
});
test("anonymous viewers of orphaned recruitment never get owner/manager flags", async () => {
  const id = await event();
  await db.delete(schema.profiles).where(eq(schema.profiles.id, owner));
  const view = await service.overview(null, id);
  assert.equal(view.isOwner, false);
  assert.equal(view.canManage, false);
  assert.equal(view.canApply, false);
});
test("library updates reject unauthenticated callers before inspecting expensive payloads", async () => {
  const payload = new Proxy(
      {},
      {
        get() {
          throw Error("payload must not be inspected");
        },
        ownKeys() {
          throw Error("payload must not be inspected");
        },
      },
    ),
    library = libraryService(database);
  await assert.rejects(library.update(null, randomUUID(), payload), code("UNAUTHENTICATED"));
  await assert.rejects(library.saveDraft(null, randomUUID(), payload), code("UNAUTHENTICATED"));
  await assert.rejects(library.update(viewer, randomUUID(), payload), code("NOT_FOUND"));
});
test("loopback Host cannot grant the legacy actor when a LAN address is configured", () => {
  const env = {
    NODE_ENV: "development",
    LOCAL_DATABASE: "1",
    SLIPER_AUTH_MODE: "local",
  } as NodeJS.ProcessEnv;
  assert.equal(
    legacyLocalActorAllowed("localhost:3000", { ...env, SLIPER_LAN_HOST: "192.168.1.9" }),
    false,
  );
  assert.equal(
    legacyLocalActorAllowed("127.0.0.1:3000", { ...env, SLIPER_LAN_HOST: "192.168.1.9" }),
    false,
  );
  assert.equal(
    legacyLocalActorAllowed("192.168.1.9:3000", { ...env, SLIPER_LAN_HOST: "192.168.1.9" }),
    false,
  );
  assert.equal(
    legacyLocalActorAllowed("localhost:3000", { ...env, NODE_ENV: "production" }),
    false,
  );
});
