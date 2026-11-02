import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  NATIVE_RELEASE_FILES,
  nativeReleasePathAllowed,
  packageNativeRelease,
} from "../scripts/lib/native-release-package";
async function fixture(run: (root: string) => Promise<void>) {
  const parent = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(parent, "sliper-native-release-test-"));
  try {
    for (const name of NATIVE_RELEASE_FILES) {
      const location = path.join(root, name);
      await mkdir(path.dirname(location), { recursive: true });
      await writeFile(location, name + "\n");
    }
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "main.ts"), "export const app = true;\n");
    await mkdir(path.join(root, "public", "images"), { recursive: true });
    await writeFile(path.join(root, "public", "images", "logo.png"), new Uint8Array([1, 2, 3]));
    await run(root);
  } finally {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("sliper-native-release-test-"));
    await rm(root, { recursive: true, force: true });
  }
}
test("native release is an exact allowlist snapshot with verified archive/hash and excludes external private roots", async () => {
  await fixture(async (root) => {
    await writeFile(path.join(root, ".env"), "PRIVATE_FIXTURE_DO_NOT_PACKAGE=1\n");
    await mkdir(path.join(root, "tests"));
    await writeFile(path.join(root, "tests", "private.ts"), "private fixture\n");
    const result = await packageNativeRelease(root, "release-01");
    assert.equal(result.verified, true);
    assert.equal(result.sourceFiles, NATIVE_RELEASE_FILES.length + 2);
    assert.equal(result.archiveFiles, result.sourceFiles + 2);
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    const manifest = JSON.parse(
      await readFile(
        path.join(path.dirname(result.archive), "source", "SLIPER_RELEASE_MANIFEST.json"),
        "utf8",
      ),
    );
    assert.equal(
      manifest.files.some(
        (entry: { path: string }) => entry.path.includes(".env") || entry.path.startsWith("tests/"),
      ),
      false,
    );
    assert.ok(
      manifest.files.every((entry: { sha256: string }) => /^[0-9a-f]{64}$/.test(entry.sha256)),
    );
    await assert.rejects(() => packageNativeRelease(root, "release-01"));
  });
});
test("private files inside selected source trees fail closed instead of entering release", async () => {
  await fixture(async (root) => {
    await writeFile(path.join(root, "src", "credential.pem"), "fixture");
    await assert.rejects(() => packageNativeRelease(root, "release-01"), /forbidden/);
  });
});
test("linked source directories cannot smuggle outside files", async () => {
  await fixture(async (root) => {
    const outside = path.join(root, "private-outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "hidden.ts"), "not source");
    await symlink(
      outside,
      path.join(root, "src", "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(() => packageNativeRelease(root, "release-01"), /links/);
  });
});
test("path and tag guards reject traversal, credentials and user upload locations", async () => {
  for (const entry of [
    "../.env",
    "/root/key",
    "src/.env.local",
    "src/runtime.env",
    "deploy/native/runtime.env.production",
    "src/.npmrc",
    "src/id_ed25519",
    "src/secrets/a.ts",
    "public/uploads/image.png",
    "public/images/key.pem",
    "src/a\nb.ts",
  ])
    assert.equal(nativeReleasePathAllowed(entry), false, entry);
  assert.equal(nativeReleasePathAllowed("public/fonts/PretendardVariable.woff2"), true);
  await fixture(async (root) => {
    for (const tag of ["../release", "", "-bad", "release with spaces"])
      await assert.rejects(() => packageNativeRelease(root, tag), /tag/);
  });
});
