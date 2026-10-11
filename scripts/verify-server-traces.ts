import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectServerTraceManifest } from "./server-trace-policy";

const counts = { manifests: 0, privateRemoved: 0, workerDependencies: 0, errors: 0 };
async function traces(directory: string): Promise<string[]> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error("Invalid trace directory.");
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await traces(location)));
    else if (entry.name.endsWith(".nft.json")) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Invalid trace manifest.");
      found.push(location);
    }
  }
  return found;
}
try {
  if (process.argv.length !== 2) throw new Error("Unexpected trace verification arguments.");
  const root = path.resolve(process.cwd());
  const server = await traces(path.join(root, ".next", "server"));
  if (server.length === 0) throw new Error("Server traces are missing.");
  const serverManifest = path.join(root, ".next", "next-server.js.nft.json");
  const metadata = await lstat(serverManifest);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("Server trace manifest is missing.");
  const manifests = [...server, serverManifest].sort();
  counts.manifests = manifests.length;
  // Validate every manifest before rewriting any, so malformed output never partially passes.
  const plans = [];
  for (const location of manifests) {
    const manifest = JSON.parse(await readFile(location, "utf8")) as unknown;
    plans.push({ location, ...inspectServerTraceManifest(root, location, manifest) });
  }
  counts.workerDependencies = plans.reduce((total, plan) => total + plan.workerDependencies, 0);
  for (const plan of plans)
    if (plan.privateRemoved) {
      await writeFile(plan.location, JSON.stringify(plan.manifest) + "\n", "utf8");
      counts.privateRemoved += plan.privateRemoved;
    }
} catch {
  // Manifest errors can include private paths or JSON contents; never display the exception.
  counts.errors++;
}
console.log("Server trace policy: " + JSON.stringify(counts));
if (counts.errors || counts.workerDependencies) process.exitCode = 1;
