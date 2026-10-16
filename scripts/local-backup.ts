import "dotenv/config";
import { writeFile } from "node:fs/promises";
import {
  argumentsFor,
  assertSnapshot,
  containedPath,
  connectLocal,
  databaseSnapshot,
  dumpDatabase,
  encryptFile,
  hashFile,
  initializeBackup,
  localConfiguration,
  mediaInventory,
  newBackupId,
  publicFailure,
  requireMedia,
  signManifest,
  verifyPrivate,
  validateManifest,
  type BackupFile,
} from "./lib/local-backup-core";

let client: ReturnType<typeof connectLocal> | undefined;
try {
  argumentsFor(process.argv.slice(2));
  const configuration = localConfiguration(process.env),
    workspace = process.cwd();
  client = connectLocal(configuration);
  const before = await databaseSnapshot(client),
    inventory = await mediaInventory(workspace);
  requireMedia(
    before,
    inventory.map((file) => file.relative),
  );
  const id = newBackupId(),
    { root, key } = await initializeBackup(workspace, id);
  const files: BackupFile[] = [
    await dumpDatabase(
      containedPath(root, "database.pgdump.enc"),
      key,
      id,
      configuration,
      process.env,
    ),
  ];
  for (const file of inventory)
    files.push(
      await encryptFile(file.source, containedPath(root, file.relative), key, id, file.relative),
    );
  const after = await databaseSnapshot(client);
  assertSnapshot(after, before);
  const finalInventory = await mediaInventory(workspace);
  if (
    finalInventory.map((file) => file.relative).join("\0") !==
    inventory.map((file) => file.relative).join("\0")
  )
    throw new Error("Source changed");
  // Detect source writes during the capture; quiescence is still mandatory, not inferred from this check.
  for (const source of finalInventory) {
    const expected = files.find((file) => file.path === source.relative)!;
    const actual = await hashFile(source.source, expected.plainBytes);
    if (actual.bytes !== expected.plainBytes || actual.sha256 !== expected.plainSha256)
      throw new Error("Source changed");
  }
  const manifest = signManifest(
    {
      version: 1,
      id,
      createdAt: new Date().toISOString(),
      source: "local-sliper-dev",
      compression: "none",
      encryption: "AES-256-GCM+HKDF-SHA256+HMAC-SHA256",
      serverMajor: before.serverMajor,
      tableCounts: before.tableCounts,
      flowCounts: before.flowCounts,
      flowSha256: before.flowSha256,
      files,
    },
    key,
  );
  validateManifest(manifest, key, id);
  const destination = containedPath(root, "manifest.json");
  await writeFile(destination, JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await verifyPrivate(destination);
  console.log(
    JSON.stringify({
      status: "BACKUP_VERIFIED_CAPTURE",
      backup: id,
      tables: Object.keys(before.tableCounts).length,
      mediaFiles: inventory.length,
      encrypted: true,
      restoreVerified: false,
    }),
  );
} catch (error) {
  console.error("Local backup failed: " + publicFailure(error));
  process.exitCode = 1;
} finally {
  if (client) await client.end({ timeout: 5 });
}
