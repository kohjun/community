import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import {
  backupId,
  containedPath,
  encryptStream,
  mediaPath,
  verifyPrivate,
  type BackupFile,
} from "./local-backup-core";
export const execute = promisify(execFile);
export const CLOUD_SCHEMAS = ["auth", "drizzle", "sliper"] as const;
export class CloudCaptureError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function fail(code: string): never {
  throw new CloudCaptureError(code);
}
export function identifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) fail("INVALID_IDENTIFIER");
  return '"' + value + '"';
}
export function storageBackupPath(value: string): string {
  const match = /^(posts|profiles|videos|video-sources)\/([a-f0-9-]+\.[a-z0-9]+)$/.exec(value);
  if (!match) return fail("UNEXPECTED_STORAGE_PATH");
  return mediaPath(
    "media/" +
      {
        posts: "uploads",
        profiles: "profile-photos",
        videos: "videos",
        "video-sources": "video-sources",
      }[match[1]!]! +
      "/" +
      match[2] +
      ".enc",
  );
}
export function requireCloudMedia(
  references: Record<string, unknown>[],
  objectPaths: Iterable<string>,
) {
  const available = new Set(objectPaths),
    required = new Set<string>();
  const prefixes: Record<string, string> = {
    uploads: "posts",
    "profile-photos": "profiles",
    videos: "videos",
    "video-sources": "video-sources",
  };
  for (const row of references) {
    if (typeof row.required !== "boolean") fail("MEDIA_REFERENCE_FORMAT");
    if (!row.required) continue;
    if (row.backend !== "supabase") fail("LOCAL_MEDIA_NOT_CAPTURED");
    const prefix = prefixes[String(row.folder)];
    if (!prefix) fail("MEDIA_REFERENCE_FORMAT");
    const location = prefix + "/" + String(row.key);
    storageBackupPath(location);
    if (!available.has(location)) fail("REQUIRED_STORAGE_OBJECT_MISSING");
    required.add(location);
  }
  return required.size;
}
export function pgEnvironment(
  urlValue: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const url = new URL(urlValue);
  return {
    ...Object.fromEntries(
      ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap((k) =>
        process.env[k] ? [[k, process.env[k]]] : [],
      ),
    ),
    NODE_ENV: "production",
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
    PGSSLMODE: url.searchParams.get("sslmode") ?? "require",
    PGCONNECT_TIMEOUT: "10",
    PGCLIENTENCODING: "UTF8",
    PGAPPNAME: "sliper-cloud-capture",
    PGOPTIONS:
      "-c statement_timeout=300000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=600000",
    ...extra,
  };
}
export async function snapshot(query: (text: string) => Promise<Record<string, unknown>[]>) {
  await query("set local timezone='UTC'");
  await query("set local row_security=off");
  const rows = await query(
    "select n.nspname as schema,c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','drizzle','sliper') and c.relkind in ('r','p') order by 1,2",
  );
  if (!rows.length || rows.length > 300) fail("TABLE_INVENTORY");
  const statements = rows.map((row) => {
    const name = String(row.schema) + "." + String(row.name);
    return (
      "select '" +
      name +
      "' as name,count(*)::text as count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text) collate \"C\"),'')) as digest from " +
      identifier(String(row.schema)) +
      "." +
      identifier(String(row.name)) +
      " t"
    );
  });
  const tables: Record<string, { count: string; digest: string }> = {};
  for (let i = 0; i < statements.length; i += 20) {
    for (const row of await query(statements.slice(i, i + 20).join(" union all ")))
      tables[String(row.name)] = { count: String(row.count), digest: String(row.digest) };
  }
  const structure = await query(
    "select n.nspname as schema,c.relname as name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,(select count(*)::int from pg_index i where i.indrelid=c.oid) as indexes,(select count(*)::int from pg_constraint x where x.conrelid=c.oid and x.contype<>'n') as constraints,(select count(*)::int from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attnotnull) as not_null_columns,(select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','drizzle','sliper') and c.relkind in ('r','p') order by 1,2",
  );
  return { tables, structure };
}
export async function encryptedDump(
  executable: string,
  url: string,
  exported: string,
  destination: string,
  key: Buffer,
  id: string,
): Promise<BackupFile> {
  if (!/^[A-Fa-f0-9-]{8,80}$/.test(exported)) fail("INVALID_SNAPSHOT");
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--no-password",
    "--snapshot=" + exported,
    ...CLOUD_SCHEMAS.map((s) => "--schema=" + s),
  ];
  const child = spawn(executable, args, {
    windowsHide: true,
    env: pgEnvironment(url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.resume();
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new CloudCaptureError("PG_DUMP_FAILED")));
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new CloudCaptureError("PG_DUMP_FAILED")),
    );
  });
  // Attach a rejection handler before streaming to avoid an unhandled native-process failure.
  void done.catch(() => {});
  const timeout = setTimeout(() => child.kill(), 300_000);
  try {
    const file = await encryptStream(child.stdout, destination, key, id, "database.pgdump.enc");
    await done;
    return file;
  } catch {
    child.kill();
    await done.catch(() => {});
    return fail("PG_DUMP_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}
const file = z.strictObject({
  path: z.string(),
  plainBytes: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 ** 3),
  plainSha256: z.string().regex(/^[a-f0-9]{64}$/),
  cipherBytes: z.number().int().positive(),
  cipherSha256: z.string().regex(/^[a-f0-9]{64}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
});
const manifestSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("sliper-supabase-capture"),
  id: z.string(),
  capturedAt: z.iso.datetime(),
  project: z.string().regex(/^[a-z0-9]{20}$/),
  serverMajor: z.number().int().min(15).max(99),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  database: file,
  snapshot: z.strictObject({
    tables: z.record(
      z.string(),
      z.strictObject({
        count: z.string().regex(/^\d+$/),
        digest: z.string().regex(/^[a-f0-9]{32}$/),
      }),
    ),
    structure: z.array(z.record(z.string(), z.unknown())),
  }),
  roles: z.array(z.string()),
  objects: z.array(z.strictObject({ storagePath: z.string(), file })).max(20000),
});
export type CloudManifest = z.infer<typeof manifestSchema>;
export function validateCloudManifest(value: unknown, id: string): CloudManifest {
  const r = manifestSchema.safeParse(value);
  if (!r.success) return fail("INVALID_CLOUD_MANIFEST");
  const m = r.data;
  if (m.id !== backupId(id) || m.database.path !== "database.pgdump.enc")
    fail("INVALID_CLOUD_MANIFEST");
  const seen = new Set<string>();
  let size = m.database.plainBytes;
  for (const o of m.objects) {
    if (
      storageBackupPath(o.storagePath) !== o.file.path ||
      seen.has(o.file.path) ||
      o.file.cipherBytes !== o.file.plainBytes
    )
      fail("INVALID_CLOUD_MANIFEST");
    seen.add(o.file.path);
    size += o.file.plainBytes;
  }
  if (m.database.cipherBytes !== m.database.plainBytes || size > 10 * 1024 ** 3)
    fail("CAPTURE_LIMIT");
  for (const r of m.roles) identifier(r);
  for (const name of Object.keys(m.snapshot.tables)) {
    const parts = name.split(".");
    if (parts.length !== 2 || !CLOUD_SCHEMAS.includes(parts[0] as (typeof CLOUD_SCHEMAS)[number]))
      fail("INVALID_CLOUD_MANIFEST");
    identifier(parts[1]!);
  }
  return m;
}
const manifestKey = (key: Buffer, id: string) =>
  Buffer.from(
    hkdfSync("sha256", key, Buffer.from(backupId(id)), Buffer.from("sliper-cloud-manifest/v1"), 32),
  );
