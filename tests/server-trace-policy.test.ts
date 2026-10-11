import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyServerTraceEntry,
  inspectServerTraceManifest,
} from "../scripts/server-trace-policy";

const root = "/srv/sliper";
const trace = root + "/.next/next-server.js.nft.json";
const winRoot = String.raw`C:\Sliper`;
const winTrace = winRoot + String.raw`\.next\next-server.js.nft.json`;
const classify = (entry: string) => classifyServerTraceEntry(root, trace, entry);

test("removes project-root private directories and environment files", () => {
  for (const entry of [
    "../.local",
    "../.local/database/data",
    "../.git/objects/object",
    "../.npm-cache/_logs/log",
    "../.env",
    "../.env.local",
    "../.environment",
    "/srv/sliper/.git/config",
    "../src/../.local/photos/photo",
  ])
    assert.equal(classify(entry), "private", entry);
});

test("preserves nested and similarly named paths, dependency files, and external paths", () => {
  for (const entry of [
    "../.local-backup/file",
    "../.gitignore",
    "../.npm-cache-old/log",
    "../src/.local/file",
    "../src/.git/config",
    "../src/.npm-cache/log",
    "../src/.env.local",
    "../.env-folder/legitimate-file",
    "../node_modules/vendor/.local/file",
    "../node_modules/vendor/.env",
    "../node_modules/vendor/fonts/font.woff2",
    "../node_modules/@next/env/dist/index.js",
    "../../other/.local/file",
    "/srv/sliper-backup/.git/config",
  ])
    assert.equal(classify(entry), "keep", entry);
});

test("resolves entries from the manifest directory and normalizes parent traversal", () => {
  const nestedTrace = root + "/.next/server/app/room/page.js.nft.json";
  assert.equal(classifyServerTraceEntry(root, nestedTrace, "../../../../.local/data"), "private");
  assert.equal(classifyServerTraceEntry(root, nestedTrace, "../../../.local/data"), "keep");
  assert.equal(classify("../.local/../src/runtime.js"), "keep");
  assert.equal(classify("../src/../.env.production"), "private");
});

test("Windows paths accept mixed separators, absolute and root-relative paths, and case differences", () => {
  for (const entry of [
    String.raw`..\.LOCAL\data`,
    "../.GiT/config",
    String.raw`c:\SLIPER\.npm-cache\log`,
    String.raw`\Sliper\.ENV.production`,
    "/SLIPER/.local/data",
    String.raw`..\src\..\.git\config`,
  ])
    assert.equal(classifyServerTraceEntry(winRoot, winTrace, entry), "private", entry);
  for (const entry of [
    String.raw`D:\Sliper\.local\data`,
    String.raw`C:\Sliper-other\.git\config`,
    String.raw`..\SRC\.env.local`,
    String.raw`..\.env-folder\file`,
  ])
    assert.equal(classifyServerTraceEntry(winRoot, winTrace, entry), "keep", entry);
});

test("UNC and extended Windows prefixes identify the same project paths", () => {
  const uncRoot = String.raw`\\server\share\Sliper`;
  const uncTrace = uncRoot + String.raw`\.next\next-server.js.nft.json`;
  assert.equal(classifyServerTraceEntry(uncRoot, uncTrace, String.raw`..\.LOCAL\data`), "private");
  assert.equal(
    classifyServerTraceEntry(uncRoot, uncTrace, String.raw`\\SERVER\SHARE\SLIPER\.git\config`),
    "private",
  );
  assert.equal(
    classifyServerTraceEntry(winRoot, winTrace, String.raw`\\?\C:\Sliper\.local\data`),
    "private",
  );
  const extendedRoot = String.raw`\\?\C:\Sliper`;
  assert.equal(classifyServerTraceEntry(extendedRoot, winTrace, "../.env.local"), "private");
  const extendedUncRoot = String.raw`\\?\UNC\server\share\Sliper`;
  assert.equal(classifyServerTraceEntry(extendedUncRoot, uncTrace, "../.git/config"), "private");
  assert.equal(
    classifyServerTraceEntry(
      uncRoot,
      uncTrace,
      String.raw`\\?\UNC\server\share\Sliper\.local\data`,
    ),
    "private",
  );
});

