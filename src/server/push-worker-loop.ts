import type { Database } from "../db/connection";
import { pushDispatcher } from "./push-dispatcher";
import { engagementWorker } from "./engagement-worker";
import type { PushConfiguration } from "./push-configuration";

export function startPushWorker(
  db: Database,
  config: PushConfiguration | null,
  options: { unref?: boolean } = {},
) {
  const dispatcher = config ? pushDispatcher(db, config) : null;
  const engagement = engagementWorker(db);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<unknown> = Promise.resolve();
  function schedule(delay = 2000) {
    if (stopped) return;
    timer = setTimeout(() => {
      active = engagement
        .drain()
        .then(() => dispatcher?.drain())
        .catch(() => {
          // No credentials, endpoints, message bodies or private member IDs in logs.
          console.error("Sliper notification worker: batch could not be processed.");
        })
        .finally(() => schedule());
    }, delay);
    if (options.unref) timer.unref();
  }
  schedule();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    },
  };
}
