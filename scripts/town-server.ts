import { createTownVoicePolicy } from "../src/server/town-voice";
import { createTownCache } from "../src/server/town-cache";
import { config } from "dotenv";
config({ quiet: true });
import { createDatabase } from "../src/db/connection";
import { createTownGateway } from "../src/server/town-gateway";
import { loadTownMembers } from "../src/server/town-members";
import { townSecret } from "../src/server/town-ticket";
const url = process.env.DATABASE_URL,
  origin = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000").origin;
if (!url) throw new Error("DATABASE_URL is required.");
const connection = createDatabase(url, 1),
  port = Number(process.env.TOWN_PORT ?? 13003);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid town port.");
const voice = createTownVoicePolicy(),
  cache = await createTownCache(process.env.TOWN_REDIS_URL ?? process.env.REDIS_URL, townSecret());
const capacity = Number(process.env.TOWN_MAX_CLIENTS ?? 8);
if (!Number.isInteger(capacity) || capacity < 2 || capacity > 150)
  throw new Error("Town capacity must be between 2 and 150.");
const gateway = createTownGateway({
  key: townSecret(),
  origin,
  capacity,
  ...(cache
    ? { consumeNonce: cache.consumeNonce, chatLimit: cache.chatLimit, isHealthy: cache.isReady }
    : {}),
  ...(voice
    ? {
        onVoice: (targets: Map<string, string[]>) => voice.sync(targets),
        onRemoveVoice: (id: string) => voice.remove(id),
      }
    : {}),
  members: (actors) => loadTownMembers(connection.db, actors),
});
await gateway.listen(port, process.env.TOWN_BIND_HOST ?? "127.0.0.1");
console.log(`Sliper Town listening on loopback:${port}`);
const presence = setInterval(() => {
  void cache
    ?.presence([...gateway.world.residents.values()].map((p) => p.avatar.id))
    .catch(() => {});
}, 15_000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(presence);
  await gateway.close();
  await cache?.close();
  await connection.close();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
