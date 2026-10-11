import "dotenv/config";
import { createDatabase } from "../src/db/connection";
import { pushConfiguration } from "../src/server/push-configuration";
import { pushDispatcher } from "../src/server/push-dispatcher";
import { startPushWorker } from "../src/server/push-worker-loop";
import { engagementWorker } from "../src/server/engagement-worker";

const config = pushConfiguration();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const connection = createDatabase(process.env.DATABASE_URL, 2);
if (process.argv.includes("--once")) {
  try {
    const inbox = await engagementWorker(connection.db).drain();
    const push = config ? await pushDispatcher(connection.db, config).drain() : { processed: 0 };
    console.log(JSON.stringify({ ...inbox, ...push, pushConfigured: !!config }));
  } finally {
    await connection.close();
  }
} else {
  const worker = startPushWorker(connection.db, config);
  console.log("Sliper notification worker ready.");
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await worker.stop();
    await connection.close();
  }
  process.once("SIGINT", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
}
