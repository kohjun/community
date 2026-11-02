import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "dotenv";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { cloudBackupConfiguration, supabaseProjectReference } from "./lib/cloud-backup-preflight";
import {
  CloudCaptureError,
  blobStream,
  encryptedDump,
  execute,
  fail,
  snapshot,
  storageBackupPath,
  requireCloudMedia,
  writeCloudManifest,
  type CloudManifest,
} from "./lib/cloud-capture";
import {
  containedPath,
  encryptStream,
  initializeBackup,
  newBackupId,
  verifyPrivate,
  publicFailure,
  storageInventoryQuery,
} from "./lib/local-backup-core";
let db: ReturnType<typeof postgres> | undefined;
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--env-file" || !args[1]) fail("USAGE_ENV_FILE_REQUIRED");
  const env = parse(await readFile(path.resolve(args[1]), "utf8")),
    config = cloudBackupConfiguration(env);
  if (!config.dump) fail("BACKUP_SESSION_CONNECTION_REQUIRED");
  const tool = path.join(
    env.POSTGRES_BIN ?? "C:/Program Files/PostgreSQL/18/bin",
    "pg_dump" + (process.platform === "win32" ? ".exe" : ""),
  );
  const version = await execute(tool, ["--version"], { windowsHide: true, timeout: 5000 });
  const dumpMajor = Number(/^pg_dump \(PostgreSQL\) (\d+)/.exec(version.stdout)?.[1]);
  const api = createClient(config.storageUrl, config.storageKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(60000),
        }),
    },
  });
  const bucket = await api.storage.getBucket(config.bucket);
  if (bucket.error || bucket.data?.public !== false) fail("PRIVATE_BUCKET_REQUIRED");
  db = postgres(config.dump, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice() {},
    connection: {
      application_name: "sliper-encrypted-cloud-capture",
      statement_timeout: 300000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 600000,
    },
  });
  const id = newBackupId(),
    { root, key } = await initializeBackup(process.cwd(), id);
  const result = await db.begin("isolation level repeatable read read only", async (tx) => {
    await tx.unsafe("set local row_security=off");
    await tx.unsafe("set local timezone='UTC'");
    const [settings] = await tx.unsafe(
      "select current_setting('server_version_num') as version,pg_export_snapshot() as snapshot",
    );
    const serverMajor = Math.floor(Number(settings!.version) / 10000);
    if (!Number.isSafeInteger(dumpMajor) || dumpMajor < serverMajor) fail("PG_TOOL_VERSION");
    const inventory = await snapshot(async (text) => Array.from(await tx.unsafe(text)));
    const objects = await tx.unsafe(
      "select name,coalesce((metadata->>'size')::bigint,0)::text as bytes from storage.objects where bucket_id=$1 order by name",
      [config.bucket],
    );
    if (objects.length > 20000 || objects.reduce((s, o) => s + Number(o.bytes), 0) > 10 * 1024 ** 3)
      fail("OBJECT_LIMIT");
    const references = Array.from(await tx.unsafe(storageInventoryQuery));
    requireCloudMedia(
      references,
      objects.map((o) => String(o.name)),
    );
    const roles = await tx.unsafe(
      "select rolname from pg_roles where rolname !~ '^pg_' order by rolname",
    );
    const database = await encryptedDump(
      tool,
      config.dump!,
      String(settings!.snapshot),
      containedPath(root, "database.pgdump.enc"),
      key,
      id,
    );
    const files: CloudManifest["objects"] = [];
    for (const obj of objects) {
      const location = String(obj.name),
        relative = storageBackupPath(location);
      const response = await api.storage.from(config.bucket).download(location);
      if (response.error || !response.data || response.data.size !== Number(obj.bytes))
        fail("OBJECT_CAPTURE_FAILED");
      const descriptor = await encryptStream(
        blobStream(response.data),
        containedPath(root, relative),
        key,
        id,
        relative,
      );
      await verifyPrivate(containedPath(root, relative));
      files.push({ storagePath: location, file: descriptor });
    }
    const manifest: CloudManifest = {
      version: 1,
      kind: "sliper-supabase-capture",
      id,
      capturedAt: new Date().toISOString(),
      project: supabaseProjectReference(config.storageUrl),
      serverMajor,
      bucket: config.bucket,
      database,
      snapshot: inventory,
      roles: roles.map((r) => String(r.rolname)),
      objects: files,
    };
    await writeCloudManifest(root, manifest, key);
    return {
      tables: Object.keys(inventory.tables).length,
      objects: files.length,
      objectBytes: files.reduce((sum, o) => sum + o.file.plainBytes, 0),
      dumpBytes: database.plainBytes,
      serverMajor,
    };
  });
  const report = {
    status: "CLOUD_ENCRYPTED_CAPTURE_CREATED",
    backup: id,
    ...result,
    snapshotSharedWithPgDump: true,
    encrypted: true,
    manifestEncrypted: true,
    sourceModified: false,
    restoreVerified: false,
    managedServiceSettingsIncluded: false,
  };
  await writeFile(".local/cloud-capture-latest.json", JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(
    JSON.stringify({
      status: "CLOUD_CAPTURE_FAILED",
      code: error instanceof CloudCaptureError ? error.code : publicFailure(error),
      secretsDisplayed: false,
    }),
  );
  process.exitCode = 1;
} finally {
  await db?.end({ timeout: 2 }).catch(() => {});
}
