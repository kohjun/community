import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants, createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

const execute = promisify(execFile);
export const MEDIA_FOLDERS = ["uploads", "profile-photos", "video-sources", "videos"] as const;
export const MAX_DUMP_BYTES = 2 * 1024 ** 3;
const MAX_TOTAL_BYTES = 10 * 1024 ** 3,
  MAX_FILES = 20000,
  MAX_MANIFEST_BYTES = 8 * 1024 ** 2;
const backupPattern = /^backup_\d{8}T\d{6}Z_[a-f0-9]{16}$/;
const restorePattern = /^sliper_restore_\d{14}_[a-f0-9]{16}$/;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const mediaPattern = new RegExp(
  "^media/(uploads|profile-photos|video-sources|videos)/(" +
    uuid +
    ")\\.(jpg|jpeg|png|webp|gif|bin|mp4)\\.enc$",
);
const codes = [
  "LOCAL_ONLY",
  "QUIESCENT_REQUIRED",
  "INVALID_ARGUMENT",
  "INVALID_PATH",
  "UNSAFE_FILE",
  "PRIVATE_PERMISSIONS",
  "FILE_LIMIT",
  "FILE_CHANGED",
  "INVALID_MANIFEST",
  "KEY_REQUIRED",
  "AUTHENTICATION_FAILED",
  "HASH_MISMATCH",
  "PG_TOOL_FAILED",
  "DATABASE_EXISTS",
  "RESTORE_MISMATCH",
  "REMOTE_MEDIA",
  "SOURCE_MEDIA_MISSING",
  "BACKUP_FAILED",
] as const;
export class LocalBackupError extends Error {
  constructor(readonly code: (typeof codes)[number]) {
    super(code);
    this.name = "LocalBackupError";
  }
}
const fail = (code: (typeof codes)[number]): never => {
  throw new LocalBackupError(code);
};
/** Never echo native stderr, connection strings, filesystem error paths or SQL tuples. */
export function publicFailure(error: unknown): string {
  return error instanceof LocalBackupError && codes.includes(error.code)
    ? error.code
    : "BACKUP_FAILED";
}
export interface LocalConfiguration {
  readonly host: "127.0.0.1";
  readonly port: 55432;
  readonly user: string;
  readonly password: string;
}
export function localConfiguration(env: Record<string, string | undefined>): LocalConfiguration {
  try {
    const url = new URL(env.DATABASE_URL || "");
    if (
      env.LOCAL_DATABASE !== "1" ||
      env.SLIPER_AUTH_MODE !== "development" ||
      env.NODE_ENV === "production" ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "127.0.0.1" ||
      url.port !== "55432" ||
      url.pathname !== "/sliper_dev" ||
      url.search ||
      url.hash
    )
      return fail("LOCAL_ONLY");
    const user = decodeURIComponent(url.username),
      password = decodeURIComponent(url.password);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(user) || !password || password.includes("\0"))
      return fail("LOCAL_ONLY");
    return { host: "127.0.0.1", port: 55432, user, password };
  } catch {
    return fail("LOCAL_ONLY");
  }
}
export function backupId(value: string): string {
  if (!backupPattern.test(value)) return fail("INVALID_PATH");
  return value;
}
export function restoreDatabase(value: string): string {
  if (!restorePattern.test(value) || value.length > 63) return fail("INVALID_PATH");
  return value;
}
export function newBackupId(now = new Date()): string {
  return backupId(
    "backup_" +
      now
        .toISOString()
        .replaceAll(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z") +
      "_" +
      randomBytes(8).toString("hex"),
  );
}
export function newRestoreDatabase(now = new Date()): string {
  return restoreDatabase(
    "sliper_restore_" +
      now.toISOString().slice(0, 19).replaceAll(/[-:T]/g, "") +
      "_" +
      randomBytes(8).toString("hex"),
  );
}
export function argumentsFor(args: string[], restore = false): string | null {
  if (!args.includes("--quiescent")) return fail("QUIESCENT_REQUIRED");
  if (
    new Set(args).size !== args.length ||
    args.filter((item) => item === "--quiescent").length !== 1
  )
    return fail("INVALID_ARGUMENT");
  const backups = args.filter((item) => item.startsWith("--backup="));
  if (
    args.some((item) => item !== "--quiescent" && !item.startsWith("--backup=")) ||
    backups.length !== (restore ? 1 : 0)
  )
    return fail("INVALID_ARGUMENT");
  return restore ? backupId(backups[0]!.slice("--backup=".length)) : null;
}
export function childEnvironment(
  env: Record<string, string | undefined>,
  config: LocalConfiguration,
  database: string,
): NodeJS.ProcessEnv {
  if (database !== "sliper_dev" && database !== "postgres") restoreDatabase(database);
  const result: NodeJS.ProcessEnv = { NODE_ENV: "development" };
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"])
    if (env[name]) result[name] = env[name];
  return {
    ...result,
    PGHOST: config.host,
    PGPORT: String(config.port),
    PGUSER: config.user,
    PGPASSWORD: config.password,
    PGDATABASE: database,
    PGSSLMODE: "disable",
    PGCONNECT_TIMEOUT: "10",
    PGCLIENTENCODING: "UTF8",
    PGAPPNAME: "sliper-local-backup-verify",
    PGOPTIONS:
      "-c statement_timeout=300000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=300000",
  };
}
function inside(root: string, file: string) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("INVALID_PATH");
}
export function containedPath(root: string, relative: string) {
  if (
    !relative ||
    relative.includes("\\") ||
    relative.includes(":") ||
    relative.includes("\0") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    return fail("INVALID_PATH");
  const result = path.resolve(root, relative);
  inside(root, result);
  return result;
}
export async function ensurePath(root: string, relative: string, create: boolean) {
  const base = path.resolve(root),
    target = containedPath(base, relative);
  const baseInfo = await lstat(base);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) fail("UNSAFE_FILE");
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    inside(base, current);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      info = await lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) fail("UNSAFE_FILE");
  }
  const resolved = await realpath(target);
  inside(await realpath(base), resolved);
  return target;
}
let ownerSid: string | null = null;
async function windowsSid() {
  if (ownerSid) return ownerSid;
  try {
    const output = await execute("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 65536,
    });
    ownerSid = output.stdout.match(/S-1-5-[0-9-]+/)?.[0] ?? null;
    if (!ownerSid) fail("PRIVATE_PERMISSIONS");
    return ownerSid;
  } catch {
    return fail("PRIVATE_PERMISSIONS");
  }
}
export async function privateDirectory(directory: string) {
  if ((await lstat(directory)).isSymbolicLink()) fail("UNSAFE_FILE");
  if (process.platform !== "win32") {
    await chmod(directory, 0o700);
    return;
  }
  try {
    const sid = await windowsSid();
    await execute(
      "icacls.exe",
      [directory, "/inheritance:r", "/grant:r", "*" + sid + ":(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"],
      { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
    );
  } catch {
    fail("PRIVATE_PERMISSIONS");
  }
}
export async function verifyPrivate(file: string) {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) fail("UNSAFE_FILE");
  if (process.platform !== "win32") {
    if (info.mode & 0o077) fail("PRIVATE_PERMISSIONS");
    return;
  }
  const sid = await windowsSid(),
    literal = "'" + file.replaceAll("'", "''") + "'";
  const command =
    "$bad=@((Get-Acl -LiteralPath " +
    literal +
    ").Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @('" +
    sid +
    "','S-1-5-18') }); if($bad.Count -eq 0){'OK'}else{'DENIED'}";
  try {
    const result = await execute(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
    );
    if (result.stdout.trim() !== "OK") fail("PRIVATE_PERMISSIONS");
  } catch {
    fail("PRIVATE_PERMISSIONS");
  }
}
export async function initializeBackup(workspace: string, id: string) {
  backupId(id);
  const backups = await ensurePath(workspace, ".local/backups", true),
    keys = await ensurePath(workspace, ".local/backup-keys", true);
  await privateDirectory(keys);
  const root = containedPath(backups, id);
  await mkdir(root, { mode: 0o700 });
  await privateDirectory(root);
  const keyPath = containedPath(keys, id + ".key"),
    key = randomBytes(32);
  await writeFile(keyPath, key, { flag: "wx", mode: 0o600 });
  await verifyPrivate(keyPath);
  for (const folder of MEDIA_FOLDERS) await ensurePath(root, "media/" + folder, true);
  return { root, key, keyPath };
}
export function mediaPath(value: string) {
  const match = value.match(mediaPattern);
  if (!match) return fail("INVALID_PATH");
  const folder = match[1]!,
    extension = match[3]!;
  if (
    (folder === "profile-photos" && extension !== "webp") ||
    (folder === "video-sources" && extension !== "bin") ||
    (folder === "videos" && extension !== "mp4") ||
    (folder === "uploads" && !["jpg", "jpeg", "png", "webp", "gif"].includes(extension))
  )
    return fail("INVALID_PATH");
  return value;
}
function fileMaximum(file: string) {
  if (file === "database.pgdump.enc") return MAX_DUMP_BYTES;
  mediaPath(file);
  return file.startsWith("media/profile-photos/")
    ? 2 * 1024 ** 2
    : file.startsWith("media/video-sources/")
      ? 50 * 1024 ** 2
      : file.startsWith("media/videos/")
        ? 25 * 1024 ** 2
        : 10 * 1024 ** 2;
}
const fileSchema = z.strictObject({
  path: z.string().max(160),
  plainBytes: z.number().int().positive().max(MAX_DUMP_BYTES),
  plainSha256: z.string().regex(/^[a-f0-9]{64}$/),
  cipherBytes: z.number().int().positive().max(MAX_DUMP_BYTES),
  cipherSha256: z.string().regex(/^[a-f0-9]{64}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
});
export type BackupFile = z.infer<typeof fileSchema>;
const numericCounts = z.record(
  z.string().regex(/^[a-z_][a-z0-9_.]{0,90}$/),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
);
export const manifestSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(backupPattern),
  createdAt: z.iso.datetime(),
  source: z.literal("local-sliper-dev"),
  compression: z.literal("none"),
  encryption: z.literal("AES-256-GCM+HKDF-SHA256+HMAC-SHA256"),
  serverMajor: z.number().int().min(10).max(40),
  tableCounts: numericCounts,
  flowCounts: numericCounts,
  flowSha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(fileSchema).min(1).max(MAX_FILES),
  hmac: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BackupManifest = z.infer<typeof manifestSchema>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function derivedKey(key: Buffer, id: string, purpose: string): Buffer {
  if (key.length !== 32) return fail("KEY_REQUIRED");
  return Buffer.from(
    hkdfSync(
      "sha256",
      key,
      Buffer.from(backupId(id)),
      Buffer.from("sliper-local-backup/v1/" + purpose),
      32,
    ),
  );
}
export function signManifest(unsigned: Omit<BackupManifest, "hmac">, key: Buffer): BackupManifest {
  const hmac = createHmac("sha256", derivedKey(key, unsigned.id, "manifest"))
    .update(canonical(unsigned))
    .digest("hex");
  return { ...unsigned, hmac };
}
export function validateManifest(input: unknown, key: Buffer, expectedId: string): BackupManifest {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_MANIFEST");
  const manifest = parsed.data;
  if (manifest.id !== backupId(expectedId)) return fail("INVALID_MANIFEST");
  const { hmac, ...unsigned } = manifest,
    expected = signManifest(unsigned, key).hmac;
  if (!timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex")))
    return fail("AUTHENTICATION_FAILED");
  const seen = new Set<string>();
  let total = 0,
    dumps = 0;
  for (const file of manifest.files) {
    if (seen.has(file.path)) return fail("INVALID_MANIFEST");
    seen.add(file.path);
    if (file.path === "database.pgdump.enc") dumps++;
    else mediaPath(file.path);
    if (file.plainBytes > fileMaximum(file.path) || file.cipherBytes !== file.plainBytes)
      return fail("FILE_LIMIT");
    total += file.plainBytes;
    if (total > MAX_TOTAL_BYTES) return fail("FILE_LIMIT");
  }
  if (dumps !== 1) return fail("INVALID_MANIFEST");
  return manifest;
}
function byteMeter(maximum: number) {
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximum) {
        callback(new LocalBackupError("FILE_LIMIT"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  return { stream, result: () => ({ bytes, sha256: hash.digest("hex") }) };
}
async function regularFile(file: string, maximum: number) {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) fail("UNSAFE_FILE");
  if (info.size < 1 || info.size > maximum) fail("FILE_LIMIT");
  return info;
}
export async function encryptStream(
  source: Readable,
  destination: string,
  key: Buffer,
  id: string,
  relative: string,
): Promise<BackupFile> {
  const max = fileMaximum(relative),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", derivedKey(key, id, "encryption"), iv);
  cipher.setAAD(Buffer.from(id + "\0" + relative));
  const plain = byteMeter(max),
    encrypted = byteMeter(max);
  await pipeline(
    source,
    plain.stream,
    cipher,
    encrypted.stream,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  const p = plain.result(),
    c = encrypted.result();
  if (!p.bytes) return fail("FILE_LIMIT");
  return {
    path: relative,
    plainBytes: p.bytes,
    plainSha256: p.sha256,
    cipherBytes: c.bytes,
    cipherSha256: c.sha256,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}
export async function encryptFile(
  source: string,
  destination: string,
  key: Buffer,
  id: string,
  relative: string,
) {
  const before = await regularFile(source, fileMaximum(relative)),
    handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      return fail("UNSAFE_FILE");
    const result = await encryptStream(
        handle.createReadStream({ autoClose: false }),
        destination,
        key,
        id,
        relative,
      ),
      after = await handle.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      result.plainBytes !== before.size
    )
      return fail("FILE_CHANGED");
    return result;
  } finally {
    await handle.close();
  }
}
export async function hashFile(file: string, maximum: number) {
  const before = await regularFile(file, maximum),
    meter = byteMeter(maximum);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      return fail("UNSAFE_FILE");
    await pipeline(
      handle.createReadStream({ autoClose: false }),
      meter.stream,
      new Transform({
        transform(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
    const result = meter.result(),
      after = await handle.stat();
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      return fail("FILE_CHANGED");
    return result;
  } finally {
    await handle.close();
  }
}
export async function decryptFile(
  source: string,
  destination: string,
  key: Buffer,
  id: string,
  descriptor: BackupFile,
) {
  const before = await regularFile(source, descriptor.cipherBytes),
    handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      return fail("UNSAFE_FILE");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      derivedKey(key, id, "encryption"),
      Buffer.from(descriptor.iv, "hex"),
    );
    decipher.setAAD(Buffer.from(id + "\0" + descriptor.path));
    decipher.setAuthTag(Buffer.from(descriptor.tag, "hex"));
    const meter = byteMeter(descriptor.plainBytes);
    try {
      await pipeline(
        handle.createReadStream({ autoClose: false }),
        decipher,
        meter.stream,
        createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      );
    } catch {
      await unlink(destination).catch(() => {});
      return fail("AUTHENTICATION_FAILED");
    }
    const verified = meter.result(),
      after = await handle.stat();
    if (
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      await unlink(destination).catch(() => {});
      return fail("FILE_CHANGED");
    }
    if (verified.bytes !== descriptor.plainBytes || verified.sha256 !== descriptor.plainSha256) {
      await unlink(destination).catch(() => {});
      return fail("HASH_MISMATCH");
    }
  } finally {
    await handle.close();
  }
}
export async function mediaInventory(workspace: string) {
  const result: Array<{ source: string; relative: string }> = [];
  let mediaBytes = 0;
  for (const folder of MEDIA_FOLDERS) {
    let root: string;
    try {
      root = await ensurePath(workspace, ".local/" + folder, false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const item of await readdir(root, { withFileTypes: true })) {
      if (item.isSymbolicLink()) return fail("UNSAFE_FILE");
      if (!item.isFile()) continue;
      const relative = "media/" + folder + "/" + item.name + ".enc";
      try {
        mediaPath(relative);
      } catch {
        continue;
      }
      const source = containedPath(root, item.name);
      const metadata = await regularFile(source, fileMaximum(relative));
      mediaBytes += metadata.size;
      // Reserve enough capacity for the bounded dump before any archive capture starts.
      if (mediaBytes > MAX_TOTAL_BYTES - MAX_DUMP_BYTES) return fail("FILE_LIMIT");
      result.push({ source, relative });
      if (result.length >= MAX_FILES) return fail("FILE_LIMIT");
    }
  }
  return result.sort((a, b) => a.relative.localeCompare(b.relative));
}
async function packageInventory(root: string, relative = ""): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(relative ? containedPath(root, relative) : root, {
    withFileTypes: true,
  })) {
    const entry = relative ? relative + "/" + item.name : item.name;
    if (item.isSymbolicLink()) return fail("UNSAFE_FILE");
    if (item.isDirectory()) {
      if (!["media", ...MEDIA_FOLDERS.map((folder) => "media/" + folder)].includes(entry))
        return fail("INVALID_PATH");
      result.push(...(await packageInventory(root, entry)));
    } else if (item.isFile()) result.push(entry);
    else return fail("UNSAFE_FILE");
  }
  return result;
}
export async function verifyPackage(workspace: string, id: string) {
  backupId(id);
  const root = await ensurePath(workspace, ".local/backups/" + id, false),
    keys = await ensurePath(workspace, ".local/backup-keys", false);
  const keyPath = containedPath(keys, id + ".key");
  await verifyPrivate(keyPath);
  await regularFile(keyPath, 32);
  const key = await readFile(keyPath);
  if (key.length !== 32) return fail("KEY_REQUIRED");
  const manifestPath = containedPath(root, "manifest.json");
  await verifyPrivate(manifestPath);
  await regularFile(manifestPath, MAX_MANIFEST_BYTES);
  let input: unknown;
  try {
    input = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return fail("INVALID_MANIFEST");
  }
  const manifest = validateManifest(input, key, id),
    actual = await packageInventory(root),
    expected = ["manifest.json", ...manifest.files.map((file) => file.path)];
  if (actual.sort().join("\0") !== expected.sort().join("\0")) return fail("HASH_MISMATCH");
  for (const file of manifest.files) {
    const found = await hashFile(containedPath(root, file.path), file.cipherBytes);
    if (found.bytes !== file.cipherBytes || found.sha256 !== file.cipherSha256)
      return fail("HASH_MISMATCH");
  }
  return { root, key, manifest };
}
import { spawn } from "node:child_process";
import postgres from "postgres";

export function connectLocal(config: LocalConfiguration, database = "sliper_dev") {
  if (database !== "sliper_dev" && database !== "postgres") restoreDatabase(database);
  return postgres({
    host: config.host,
    port: config.port,
    username: config.user,
    password: config.password,
    database,
    ssl: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice() {},
  });
}
export async function nativeTool(
  name: "pg_dump" | "pg_restore",
  env: Record<string, string | undefined>,
) {
  const directory = path.resolve(env.POSTGRES_BIN || "C:/Program Files/PostgreSQL/18/bin");
  const executable = path.join(directory, name + (process.platform === "win32" ? ".exe" : ""));
  const stat = await lstat(executable);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("PG_TOOL_FAILED");
  return executable;
}
export async function dumpDatabase(
  destination: string,
  key: Buffer,
  id: string,
  config: LocalConfiguration,
  env: Record<string, string | undefined>,
) {
  const command = await nativeTool("pg_dump", env);
  const child = spawn(
    command,
    ["--format=custom", "--compress=0", "--no-owner", "--no-acl", "--encoding=UTF8"],
    {
      env: childEnvironment(env, config, "sliper_dev"),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr.resume();
  const finished = new Promise<boolean>((resolve) => {
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
  const timer = setTimeout(() => child.kill(), 300000);
  timer.unref();
  try {
    const file = await encryptStream(child.stdout, destination, key, id, "database.pgdump.enc");
    if (!(await finished)) return fail("PG_TOOL_FAILED");
    return file;
  } catch {
    child.kill();
    await finished;
    return fail("PG_TOOL_FAILED");
  } finally {
    clearTimeout(timer);
  }
}
export async function restoreDump(
  source: string,
  config: LocalConfiguration,
  database: string,
  env: Record<string, string | undefined>,
) {
  restoreDatabase(database);
  try {
    await execute(
      await nativeTool("pg_restore", env),
      ["--exit-on-error", "--no-owner", "--no-acl", "--dbname=" + database, source],
      {
        env: childEnvironment(env, config, database),
        windowsHide: true,
        timeout: 300000,
        maxBuffer: 1024 * 1024,
      },
    );
  } catch {
    fail("PG_TOOL_FAILED");
  }
}
export interface DatabaseSnapshot {
  tableCounts: Record<string, number>;
  flowCounts: Record<string, number>;
  flowSha256: string;
  serverMajor: number;
  requiredMedia: string[];
}
const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) return fail("RESTORE_MISMATCH");
  return '"' + name + '"';
};
const flowQueries: Record<string, string> = {
  application_identity:
    "select count(*) as count from sliper.event_applications a join sliper.event_settings s on s.post_id=a.post_id join sliper.profiles p on p.id=a.user_id",
  room_application_identity:
    "select count(*) as count from sliper.room_members r join sliper.event_applications a on a.id=r.application_id and a.post_id=r.post_id and a.user_id=r.user_id",
  admission_identity:
    "select count(*) as count from sliper.event_admissions q join sliper.event_applications a on a.id=q.application_id and a.post_id=q.post_id and a.user_id=q.user_id",
  participant_results:
    "select count(*) as count from sliper.event_results r join sliper.event_applications a on a.id=r.application_id and a.post_id=r.post_id and a.user_id=r.user_id where r.presence='attended'",
  event_records:
    "select count(*) as count from sliper.event_records r join sliper.event_settings s on s.post_id=r.post_id join sliper.posts p on p.id=r.post_id",
  accepted_production:
    "select count(*) as count from sliper.event_credits c join sliper.event_records r on r.post_id=c.post_id where c.status='accepted' and c.confirmed_by<>c.user_id and c.accepted_at is not null",
  certified_reviews:
    "select count(*) as count from sliper.verified_event_reviews v join sliper.event_admissions q on q.application_id=v.application_id and q.post_id=v.event_post_id and q.user_id=v.user_id",
  library_versions:
    "select count(*) as count from sliper.library_versions v join sliper.library_entries e on e.id=v.entry_id",
  record_links:
    "select count(*) as count from sliper.event_record_links l join sliper.event_records r on r.post_id=l.record_post_id",
  appeal_origin:
    "select count(*) as count from sliper.support_tickets t join sliper.moderation_audit m on m.id=t.original_action_id",
  push_delivery_preserved: "select count(*) as count from sliper.push_deliveries",
  video_jobs_preserved: "select count(*) as count from sliper.video_processing_jobs",
};
export const storageInventoryQuery =
  "select object_key as key,storage_backend as backend,'uploads' as folder,status='ready' as required from sliper.media_assets union all select object_key,storage_backend,'videos',status='ready' from sliper.video_assets union all select object_key,storage_backend,'profile-photos',true from sliper.profile_photos union all select source_object_key,source_storage_backend,'video-sources',source_ready and source_removed_at is null from sliper.video_processing_jobs union all select o.object_key,o.storage_backend,'videos',o.published_at is not null and o.removed_at is null and not exists (select 1 from sliper.media_retention_jobs r join sliper.video_assets a on a.id=r.asset_id and r.asset_kind='video' where a.id=o.id and a.object_key=o.object_key and r.object_key=o.object_key and r.storage_backend=o.storage_backend and a.storage_backend=o.storage_backend and a.status='pending' and a.post_id is null and a.record_post_id is null and a.record_origin_post_id is null) from sliper.video_processing_outputs o";
export async function databaseSnapshot(
  client: ReturnType<typeof connectLocal>,
): Promise<DatabaseSnapshot> {
  return client.begin("read only isolation level repeatable read", async (db) => {
    await db.unsafe("set local timezone='UTC'");
    const version = await db.unsafe("select current_setting('server_version_num') as version");
    const serverMajor = Math.floor(Number(version[0]!.version) / 10000);
    const tables = await db.unsafe(
      "select n.nspname as schema,c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema' order by n.nspname,c.relname",
    );
    if (!tables.length || tables.length > 500) return fail("RESTORE_MISMATCH");
    const tableCounts: Record<string, number> = {},
      flowCounts: Record<string, number> = {},
      digest = createHash("sha256");
    for (const table of tables) {
      const schema = String(table.schema),
        name = String(table.name),
        qualified = identifier(schema) + "." + identifier(name);
      const rows = await db.unsafe(
        "select count(*)::text as count, encode(sha256(convert_to(coalesce(string_agg(row_hash,'' order by row_hash),''),'UTF8')),'hex') as hash from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as row_hash from " +
          qualified +
          " t) hashed",
      );
      const count = Number(rows[0]!.count);
      if (!Number.isSafeInteger(count)) return fail("FILE_LIMIT");
      tableCounts[schema + "." + name] = count;
      digest.update(schema + "." + name + "\0" + count + "\0" + rows[0]!.hash + "\n");
    }
    const sequences = await db.unsafe(
      "select sequence_schema as schema,sequence_name as name from information_schema.sequences where sequence_schema !~ '^pg_' order by sequence_schema,sequence_name",
    );
    for (const sequence of sequences) {
      const schema = String(sequence.schema),
        name = String(sequence.name);
      const result = await db.unsafe(
        "select last_value::text as value,is_called from " +
          identifier(schema) +
          "." +
          identifier(name),
      );
      digest.update(
        "sequence:" +
          schema +
          "." +
          name +
          "\0" +
          result[0]!.value +
          "\0" +
          result[0]!.is_called +
          "\n",
      );
    }
    flowCounts.sequence_state = sequences.length;
    for (const [name, query] of Object.entries(flowQueries)) {
      const result = await db.unsafe(query);
      flowCounts[name] = Number(result[0]!.count);
    }
    const storage = await db.unsafe(storageInventoryQuery);
    const requiredMedia = new Set<string>();
    for (const row of storage) {
      if (row.backend !== "local") return fail("REMOTE_MEDIA");
      const relative = mediaPath("media/" + row.folder + "/" + row.key + ".enc");
      if (row.required === true) requiredMedia.add(relative);
    }
    return {
      serverMajor,
      tableCounts,
      flowCounts,
      flowSha256: digest.digest("hex"),
      requiredMedia: [...requiredMedia].sort(),
    };
  });
}
export function assertSnapshot(
  snapshot: DatabaseSnapshot,
  expected: Pick<DatabaseSnapshot, "serverMajor" | "tableCounts" | "flowCounts" | "flowSha256">,
) {
  if (
    snapshot.serverMajor !== expected.serverMajor ||
    canonical(snapshot.tableCounts) !== canonical(expected.tableCounts) ||
    canonical(snapshot.flowCounts) !== canonical(expected.flowCounts) ||
    snapshot.flowSha256 !== expected.flowSha256
  )
    fail("RESTORE_MISMATCH");
}
export function requireMedia(
  snapshot: Pick<DatabaseSnapshot, "requiredMedia">,
  paths: Iterable<string>,
) {
  const files = new Set(paths);
  for (const required of snapshot.requiredMedia)
    if (!files.has(required)) fail("SOURCE_MEDIA_MISSING");
}
export async function initializeRestore(workspace: string, database: string) {
  restoreDatabase(database);
  const parent = await ensurePath(workspace, ".local/restores", true),
    root = containedPath(parent, database);
  await mkdir(root, { mode: 0o700 });
  await privateDirectory(root);
  for (const folder of MEDIA_FOLDERS) await ensurePath(root, ".local/" + folder, true);
  return root;
}
export async function createScratch(client: ReturnType<typeof connectLocal>, database: string) {
  restoreDatabase(database);
  const exists = await client`select 1 from pg_database where datname=${database}`;
  if (exists.length) return fail("DATABASE_EXISTS");
  // This function has no drop/reset/clean/overwrite path. Only a new generated database may be created.
  await client.unsafe("create database " + identifier(database));
}
