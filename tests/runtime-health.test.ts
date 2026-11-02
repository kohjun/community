import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  healthyWorkerRecord,
  workerHeartbeat,
  workerHealthPath,
  workerIsHealthy,
} from "../src/server/worker-health";
import { GET, HEAD } from "../src/app/api/health/route";

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "sliper-worker-health-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("worker startup is unhealthy until a successful cycle, expiry/death and stopping fail closed", async () => {
  await fixture(async (directory) => {
    let now = 1_800_000_000_000;
    const heartbeat = await workerHeartbeat("notification", {
      directory,
      now: () => now,
      pid: process.pid,
    });
    const check = () => workerIsHealthy("notification", { directory, now });
    assert.equal(await check(), false);
    await heartbeat.success();
    assert.equal(await check(), true);
    assert.equal(
      await workerIsHealthy("notification", { directory, now, alive: () => false }),
      false,
    );
    now += 180_001;
    assert.equal(await check(), false);
    await heartbeat.success();
    assert.equal(await check(), true);
    await heartbeat.stop();
    assert.equal(await check(), false);
    await heartbeat.success();
    assert.equal(await check(), false);
  });
});
test("video health tolerates a bounded long processing cycle but rejects expired, foreign and future records", () => {
  const now = 1_800_000_000_000;
  const value = {
    version: 1,
    worker: "video",
    pid: 12,
    startedAt: now - 1_000_000,
    succeededAt: now - 240_000,
    stopping: false,
  };
  assert.equal(healthyWorkerRecord(value, "video", now), true);
  assert.equal(
    healthyWorkerRecord({ ...value, worker: "notification" }, "notification", now),
    false,
  );
  assert.equal(healthyWorkerRecord(value, "notification", now), false);
  assert.equal(healthyWorkerRecord({ ...value, succeededAt: now - 900_001 }, "video", now), false);
  assert.equal(healthyWorkerRecord({ ...value, succeededAt: now + 5_001 }, "video", now), false);
  assert.equal(healthyWorkerRecord({ ...value, pid: -1 }, "video", now), false);
});
test("missing, malformed and oversized records fail closed; persisted health contains only process progress", async () => {
  await fixture(async (directory) => {
    assert.equal(await workerIsHealthy("notification", { directory }), false);
    const location = workerHealthPath("notification", directory);
    await writeFile(location, "invalid-json");
    assert.equal(await workerIsHealthy("notification", { directory }), false);
    await writeFile(location, "x".repeat(1025));
    assert.equal(await workerIsHealthy("notification", { directory }), false);
    const heartbeat = await workerHeartbeat("notification", { directory });
    await heartbeat.success();
    const stored = JSON.parse(await readFile(location, "utf8"));
    assert.deepEqual(Object.keys(stored).sort(), [
      "pid",
      "startedAt",
      "stopping",
      "succeededAt",
      "version",
      "worker",
    ]);
    assert.equal(await workerIsHealthy("notification", { directory }), true);
  });
});
test("liveness GET and HEAD do not disclose dependencies and cannot be cached", async () => {
  const get = GET(),
    head = HEAD();
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { status: "ok" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  for (const response of [get, head]) {
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
});
