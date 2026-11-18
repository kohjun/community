import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access, symlink, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeStandaloneArtifact } from "../scripts/standalone-artifact-policy";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), "sliper-artifact-policy-"));
  const artifact = path.join(root, ".next", "standalone");
  await mkdir(artifact, { recursive: true });
  t.after(async () => {
    const resolved = path.resolve(root),
      temp = path.resolve(tmpdir());
    assert.equal(path.dirname(resolved), temp);
    assert.ok(path.basename(resolved).startsWith("sliper-artifact-policy-"));
    await rm(resolved, { recursive: true, force: true });
  });
  return { root, artifact };
}
test("packaging removes generated private copies, preserves source and similarly named runtime dependencies, and is idempotent", async (t) => {
  const { root, artifact } = await fixture(t);
  await writeFile(path.join(root, ".env"), "source fixture");
  await mkdir(path.join(root, ".local"));
  await writeFile(path.join(root, ".local", "keep.txt"), "source data");
  await writeFile(path.join(artifact, ".env"), "copied fixture");
  await writeFile(path.join(artifact, ".env.production"), "copied fixture");
  await mkdir(path.join(artifact, ".local"));
  await writeFile(path.join(artifact, ".local", "copy.txt"), "copied data");
  await mkdir(path.join(artifact, "node_modules", "example"), { recursive: true });
  await writeFile(
    path.join(artifact, "node_modules", "example", ".env.example"),
    "dependency fixture",
  );
  await mkdir(path.join(artifact, ".localization"));
  await writeFile(path.join(artifact, "server.js"), "runtime fixture");
  assert.equal((await sanitizeStandaloneArtifact(root)).privateCopiesRemoved, 3);
  await assert.rejects(access(path.join(artifact, ".env")));
  await assert.rejects(access(path.join(artifact, ".local")));
  assert.equal(await readFile(path.join(root, ".env"), "utf8"), "source fixture");
  assert.equal(await readFile(path.join(root, ".local", "keep.txt"), "utf8"), "source data");
  await access(path.join(artifact, "node_modules", "example", ".env.example"));
  await access(path.join(artifact, ".localization"));
  await access(path.join(artifact, "server.js"));
  assert.equal((await sanitizeStandaloneArtifact(root)).privateCopiesRemoved, 0);
});
test("a redirected standalone root fails before deleting any files in the external target", async (t) => {
  const { root, artifact } = await fixture(t),
    external = path.join(root, "external");
  await mkdir(external);
  await writeFile(path.join(external, ".env"), "external fixture");
  await rmdir(artifact);
  await symlink(external, artifact, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(sanitizeStandaloneArtifact(root), /Unsafe/);
  assert.equal(await readFile(path.join(external, ".env"), "utf8"), "external fixture");
});
