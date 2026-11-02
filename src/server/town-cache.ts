import { createClient } from "redis";
import { townSignature } from "./town-ticket";
export async function createTownCache(url: string | undefined, key: string) {
  if (!url) return null;
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (attempt) => Math.min(2000, 100 * 2 ** Math.min(attempt, 4)),
    },
  });
  client.on("error", () => {});
  await client.connect();
  return {
    isReady: () => client.isReady,
    async consumeNonce(nonce: string, ttl: number) {
      return (
        (await client.set(`sliper:town:nonce:${nonce}`, "1", {
          NX: true,
          PX: Math.max(1, ttl),
        })) === "OK"
      );
    },
    async chatLimit(actor: string) {
      const k = `sliper:town:rate:chat:${townSignature(actor, key)}`;
      const count = await client.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
        { keys: [k], arguments: [] },
      );
      return Number(count) <= 20;
    },
    async presence(ids: string[]) {
      const tx = client.multi();
      for (const id of ids) tx.set(`sliper:town:presence:${id}`, "main-world", { EX: 60 });
      if (ids.length) await tx.exec();
    },
    async close() {
      if (client.isReady) await client.quit();
      else client.destroy();
    },
  };
}
