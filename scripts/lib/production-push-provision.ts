import { randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { parsePushConfiguration } from "../../src/server/push-configuration";

export const PRODUCTION_PUSH_ENV = "/etc/sliper/runtime.env";
const fields = ["VAPID_SUBJECT", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"] as const;
export class ProductionPushProvisionError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new ProductionPushProvisionError(code);
}
/** This is the controlled JSON-quoted EnvironmentFile format emitted by Sliper deployment. Never shell-source it. */
export function parseRuntimeEnvironment(source: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(env, match[1]!)) fail("ENVIRONMENT_FORMAT");
    let value: unknown;
    try {
      value = match[2] === "" ? "" : JSON.parse(match[2]!);
    } catch {
      fail("ENVIRONMENT_FORMAT");
    }
    if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value))
      fail("ENVIRONMENT_FORMAT");
    env[match[1]!] = value;
  }
  return env;
}
function validateSubject(originValue: string | undefined, subject: string) {
  try {
    const origin = new URL(originValue ?? "");
    const contact = new URL(subject);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
      contact.protocol !== "https:" ||
      contact.username ||
      contact.password ||
      contact.hash ||
      contact.origin !== origin.origin
    )
      fail("SUBJECT_ORIGIN");
  } catch {
    fail("SUBJECT_ORIGIN");
  }
}
export function inspectProductionPush(source: string, subject: string) {
  const env = parseRuntimeEnvironment(source);
  validateSubject(env.APP_ORIGIN, subject);
  const populated = fields.filter((key) => !!env[key]);
  if (populated.length) {
    const config = parsePushConfiguration({
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });
    if (populated.length !== fields.length || !config) fail("EXISTING_KEYS_INVALID");
    return { configured: true, state: "existing-valid" as const };
  }
  return { configured: false, state: "not-configured" as const };
}
/** Contents remain private to the caller. CLI summaries must never serialize this returned object. */
export function prepareProductionPush(
  source: string,
  subject: string,
  generate: () => { publicKey: string; privateKey: string },
) {
  const inspection = inspectProductionPush(source, subject);
  if (inspection.configured) return { changed: false, contents: source };
  const pair = generate();
  if (!parsePushConfiguration({ subject, ...pair })) fail("GENERATED_KEYS_INVALID");
  const values = {
    VAPID_SUBJECT: subject,
    VAPID_PUBLIC_KEY: pair.publicKey,
    VAPID_PRIVATE_KEY: pair.privateKey,
  };
  const found = new Set<string>();
  const lines = source.split(/\r?\n/).map((line) => {
    const key = /^([A-Z_][A-Z0-9_]*)=/.exec(line)?.[1];
    if (!key || !fields.includes(key as (typeof fields)[number])) return line;
    found.add(key);
    return key + "=" + JSON.stringify(values[key as keyof typeof values]);
  });
  while (lines.at(-1) === "") lines.pop();
  for (const key of fields)
    if (!found.has(key)) lines.push(key + "=" + JSON.stringify(values[key]));
  return { changed: true, contents: lines.join("\n") + "\n" };
}
export interface EnvironmentFileSecurity {
  regular: boolean;
  symbolicLink: boolean;
  uid: number;
  gid: number;
  mode: number;
}
export interface EnvironmentDirectorySecurity {
  directory: boolean;
  symbolicLink: boolean;
  uid: number;
  gid: number;
  mode: number;
}
export function assertProductionEnvironmentSecurity(
  file: EnvironmentFileSecurity,
  directory: EnvironmentDirectorySecurity,
  canonicalParent: string,
) {
  if (
    !file.regular ||
    file.symbolicLink ||
    file.uid !== 0 ||
    file.gid <= 0 ||
    (file.mode & 0o777) !== 0o640 ||
    !directory.directory ||
    directory.symbolicLink ||
    directory.uid !== 0 ||
    directory.gid !== file.gid ||
    (directory.mode & 0o022) !== 0 ||
    canonicalParent !== "/etc/sliper"
  )
    fail("FILE_SECURITY");
}
export async function provisionProductionPush(
  target: string,
  subject: string,
  apply: boolean,
  generate: () => { publicKey: string; privateKey: string },
) {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || target !== PRODUCTION_PUSH_ENV)
    fail("ROOT_LINUX_REQUIRED");
  const directory = path.dirname(target);
  const parent = await lstat(directory),
    initial = await lstat(target);
  assertProductionEnvironmentSecurity(
    {
      regular: initial.isFile(),
      symbolicLink: initial.isSymbolicLink(),
      uid: initial.uid,
      gid: initial.gid,
      mode: initial.mode,
    },
    {
      directory: parent.isDirectory(),
      symbolicLink: parent.isSymbolicLink(),
      uid: parent.uid,
      gid: parent.gid,
      mode: parent.mode,
    },
    await realpath(directory),
  );
  const lockPath = target + ".push.lock";
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let temporary: string | undefined;
  try {
    if (apply) {
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch {
        fail("LOCK_UNAVAILABLE");
      }
    }
    const before = await readFile(target, "utf8");
    const inspection = inspectProductionPush(before, subject);
    if (!apply)
      return {
        changed: false,
        configured: inspection.configured,
        checked: true,
        backupCreated: false,
      };
    const plan = prepareProductionPush(before, subject, generate);
    if (!plan.changed)
      return { changed: false, configured: true, checked: true, backupCreated: false };
    const current = await lstat(target);
    if (
      current.ino !== initial.ino ||
      current.dev !== initial.dev ||
      (await readFile(target, "utf8")) !== before
    )
      fail("CONCURRENT_EDIT");
    const suffix = new Date().toISOString().replace(/[^0-9T]/g, "") + "-" + randomUUID();
    const backupPath = target + ".pre-vapid-" + suffix + ".bak";
    const backup = await open(backupPath, "wx", 0o600);
    try {
      await backup.chown(0, 0);
      await backup.chmod(0o600);
      await backup.writeFile(before, "utf8");
      await backup.sync();
    } finally {
      await backup.close();
    }
    temporary = target + ".vapid-" + randomUUID() + ".tmp";
    const output = await open(temporary, "wx", 0o600);
    try {
      await output.writeFile(plan.contents, "utf8");
      await output.chown(initial.uid, initial.gid);
      await output.chmod(0o640);
      await output.sync();
    } finally {
      await output.close();
    }
    const final = await lstat(target);
    if (
      final.ino !== initial.ino ||
      final.dev !== initial.dev ||
      (await readFile(target, "utf8")) !== before
    )
      fail("CONCURRENT_EDIT");
    await rename(temporary, target);
    temporary = undefined;
    const parentHandle = await open(directory, "r");
    try {
      await parentHandle.sync();
    } finally {
      await parentHandle.close();
    }
    return { changed: true, configured: true, checked: true, backupCreated: true };
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    if (lock) {
      await lock.close();
      await unlink(lockPath).catch(() => {});
    }
  }
}
