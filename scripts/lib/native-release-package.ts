import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export const NATIVE_RELEASE_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  "postcss.config.mjs",
  "drizzle.config.ts",
  "components.json",
  "scripts/cloud-check.ts",
  "scripts/town-server.ts",
  "scripts/push-worker.ts",
  "scripts/provision-production-push.ts",
  "scripts/lib/production-push-provision.ts",
  "scripts/video-worker.ts",
  "scripts/worker-health.ts",
  "scripts/staff.ts",
  "scripts/lib/staff-role-management.ts",
  "scripts/object-cleanup.ts",
  "scripts/media-cleanup.ts",
  "scripts/verify-server-traces.ts",
  "scripts/server-trace-policy.ts",
] as const;
const trees = ["src", "public"] as const;
const forbiddenComponents = new Set([
  ".git",
  ".local",
  ".aws",
  ".ssh",
  ".agents",
  ".codex",
  "node_modules",
  ".npmrc",
  ".netrc",
  ".git-credentials",
  ".pypirc",
  "uploads",
  "secrets",
]);
export function nativeReleasePathAllowed(relative: string): boolean {
  if (
    !relative ||
    relative.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(relative) ||
    path.posix.isAbsolute(relative)
  )
    return false;
  const components = relative.split("/");
  if (
    components.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        forbiddenComponents.has(part.toLowerCase()) ||
        part.toLowerCase().startsWith(".env"),
    )
  )
    return false;
  const name = components.at(-1)!.toLowerCase();
  if (
    /\.env(?:\.|$)/.test(name) ||
    /\.(?:pem|key|ppk|p12|pfx)$/.test(name) ||
    /^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|credentials\.json|service-account.*\.json)$/.test(
      name,
    )
  )
    return false;
  if (components[0] === "public")
    return (
      relative === "public/sw.js" ||
      ["images", "fonts"].includes(components[1] ?? "") ||
      [
        "public/guides/first-meeting-checklist.md",
        "public/guides/mc-opening-cues.md",
        "public/guides/event-retrospective.md",
      ].includes(relative)
    );
  return (
    relative.startsWith("src/") ||
    relative.startsWith("deploy/native/") ||
    (NATIVE_RELEASE_FILES as readonly string[]).includes(relative)
  );
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function plainSource(root: string, relative: string) {
  const parts = relative.split(/[\\/]/);
  let location = root;
  for (const [index, part] of parts.entries()) {
    location = path.join(location, part);
    const value = await lstat(location);
    if (value.isSymbolicLink() || (index < parts.length - 1 && !value.isDirectory()))
      throw new Error("Release source ancestors cannot contain links.");
  }
  return lstat(location);
}
async function regularFiles(root: string, relative: string): Promise<string[]> {
  const location = path.join(root, relative);
  const metadata = await plainSource(root, relative);
  if (metadata.isSymbolicLink()) throw new Error("Release sources cannot contain links.");
  if (metadata.isFile()) {
    const normalized = relative.split(path.sep).join("/");
    if (!nativeReleasePathAllowed(normalized) || metadata.nlink !== 1)
      throw new Error("Release contains a forbidden or linked source file.");
    if (metadata.size > 50 * 1024 * 1024) throw new Error("Unexpectedly large release source.");
    return [normalized];
  }
  if (!metadata.isDirectory()) throw new Error("Unexpected release source type.");
  const result: string[] = [];
  for (const entry of await readdir(location))
    result.push(...(await regularFiles(root, path.join(relative, entry))));
  return result;
}
async function inventory(root: string) {
  const found = [...NATIVE_RELEASE_FILES] as string[];
  for (const relative of NATIVE_RELEASE_FILES) {
    const metadata = await plainSource(root, relative);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
      throw new Error("Invalid required release source.");
  }
  for (const tree of trees) found.push(...(await regularFiles(root, tree)));
  try {
    found.push(...(await regularFiles(root, "deploy/native")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return found.sort();
}
export async function packageNativeRelease(projectRoot: string, tag: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(tag)) throw new Error("Invalid native release tag.");
  const root = await realpath(path.resolve(projectRoot));
  const names = await inventory(root);
  const local = path.join(root, ".local");
  await mkdir(local, { recursive: true });
  if ((await realpath(local)) !== local) throw new Error("Invalid local artifact directory.");
  const parent = path.join(local, "native-releases");
  await mkdir(parent, { recursive: true });
  if ((await realpath(parent)) !== parent) throw new Error("Invalid native artifact directory.");
  const directory = path.join(parent, tag);
  await mkdir(directory); // A release tag is immutable; never overwrite a previous artifact.
  const stage = path.join(directory, "source");
  await mkdir(stage);
  const files: { path: string; bytes: number; sha256: string }[] = [];
  let totalBytes = 0;
  for (const relative of names) {
    const source = path.join(root, relative);
    const bytes = await readFile(source);
    totalBytes += bytes.byteLength;
    if (totalBytes > 512 * 1024 * 1024) throw new Error("Unexpectedly large release inventory.");
    const target = path.join(stage, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
    files.push({ path: relative, bytes: bytes.byteLength, sha256: digest(bytes) });
  }
  // Refuse a mixed snapshot if a source was added/removed/edited during collection.
  if (JSON.stringify(names) !== JSON.stringify(await inventory(root)))
    throw new Error("Release sources changed during packaging.");
  for (const item of files)
    if (digest(await readFile(path.join(root, item.path))) !== item.sha256)
      throw new Error("Release sources changed during packaging.");
  const manifest = {
    format: 1,
    kind: "native-build-source",
    tag,
    createdAt: new Date().toISOString(),
    secretFilesIncluded: false,
    files,
  };
  const extras = ["SLIPER_RELEASE_MANIFEST.json", "SHA256SUMS"];
  await writeFile(path.join(stage, extras[0]!), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  await writeFile(
    path.join(stage, extras[1]!),
    files.map((file) => `${file.sha256}  ${file.path}\n`).join(""),
    { flag: "wx" },
  );
  const archive = path.join(directory, `${tag}.tar.gz`);
  const archiveEntries = [...names, ...extras].sort();
  const list = path.join(directory, "archive-files.txt");
  await writeFile(list, archiveEntries.join("\n") + "\n", { flag: "wx" });
  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  const runTar = (args: string[]) =>
    execFileSync(tar, args, { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const version = runTar(["--version"]);
  const ownership = version.includes("bsdtar")
    ? ["--uid", "0", "--gid", "0", "--uname", "root", "--gname", "root"]
    : ["--owner=0", "--group=0", "--numeric-owner"];
  runTar(["--format=ustar", ...ownership, "-czf", archive, "-C", stage, "-T", list]);
  const listed = runTar(["-tzf", archive]).trim().split(/\r?\n/).sort();
  if (JSON.stringify(listed) !== JSON.stringify(archiveEntries))
    throw new Error("Unexpected archive entries.");
  const kinds = runTar(["-tvzf", archive]).trim().split(/\r?\n/);
  if (kinds.length !== archiveEntries.length || kinds.some((line) => !line.startsWith("-")))
    throw new Error("Release archive must contain only regular files.");
  const result = {
    tag,
    archive,
    sha256: digest(await readFile(archive)),
    sourceFiles: files.length,
    sourceBytes: totalBytes,
    archiveFiles: listed.length,
    verified: true,
  };
  await writeFile(path.join(directory, "artifact.json"), JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
  });
  return result;
}
