import "dotenv/config";
import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "../src/db/connection";
import { profiles } from "../src/db/schema";
import { staffRoles } from "../src/db/safety-schema";
import { DEMO_POSTS, DEMO_COMMENTS } from "../src/demo/data";
import { loadLocalTestAccount } from "../src/server/local-test-auth";
const address = new URL(process.env.MIGRATION_DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  !["postgres:", "postgresql:"].includes(address.protocol) ||
  address.hostname !== "127.0.0.1" ||
  address.port !== "55432" ||
  address.pathname !== "/sliper_dev"
)
  throw new Error("Only the isolated local Sliper database is supported.");
function sampleId(name: string) {
  const h = createHash("sha256").update(`sliper:sample:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
const fixtureIds = [
  "00000000-0000-4000-8000-000000000001",
  ...(account ? [account.userId] : []),
  ...[
    ...DEMO_POSTS.map((p) => p.author),
    ...DEMO_COMMENTS.map((c) => c.author),
    "슬리퍼 콘텐츠팀",
    "player-demo-brain",
    "player-demo-physical",
    "player-demo-trickster",
    "external-participation-demo-member-1",
    "external-participation-demo-member-2",
    "external-participation-demo-member-3",
  ].map(sampleId),
];
const connection = createDatabase(address.href, 1);
try {
  await migrate(connection.db, { migrationsFolder: "./drizzle" });
  const changed = await connection.db
    .update(profiles)
    .set({ analyticsExcluded: true })
    .where(inArray(profiles.id, fixtureIds))
    .returning({ id: profiles.id });
  const roles = await connection.db.select({ role: staffRoles.role }).from(staffRoles);
  console.log(
    JSON.stringify({
      migrated: true,
      localFixturesExcluded: changed.length,
      hasAdministrator: roles.some((r) => r.role === "admin"),
    }),
  );
} finally {
  await connection.close();
}
