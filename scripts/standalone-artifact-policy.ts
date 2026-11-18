import { lstat, readdir, realpath, rm, unlink } from "node:fs/promises";
import path from "node:path";

const samePath = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
/** Next copies .env explicitly as well as traced files. Sanitize generated copies only. */
export async function sanitizeStandaloneArtifact(projectRoot: string) {
  if (!path.isAbsolute(projectRoot)) throw new Error("An absolute project root is required.");
  const root = await realpath(projectRoot),
    build = path.join(root, ".next"),
    artifact = path.join(build, "standalone");
  // Refuse redirected build outputs: a packaging policy must never remove source files.
  for (const directory of [build, artifact]) {
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !samePath(await realpath(directory), directory)
    )
      throw new Error("Unsafe standalone artifact root.");
  }
  const entries = await readdir(artifact, { withFileTypes: true });
  const targets = entries
    .filter((e) => e.name.startsWith(".env") || [".local", ".git", ".npm-cache"].includes(e.name))
    .map((e) => path.resolve(artifact, e.name));
  for (const target of targets) {
    if (
      !samePath(path.dirname(target), artifact) ||
      !path.relative(artifact, target) ||
      samePath(target, root)
    )
      throw new Error("Unsafe private artifact path.");
  }
  for (const target of targets) {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) await unlink(target);
    else await rm(target, { recursive: stat.isDirectory(), force: false });
  }
  const remaining = await readdir(artifact);
  if (remaining.some((n) => n.startsWith(".env") || [".local", ".git", ".npm-cache"].includes(n)))
    throw new Error("Private files remain in the standalone artifact.");
  return { privateCopiesRemoved: targets.length };
}
