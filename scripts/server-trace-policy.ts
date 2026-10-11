import path from "node:path";

export type ServerTraceEntryPolicy = "keep" | "private" | "worker-dependency";
export interface ServerTraceManifest {
  version: 1;
  files: string[];
  [key: string]: unknown;
}
function validPath(value: string) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error("Invalid server trace path.");
}
function windowsPath(value: string) {
  const normalized = value.replaceAll("/", "\\");
  if (normalized.startsWith("\\\\?\\UNC\\")) return "\\\\" + normalized.slice(8);
  if (normalized.startsWith("\\\\?\\")) {
    const rest = normalized.slice(4);
    if (/^[a-z]:\\/i.test(rest)) return rest;
    throw new Error("Unsupported server trace path.");
  }
  if (normalized.startsWith("\\\\.\\") || /^[a-z]:(?!\\)/i.test(normalized))
    throw new Error("Unsupported server trace path.");
  return normalized;
}

/** NFT entries are relative to their manifest, not the project or build directory. */
export function classifyServerTraceEntry(
  projectRoot: string,
  manifestPath: string,
  entry: string,
): ServerTraceEntryPolicy {
  for (const value of [projectRoot, manifestPath, entry]) validPath(value);
  const windows = /^[a-z]:[\\/]|^[\\/]{2}[^\\/]/i.test(projectRoot);
  const paths = windows ? path.win32 : path.posix;
  const root = windows ? windowsPath(projectRoot) : projectRoot;
  const manifest = windows ? windowsPath(manifestPath) : manifestPath;
  const file = windows ? windowsPath(entry) : entry;
  if (!paths.isAbsolute(root) || !paths.isAbsolute(manifest))
    throw new Error("Server trace roots must be absolute.");
  const resolved = paths.resolve(paths.dirname(manifest), file);
  const components = (windows ? resolved.toLowerCase() : resolved).split(paths.sep);
  for (let index = 0; index < components.length - 1; index++)
    if (
      components[index] === "node_modules" &&
      ["ffmpeg-static", "@ffprobe-installer"].includes(components[index + 1]!)
    )
      return "worker-dependency";
  const relative = paths.relative(paths.resolve(root), resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(".." + paths.sep) ||
    paths.isAbsolute(relative)
  )
    return "keep";
  const parts = (windows ? relative.toLowerCase() : relative).split(paths.sep);
  if (
    [".local", ".git", ".npm-cache"].includes(parts[0]!) ||
    (parts.length === 1 && parts[0]!.startsWith(".env"))
  )
    return "private";
  return "keep";
}

/** Preserve metadata, order, and worker entries; the CLI fails rather than hiding worker dependencies. */
export function inspectServerTraceManifest(
  projectRoot: string,
  manifestPath: string,
  input: unknown,
): { manifest: ServerTraceManifest; privateRemoved: number; workerDependencies: number } {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new Error("Invalid server trace manifest.");
  const value = input as Record<string, unknown>;
  if (
    value.version !== 1 ||
    !Array.isArray(value.files) ||
    value.files.some((file) => typeof file !== "string")
  )
    throw new Error("Invalid server trace manifest.");
  const files: string[] = [];
  let privateRemoved = 0,
    workerDependencies = 0;
  for (const file of value.files as string[]) {
    const classification = classifyServerTraceEntry(projectRoot, manifestPath, file);
    if (classification === "private") privateRemoved++;
    else {
      files.push(file);
      if (classification === "worker-dependency") workerDependencies++;
    }
  }
  return { manifest: { ...value, version: 1, files }, privateRemoved, workerDependencies };
}