test("worker dependencies remain visible inside private paths and outside the project", () => {
  for (const entry of [
    "../node_modules/ffmpeg-static/ffmpeg",
    "../node_modules/@ffprobe-installer/ffprobe/package.json",
    "../node_modules/vendor/node_modules/ffmpeg-static/package.json",
    "../.local/node_modules/ffmpeg-static/ffmpeg",
    "../.git/node_modules/@ffprobe-installer/linux-x64/ffprobe",
    "../../worker/node_modules/ffmpeg-static/ffmpeg",
  ])
    assert.equal(classify(entry), "worker-dependency", entry);
  assert.equal(
    classifyServerTraceEntry(
      winRoot,
      winTrace,
      String.raw`D:\worker\NODE_MODULES\FFMPEG-STATIC\ffmpeg.exe`,
    ),
    "worker-dependency",
  );
});

test("requires exact worker package names directly inside node_modules", () => {
  for (const entry of [
    "../node_modules/ffmpeg-static-extra/file",
    "../node_modules/@ffprobe-installer-extra/ffprobe/file",
    "../src/ffmpeg-static/file",
    "../src/@ffprobe-installer/ffprobe/file",
    "../node_modules/vendor/ffmpeg-static/file",
  ])
    assert.equal(classify(entry), "keep", entry);
});

test("rejects empty, NUL, and ambiguous Windows drive-relative entries", () => {
  for (const entry of ["", "\0", "../src/file\0.js"])
    assert.throws(() => classify(entry), JSON.stringify(entry));
  for (const entry of [String.raw`C:.local\secret`, String.raw`D:file`])
    assert.throws(() => classifyServerTraceEntry(winRoot, winTrace, entry), entry);
});

test("manifest inspection preserves order, duplicates, metadata, and the caller's input", () => {
  const files = Object.freeze([
    "../src/runtime.js",
    "../.local/database",
    "../node_modules/ffmpeg-static/ffmpeg",
    "../src/runtime.js",
    "../.env.local",
    "../.env-folder/file",
    "../node_modules/@ffprobe-installer/ffprobe/package.json",
  ]);
  const input = Object.freeze({ version: 1, files, custom: { label: "retained", count: 3 } });
  const snapshot = structuredClone(input);
  const result = inspectServerTraceManifest(root, trace, input);
  assert.equal(result.privateRemoved, 2);
  assert.equal(result.workerDependencies, 2);
  assert.deepEqual(result.manifest, {
    version: 1,
    files: [files[0], files[2], files[3], files[5], files[6]],
    custom: input.custom,
  });
  assert.deepEqual(input, snapshot);
  assert.notEqual(result.manifest, input);
  assert.notEqual(result.manifest.files, files);
});

test("accepts a valid empty trace and rejects invalid manifest schemas", () => {
  assert.deepEqual(inspectServerTraceManifest(root, trace, { version: 1, files: [] }), {
    manifest: { version: 1, files: [] },
    privateRemoved: 0,
    workerDependencies: 0,
  });
  for (const input of [
    undefined,
    null,
    [],
    "manifest",
    1,
    new Date(),
    new Map(),
    Object.create({ version: 1, files: [] }),
    {},
    { version: "1", files: [] },
    { version: 2, files: [] },
    { version: 1 },
    { version: 1, files: "file" },
    { version: 1, files: [1] },
    { version: 1, files: [null] },
    { version: 1, files: [""] },
    { version: 1, files: ["../src/file\0.js"] },
  ])
    assert.throws(() => inspectServerTraceManifest(root, trace, input));
});
