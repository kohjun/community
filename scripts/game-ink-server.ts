import { config } from "dotenv";
import { createInkRedis } from "../src/server/game-ink-redis";
import { createInkGateway } from "../src/server/game-ink-gateway";
config({ path: [".env.local", ".env"], quiet: true });
const url = process.env.GAME_REDIS_URL ?? process.env.TOWN_REDIS_URL ?? process.env.REDIS_URL,
  key = process.env.VISITOR_HASH_SECRET ?? "",
  port = Number(process.env.GAME_INK_PORT ?? 13004);
if (!url || key.length < 32 || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Game ink configuration is incomplete.");
const redis = await createInkRedis(url),
  gateway = await createInkGateway({
    store: redis.store,
    key,
    origin: new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000").origin,
  });
gateway.server.listen(port, "127.0.0.1", () => console.log("Sliper game ink ready on loopback."));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await gateway.close();
  await redis.close();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
