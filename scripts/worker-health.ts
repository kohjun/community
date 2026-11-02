import { workerIsHealthy } from "../src/server/worker-health";
const worker = process.argv[2];
if (process.argv.length !== 3 || (worker !== "notification" && worker !== "video")) {
  console.error("Usage: npm run ops:worker-health -- notification|video");
  process.exitCode = 2;
} else {
  const healthy = await workerIsHealthy(worker);
  console.log(JSON.stringify({ worker, healthy }));
  process.exitCode = healthy ? 0 : 1;
}
