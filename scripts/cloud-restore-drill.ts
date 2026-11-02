import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, writeFile, readFile, lstat, realpath, rm, unlink } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  CloudCaptureError,
  execute,
  fail,
  identifier,
  pgEnvironment,
  readCloudCapture,
  sameSnapshot,
  snapshot,
} from "./lib/cloud-capture";
import {
  backupId,
  containedPath,
  decryptFile,
  ensurePath,
  hashFile,
  privateDirectory,
} from "./lib/local-backup-core";

let connection: ReturnType<typeof postgres> | undefined,
  root: string | undefined,
  pgdata: string | undefined,
  bin: string | undefined;
let report: Record<string, unknown> | undefined,
  success = false;
const token = randomBytes(16).toString("hex");
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") return fail("LOCAL_PORT");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
function native(name: string) {
  return path.join(bin!, name + (process.platform === "win32" ? ".exe" : ""));
}
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--backup" || !args[1]) fail("USAGE_BACKUP_ID_REQUIRED");
  const id = backupId(args[1]);
  const captured = await readCloudCapture(process.cwd(), id);
  bin =
    process.platform === "win32"
      ? "C:/Program Files/PostgreSQL/18/bin"
      : "/usr/lib/postgresql/18/bin";
  const parent = await ensurePath(process.cwd(), ".local/cloud-restore-drills", true);
  await privateDirectory(parent);
  root = containedPath(parent, id + "_" + token.slice(0, 8));
  await mkdir(root);
  await privateDirectory(root);
  await writeFile(
    containedPath(root, "isolation.json"),
    JSON.stringify({ kind: "sliper-isolated-cloud-restore", token, root }),
    { flag: "wx", mode: 0o600 },
  );
  const dump = containedPath(root, "database.pgdump");
  await decryptFile(
    containedPath(captured.root, captured.manifest.database.path),
    dump,
    captured.key,
    id,
    captured.manifest.database,
  );
  for (const object of captured.manifest.objects) {
    const relative = object.file.path.slice(0, -4);
    await ensurePath(root, path.posix.dirname(relative), true);
    const destination = containedPath(root, relative);
    await decryptFile(
      containedPath(captured.root, object.file.path),
      destination,
      captured.key,
      id,
      object.file,
    );
    const h = await hashFile(destination, object.file.plainBytes);
    if (h.bytes !== object.file.plainBytes || h.sha256 !== object.file.plainSha256)
      fail("RESTORED_OBJECT_HASH");
  }
  const password = randomBytes(32).toString("hex"),
    pwfile = containedPath(root, "bootstrap-password"),
    log = containedPath(root, "postgres-private.log");
  await writeFile(pwfile, password + "\n", { flag: "wx", mode: 0o600 });
  pgdata = containedPath(root, "pgdata");
  const cleanEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    ...Object.fromEntries(
      ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap((k) =>
        process.env[k] ? [[k, process.env[k]]] : [],
      ),
    ),
  };
  await execute(
    native("initdb"),
    [
      "--pgdata=" + pgdata,
      "--username=sliper_restore_admin",
      "--pwfile=" + pwfile,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
    ],
    { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024, env: cleanEnv },
  );
  await unlink(pwfile);
  const port = await freePort();
  // No caller-supplied URL, database name or runtime env can become the restore target.
  await execute(
    native("pg_ctl"),
    [
      "--pgdata=" + pgdata,
      "--log=" + log,
      "--wait",
      "--timeout=30",
      "-o",
      "-h 127.0.0.1 -p " +
        port +
        " -c max_connections=10 -c log_statement=none -c log_min_messages=panic",
      "start",
    ],
    { windowsHide: true, timeout: 40000, maxBuffer: 65536, env: cleanEnv },
  );
  const local =
    "postgresql://sliper_restore_admin:" +
    password +
    "@127.0.0.1:" +
    port +
    "/postgres?sslmode=disable";
  connection = postgres(local, { max: 1, prepare: false, connect_timeout: 5, onnotice() {} });
  for (const role of captured.manifest.roles) {
    const existing = await connection.unsafe("select 1 from pg_roles where rolname=$1", [role]);
    if (!existing.length)
      await connection.unsafe(
        "create role " + identifier(role) + " nologin nosuperuser nobypassrls",
      );
  }
  await connection.unsafe("create database sliper_recovery template template0 encoding 'UTF8'");
  await connection.end({ timeout: 2 });
  connection = undefined;
  const target = local.replace("/postgres?", "/sliper_recovery?");
  connection = postgres(target, { max: 1, prepare: false, connect_timeout: 5, onnotice() {} });
  await connection.unsafe("create schema extensions");
  for (const extension of ["pgcrypto", "uuid-ossp"])
    await connection.unsafe('create extension "' + extension + '" with schema extensions');
  await connection.unsafe("create extension pg_trgm with schema public");
  try {
    await execute(
      native("pg_restore"),
      [
        "--dbname=sliper_recovery",
        "--no-password",
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
        "--no-publications",
        "--no-subscriptions",
        dump,
      ],
      {
        windowsHide: true,
        timeout: 180000,
        maxBuffer: 2 * 1024 * 1024,
        env: pgEnvironment(target),
      },
    );
  } catch (error) {
    // Only whitelist a schema/function dependency category. Never display COPY rows or native stderr.
    const stderr =
      error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
    const category =
      /ERROR:\s+(type|function|schema|extension|role|operator class)\b/.exec(stderr)?.[1] ??
      "other";
    fail("PG_RESTORE_FAILED_" + category.toUpperCase().replaceAll(" ", "_"));
  }
  const restored = await connection.begin("isolation level repeatable read read only", (tx) =>
    snapshot(async (text) => Array.from(await tx.unsafe(text))),
  );
  try {
    sameSnapshot(restored, captured.manifest.snapshot);
  } catch {
    const expected = captured.manifest.snapshot;
    const rowMismatches = Object.keys(expected.tables).filter(
      (n) => JSON.stringify(restored.tables[n]) !== JSON.stringify(expected.tables[n]),
    );
    const structural = expected.structure.flatMap((row, index) => {
      const actual = restored.structure[index];
      const fields = Object.keys(row).filter(
        (k) => JSON.stringify(row[k]) !== JSON.stringify(actual?.[k]),
      );
      return fields.length
        ? [
            {
              table: String(row.schema) + "." + String(row.name),
              fields,
              expectedConstraints: row.constraints,
              actualConstraints: actual?.constraints,
            },
          ]
        : [];
    });
    await writeFile(
      ".local/cloud-restore-diff.json",
      JSON.stringify(
        { rowMismatchCount: rowMismatches.length, rowMismatchTables: rowMismatches, structural },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    fail("RESTORE_SNAPSHOT_MISMATCH");
  }
  await connection.end({ timeout: 2 });
  connection = undefined;
  report = {
    status: "CLOUD_LOCAL_LOGICAL_RESTORE_VERIFIED",
    backup: id,
    tables: Object.keys(restored.tables).length,
    authTables: Object.keys(restored.tables).filter((n) => n.startsWith("auth.")).length,
    objects: captured.manifest.objects.length,
    objectBytes: captured.manifest.objects.reduce((n, o) => n + o.file.plainBytes, 0),
    rowDigestsMatched: true,
    rlsIndexConstraintCountsMatched: true,
    mediaHashesMatched: true,
    sourceDatabaseModified: false,
    sourceStorageModified: false,
    deliveryWorkersStarted: false,
    managedSupabaseAuthLoginVerified: false,
    managedSupabaseStorageUploadVerified: false,
    restoreTarget: "fresh loopback PostgreSQL 18 process",
    encryptedSourcePackagePreserved: true,
  };
  success = true;
} catch (error) {
  console.error(
    JSON.stringify({
      status: "CLOUD_RESTORE_FAILED",
      code: error instanceof CloudCaptureError ? error.code : "RESTORE_FAILURE",
      secretsDisplayed: false,
    }),
  );
  process.exitCode = 1;
} finally {
  await connection?.end({ timeout: 2 }).catch(() => {});
  let stopped = true;
  if (root && pgdata && bin) {
    try {
      await lstat(path.join(pgdata, "postmaster.pid"));
      await execute(
        native("pg_ctl"),
        ["--pgdata=" + pgdata, "--wait", "--timeout=30", "--mode=fast", "stop"],
        { windowsHide: true, timeout: 40000, maxBuffer: 65536 },
      );
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
        stopped = false;
    }
  }
  if (root) {
    try {
      const isolation = JSON.parse(await readFile(containedPath(root, "isolation.json"), "utf8"));
      const parent = path.resolve(process.cwd(), ".local/cloud-restore-drills");
      if (
        isolation.token !== token ||
        isolation.root !== root ||
        path.dirname(root) !== parent ||
        (await realpath(root)) !== root ||
        (await lstat(root)).isSymbolicLink()
      )
        fail("CLEANUP_IDENTITY");
      if (!stopped) fail("RESTORE_CLUSTER_STOP_FAILED");
      // Delete only this authenticated, newly created restore run. Never delete a backup or user DB.
      await rm(root, { recursive: true, force: false });
    } catch {
      success = false;
      process.exitCode = 1;
      console.error(
        JSON.stringify({
          status: "PRIVATE_RESTORE_CLEANUP_REQUIRES_ATTENTION",
          sourceModified: false,
        }),
      );
    }
  }
  if (success && report) {
    report.plaintextScratchRemoved = true;
    report.scratchDatabaseStopped = true;
    await writeFile(".local/cloud-restore-latest.json", JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(JSON.stringify(report));
  }
}