export function sealManifest(manifest: CloudManifest, key: Buffer) {
  if (key.length !== 32) fail("INVALID_KEY");
  validateCloudManifest(manifest, manifest.id);
  const plain = Buffer.from(JSON.stringify(manifest)),
    iv = randomBytes(12);
  if (plain.length > 8 * 1024 ** 2) fail("MANIFEST_LIMIT");
  const cipher = createCipheriv("aes-256-gcm", manifestKey(key, manifest.id), iv);
  cipher.setAAD(Buffer.from(manifest.id));
  const bytes = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    bytes,
    envelope: {
      version: 1,
      id: manifest.id,
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      cipherSha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}
export function openManifest(
  bytes: Buffer,
  envelope: unknown,
  key: Buffer,
  id: string,
): CloudManifest {
  try {
    const e = z
      .strictObject({
        version: z.literal(1),
        id: z.literal(backupId(id)),
        iv: z.string().regex(/^[a-f0-9]{24}$/),
        tag: z.string().regex(/^[a-f0-9]{32}$/),
        cipherSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(envelope);
    if (
      bytes.length > 8 * 1024 ** 2 ||
      key.length !== 32 ||
      createHash("sha256").update(bytes).digest("hex") !== e.cipherSha256
    )
      fail("MANIFEST_AUTHENTICATION");
    const dec = createDecipheriv("aes-256-gcm", manifestKey(key, id), Buffer.from(e.iv, "hex"));
    dec.setAAD(Buffer.from(id));
    dec.setAuthTag(Buffer.from(e.tag, "hex"));
    return validateCloudManifest(
      JSON.parse(Buffer.concat([dec.update(bytes), dec.final()]).toString("utf8")),
      id,
    );
  } catch {
    return fail("MANIFEST_AUTHENTICATION");
  }
}
export async function writeCloudManifest(root: string, manifest: CloudManifest, key: Buffer) {
  const sealed = sealManifest(manifest, key);
  for (const [name, contents] of [
    ["cloud.manifest.enc", sealed.bytes],
    ["capture.json", JSON.stringify(sealed.envelope, null, 2) + "\n"],
  ] as const) {
    const p = containedPath(root, name);
    await writeFile(p, contents, { flag: "wx", mode: 0o600 });
    await verifyPrivate(p);
  }
}
export async function readCloudCapture(workspace: string, id: string) {
  backupId(id);
  const root = containedPath(path.resolve(workspace), ".local/backups/" + id),
    keys = containedPath(path.resolve(workspace), ".local/backup-keys/" + id + ".key");
  for (const parent of [root, path.dirname(keys)]) {
    const s = await lstat(parent);
    if (!s.isDirectory() || s.isSymbolicLink() || (await realpath(parent)) !== parent)
      fail("UNSAFE_CAPTURE_PATH");
  }
  for (const name of [
    keys,
    containedPath(root, "capture.json"),
    containedPath(root, "cloud.manifest.enc"),
  ]) {
    await verifyPrivate(name);
    const s = await lstat(name);
    if (s.size > 8 * 1024 ** 2) fail("MANIFEST_LIMIT");
  }
  const key = await readFile(keys);
  return {
    root,
    key,
    manifest: openManifest(
      await readFile(containedPath(root, "cloud.manifest.enc")),
      JSON.parse(await readFile(containedPath(root, "capture.json"), "utf8")),
      key,
      id,
    ),
  };
}
export function sameSnapshot(
  actual: CloudManifest["snapshot"],
  expected: CloudManifest["snapshot"],
) {
  const normalize = (v: unknown) =>
    JSON.stringify(v, (_, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value,
    );
  if (normalize(actual) !== normalize(expected)) fail("RESTORE_SNAPSHOT_MISMATCH");
}
export function blobStream(blob: Blob) {
  return Readable.fromWeb(blob.stream() as import("node:stream/web").ReadableStream);
}

/** Separate key domain: server configuration archives cannot be mistaken for DB manifests. */
export function sealServerRecovery(bytes: Buffer, key: Buffer, id: string) {
  backupId(id);
  if (key.length !== 32 || bytes.length < 1 || bytes.length > 4 * 1024 ** 2) fail("RECOVERY_LIMIT");
  const derived = Buffer.from(
    hkdfSync("sha256", key, Buffer.from(id), Buffer.from("sliper-server-recovery/v1"), 32),
  );
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", derived, iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    bytes: encrypted,
    envelope: {
      version: 1 as const,
      kind: "sliper-server-recovery" as const,
      id,
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      cipherSha256: createHash("sha256").update(encrypted).digest("hex"),
    },
  };
}
export function openServerRecovery(bytes: Buffer, envelope: unknown, key: Buffer, id: string) {
  try {
    const e = z
      .strictObject({
        version: z.literal(1),
        kind: z.literal("sliper-server-recovery"),
        id: z.literal(backupId(id)),
        iv: z.string().regex(/^[a-f0-9]{24}$/),
        tag: z.string().regex(/^[a-f0-9]{32}$/),
        cipherSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(envelope);
    if (
      key.length !== 32 ||
      bytes.length > 4 * 1024 ** 2 ||
      createHash("sha256").update(bytes).digest("hex") !== e.cipherSha256
    )
      fail("RECOVERY_AUTHENTICATION");
    const derived = Buffer.from(
      hkdfSync("sha256", key, Buffer.from(id), Buffer.from("sliper-server-recovery/v1"), 32),
    );
    const dec = createDecipheriv("aes-256-gcm", derived, Buffer.from(e.iv, "hex"));
    dec.setAAD(Buffer.from(id));
    dec.setAuthTag(Buffer.from(e.tag, "hex"));
    return Buffer.concat([dec.update(bytes), dec.final()]);
  } catch {
    return fail("RECOVERY_AUTHENTICATION");
  }
}
