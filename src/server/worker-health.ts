import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type WorkerKind = "notification" | "video";
export const WORKER_HEALTH_MAX_AGE = { notification: 180_000, video: 900_000 } as const;
interface WorkerHealth {
  version: 1;
  worker: WorkerKind;
  pid: number;
  startedAt: number;
  succeededAt: number | null;
  stopping: boolean;
}
export function workerHealthPath(worker: WorkerKind, directory = tmpdir()) {
  return path.join(directory, `sliper-${worker}-health.json`);
}
export function healthyWorkerRecord(
  value: unknown,
  worker: WorkerKind,
  now = Date.now(),
): value is WorkerHealth {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<WorkerHealth>;
  return (
    r.version === 1 &&
    r.worker === worker &&
    Number.isSafeInteger(r.pid) &&
    r.pid! > 0 &&
    Number.isSafeInteger(r.startedAt) &&
    r.startedAt! > 0 &&
    Number.isSafeInteger(r.succeededAt) &&
    r.succeededAt! >= r.startedAt! &&
    r.succeededAt! <= now + 5_000 &&
    now - r.succeededAt! <= WORKER_HEALTH_MAX_AGE[worker] &&
    r.stopping === false
  );
}
/** A successful work cycle, rather than an unrelated timer, advances this record. */
export async function workerHeartbeat(
  worker: WorkerKind,
  options: { directory?: string; now?: () => number; pid?: number } = {},
) {
  const now = options.now ?? Date.now;
  const location = workerHealthPath(worker, options.directory);
  const state: WorkerHealth = {
    version: 1,
    worker,
    pid: options.pid ?? process.pid,
    startedAt: now(),
    succeededAt: null,
    stopping: false,
  };
  async function persist() {
    const temporary = `${location}.${state.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 });
      await rename(temporary, location);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  await persist();
  let lastWrite = 0;
  return {
    async success() {
      if (state.stopping) return;
      const current = now();
      if (state.succeededAt !== null && current >= lastWrite && current - lastWrite < 10_000)
        return;
      state.succeededAt = current;
      await persist();
      lastWrite = current;
    },
    async stop() {
      state.stopping = true;
      await persist();
    },
  };
}
/** Health records contain no environment values, member IDs, object keys or message contents. */
export async function workerIsHealthy(
  worker: WorkerKind,
  options: { directory?: string; now?: number; alive?: (pid: number) => boolean } = {},
) {
  try {
    const location = workerHealthPath(worker, options.directory);
    const metadata = await lstat(location);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024) return false;
    const value: unknown = JSON.parse(await readFile(location, "utf8"));
    if (!healthyWorkerRecord(value, worker, options.now)) return false;
    const alive =
      options.alive ??
      ((pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      });
    return alive(value.pid);
  } catch {
    return false;
  }
}
