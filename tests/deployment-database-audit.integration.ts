import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  auditDeploymentDatabase,
  readDatabaseAuditManifest,
  type DatabaseAuditQuery,
} from "../scripts/lib/deployment-database-audit";

function localConnection() {
  try {
    const value = process.env.DATABASE_URL ?? "";
    const address = new URL(value);
    if (
      process.env.LOCAL_DATABASE !== "1" ||
      process.env.SLIPER_AUTH_MODE !== "development" ||
      !["postgres:", "postgresql:"].includes(address.protocol) ||
      address.hostname !== "127.0.0.1" ||
      address.port !== "55432" ||
      address.pathname !== "/sliper_dev"
    )
      throw new Error();
    return value;
  } catch {
    throw new Error("DB audit integration checks require the isolated local development database.");
  }
}
test("native DB audit faithfully reports real journal agreement or drift without treating test success as release readiness", async (context) => {
  const client = postgres(localConnection(), {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    onnotice() {},
    connection: {
      statement_timeout: 8000,
      lock_timeout: 2000,
      application_name: "sliper-local-readonly-audit-test",
    },
  });
  try {
    const { report, differingEntries } = await client.begin(
      "isolation level repeatable read read only",
      async (transaction) => {
        // Independent oracle: read the journal directly and compare each file's timestamp/hash.
        // Keep both checks in the same snapshot; do not reuse the audit's comparison or status.
        const expected = readMigrationFiles({ migrationsFolder: "./drizzle" });
        const applied = await transaction<
          { hash: string; applied_at: string }[]
        >`select hash,created_at::text as applied_at from drizzle.__drizzle_migrations order by created_at,id`;
        let differingEntries = 0;
        for (let index = 0; index < Math.max(expected.length, applied.length); index++) {
          if (
            !expected[index] ||
            !applied[index] ||
            expected[index]!.hash !== applied[index]!.hash ||
            String(expected[index]!.folderMillis) !== applied[index]!.applied_at
          )
            differingEntries++;
        }
        const query: DatabaseAuditQuery = async <Row extends Record<string, unknown>>(
          text: string,
        ) => Array.from(await transaction.unsafe<Row[]>(text));
        const report = await auditDeploymentDatabase(
          query,
          readDatabaseAuditManifest(),
          "local-diagnostic",
        );
        return { report, differingEntries };
      },
    );
    assert.equal(report.scope, "local-diagnostic");
    assert.equal(report.releaseApproval, "not-performed");
    const row = (id: string) => report.checks.find((check) => check.id === id)!;
    for (const id of [
      "transaction",
      "table-inventory",
      "table-access",
      "function-access",
      "browser-isolation",
    ])
      assert.equal(row(id).status, "pass", "The local catalog fixture must satisfy " + id + ".");
    assert.equal(row("target-environment").status, "warn");
    assert.equal(
      row("migrations").status,
      differingEntries === 0 ? "pass" : "fail",
      "The audit must exactly reflect the independent journal comparison.",
    );
    if (differingEntries > 0)
      assert.ok(
        report.summary.fail > 0,
        "Detected migration drift must remain a failed DB readiness check.",
      );
    context.diagnostic(
      `Local journal mismatch entries: ${differingEntries}. Test success validates detection; it does not approve DB release readiness.`,
    );
    const serialized = JSON.stringify(report);
    for (const [name, value] of Object.entries(process.env))
      if (value && value.length > 12 && /DATABASE_URL|SECRET|PRIVATE_KEY/.test(name))
        assert.equal(
          serialized.includes(value),
          false,
          "The audit must not return an environment value.",
        );
  } finally {
    await client.end({ timeout: 1 });
  }
});
