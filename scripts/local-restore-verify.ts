import "dotenv/config";
import { unlink, writeFile } from "node:fs/promises";
import {
  argumentsFor,
  assertSnapshot,
  containedPath,
  connectLocal,
  createScratch,
  databaseSnapshot,
  decryptFile,
  hashFile,
  initializeRestore,
  localConfiguration,
  newRestoreDatabase,
  publicFailure,
  requireMedia,
  restoreDump,
  verifyPackage,
} from "./lib/local-backup-core";

let admin: ReturnType<typeof connectLocal> | undefined,
  scratch: ReturnType<typeof connectLocal> | undefined;
try {
  const id = argumentsFor(process.argv.slice(2), true)!,
    config = localConfiguration(process.env),
    workspace = process.cwd();
  // Authenticate package paths, manifest and ciphertext first. Do not create or touch a database yet.
  const { root: backupRoot, manifest, key } = await verifyPackage(workspace, id);
  const database = newRestoreDatabase(),
    root = await initializeRestore(workspace, database);
  const dump = containedPath(root, "database.pgdump"),
    restoredFiles: string[] = [];
  // GCM tags and plaintext digests are verified before CREATE DATABASE, including the entire SQL dump.
  for (const file of manifest.files) {
    const relative =
      file.path === "database.pgdump.enc"
        ? "database.pgdump"
        : ".local/" + file.path.slice("media/".length, -".enc".length);
    await decryptFile(
      containedPath(backupRoot, file.path),
      containedPath(root, relative),
      key,
      id,
      file,
    );
    if (file.path !== "database.pgdump.enc") restoredFiles.push(file.path);
  }
  admin = connectLocal(config, "postgres");
  await createScratch(admin, database);
  await restoreDump(dump, config, database, process.env);
  scratch = connectLocal(config, database);
  const snapshot = await databaseSnapshot(scratch);
  assertSnapshot(snapshot, manifest);
  requireMedia(snapshot, restoredFiles);
  for (const file of manifest.files) {
    if (file.path === "database.pgdump.enc") continue;
    const destination = containedPath(
      root,
      ".local/" + file.path.slice("media/".length, -".enc".length),
    );
    const checked = await hashFile(destination, file.plainBytes);
    if (checked.bytes !== file.plainBytes || checked.sha256 !== file.plainSha256)
      throw new Error("Restored media changed");
  }
  await unlink(dump);
  const report = {
    status: "RESTORE_VERIFIED",
    backup: id,
    scratchDatabase: database,
    tables: Object.keys(snapshot.tableCounts).length,
    mediaFiles: restoredFiles.length,
    flowCounts: snapshot.flowCounts,
    rowHashesMatched: true,
    mediaHashesMatched: true,
    deliveryWorkersStarted: false,
    originalDatabaseModified: false,
    originalMediaModified: false,
  };
  await writeFile(containedPath(root, "verified.json"), JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
} catch (error) {
  console.error("Local restore verification failed: " + publicFailure(error));
  process.exitCode = 1;
} finally {
  if (scratch) await scratch.end({ timeout: 5 });
  if (admin) await admin.end({ timeout: 5 });
}
