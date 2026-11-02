import nextEnv from "@next/env";
import { parse } from "dotenv";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import {
  backupPreflightReport,
  cloudBackupConfiguration,
  pgToolMajor,
  restoreTargetInventory,
  sourceBackupInventory,
  type BackupCheck,
  type BackupEnvironment,
  type BackupQuery,
} from "./lib/cloud-backup-preflight";
const execute = promisify(execFile);
const args = process.argv.slice(2);
const usage = "Usage: node --import tsx scripts/cloud-backup-preflight.ts [--env-file PATH]";
if (args.includes("--help"))
  console.log(
    usage +
      "\nRead-only DB/private bucket and separate restore-target checks. Never dumps, restores, downloads objects or starts delivery workers. Environment files are not mixed when --env-file is supplied.",
  );
else {
  const checks: BackupCheck[] = [];
  let inventory: Awaited<ReturnType<typeof sourceBackupInventory>> | undefined;
  let targetInventory: Awaited<ReturnType<typeof restoreTargetInventory>> | undefined;
  try {
    if (
      args.length !== 0 &&
      !(args.length === 2 && args[0] === "--env-file" && args[1] && !args[1].startsWith("--"))
    )
      throw new Error();
    let env: BackupEnvironment;
    if (args.length) env = parse(readFileSync(path.resolve(args[1]!)));
    else {
      nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
      env = process.env;
    }
    const config = cloudBackupConfiguration(env);
    checks.push({
      id: "project-isolation",
      status: "pass",
      message:
        "Source DB and private Storage configuration refer to the same project; an optional restore target must refer to a different project.",
    });
    async function readonly<T>(url: string, work: (query: BackupQuery) => Promise<T>) {
      const client = postgres(url, {
        max: 1,
        prepare: false,
        connect_timeout: 8,
        idle_timeout: 2,
        onnotice() {},
        connection: {
          application_name: "sliper-backup-readonly-preflight",
          statement_timeout: 8000,
          lock_timeout: 2000,
        },
      });
      try {
        return await client.begin("isolation level repeatable read read only", async (tx) =>
          work(async (text) => Array.from(await tx.unsafe(text))),
        );
      } finally {
        await client.end({ timeout: 1 }).catch(() => {});
      }
    }
    try {
      inventory = await readonly(config.source, sourceBackupInventory);
      checks.push({
        id: "source-inventory",
        status: inventory.localReferences ? "fail" : "pass",
        message: inventory.localReferences
          ? "Local referenced media must be migrated before a cloud backup."
          : "Read-only app/media metadata inventory completed. Object bytes are not yet backed up or verified.",
      });
    } catch {
      checks.push({
        id: "source-inventory",
        status: "fail",
        message:
          "Read-only source inventory failed; check connection and read permissions. Raw database errors are suppressed.",
      });
    }
    checks.push({
      id: "dump-session",
      status: config.dump ? "pass" : "warn",
      message: config.dump
        ? "A same-project direct/session-pooler BACKUP_DATABASE_URL is configured. Dump capture and permissions remain to be verified."
        : "Add BACKUP_DATABASE_URL with TLS via direct connection or session pooler port 5432 to the private backup environment; transaction pooler is unsuitable for this backup path.",
    });
    try {
      const pgVersion = async (name: "pg_dump" | "pg_restore") => {
        const executable = env.POSTGRES_BIN
          ? path.join(
              path.resolve(env.POSTGRES_BIN),
              name + (process.platform === "win32" ? ".exe" : ""),
            )
          : process.platform === "win32"
            ? path.join("C:/Program Files/PostgreSQL/18/bin", name + ".exe")
            : name;
        const result = await execute(executable, ["--version"], {
          windowsHide: true,
          timeout: 5000,
          maxBuffer: 8192,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: "production",
          },
        });
        return pgToolMajor(result.stdout, name);
      };
      const dump = await pgVersion("pg_dump"),
        restore = await pgVersion("pg_restore");
      const ready = !!inventory && dump >= inventory.serverMajor && restore >= dump;
      checks.push({
        id: "postgres-tools",
        status: ready ? "pass" : "fail",
        message: ready
          ? "Native dump/restore tool versions support the source server major version."
          : "Use pg_dump at least as new as the source server and pg_restore at least as new as pg_dump.",
      });
    } catch {
      checks.push({
        id: "postgres-tools",
        status: "fail",
        message:
          "Install matching PostgreSQL pg_dump and pg_restore tools or set POSTGRES_BIN in the backup-only environment.",
      });
    }
    try {
      const api = createClient(config.storageUrl, config.storageKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: {
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              redirect: "error",
              cache: "no-store",
              signal: AbortSignal.timeout(8000),
            }),
        },
      });
      const bucket = await api.storage.getBucket(config.bucket);
      if (bucket.error || !bucket.data || bucket.data.public !== false) throw new Error();
      checks.push({
        id: "private-storage",
        status: "pass",
        message:
          "The source bucket exists and is private. Storage object bytes require a separate encrypted capture; a DB dump is insufficient.",
      });
    } catch {
      checks.push({
        id: "private-storage",
        status: "fail",
        message:
          "Private source bucket could not be verified; no object was downloaded or changed.",
      });
    }
    if (config.restore) {
      try {
        targetInventory = await readonly(config.restore, restoreTargetInventory);
        checks.push({
          id: "restore-target",
          status: targetInventory.emptyApplication ? "pass" : "fail",
          message: targetInventory.emptyApplication
            ? "The separate restore project has no Sliper tables or Auth users; no restore was performed."
            : "The restore project contains app tables or Auth users. Choose a new empty project; this tool never resets a target.",
        });
      } catch {
        checks.push({
          id: "restore-target",
          status: "fail",
          message:
            "Could not inspect the separate target; verify its TLS session connection and read permissions.",
        });
      }
    } else
      checks.push({
        id: "restore-target",
        status: "warn",
        message:
          "Prepare a separate empty Supabase project and BACKUP_RESTORE_PROJECT_URL/BACKUP_RESTORE_DATABASE_URL. The source project is never a valid restore target.",
      });
    checks.push({
      id: "restore-drill",
      status: "warn",
      message:
        "Encrypted DB/Auth + Storage capture, a consistent maintenance window, off-server copy and isolated restore rehearsal still need to be performed. These checks are not a recovery certificate.",
    });
  } catch {
    checks.push({
      id: "configuration",
      status: "fail",
      message:
        "Backup configuration is missing, mismatches the source project, uses unsafe connection options, or points the restore target at the source. Values and raw errors are suppressed.",
    });
  }
  const report = {
    ...backupPreflightReport(checks),
    ...(inventory ? { inventory } : {}),
    ...(targetInventory ? { targetInventory } : {}),
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.summary.fail) process.exitCode = 1;
}
