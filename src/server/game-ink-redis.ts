import { createClient } from "redis";
import type { InkAuthority, InkStore } from "./game-ink-core";
import type { InkEvent } from "../domain/game-ink";
const channel = "sliper:game-ink:events";
export async function createInkRedis(url: string) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: { connectTimeout: 3000, reconnectStrategy: (n) => Math.min(5000, 200 * (n + 1)) },
  });
  client.on("error", () => {});
  await client.connect();
  const key = (r: string, c: string) => `sliper:game-ink:${r}:${c}`;
  const store: InkStore = {
    async authority(roomId) {
      const s = await client.get(key(roomId, "authority"));
      return s ? (JSON.parse(s) as InkAuthority) : null;
    },
    async events(roomId, canvas) {
      return (await client.lRange(key(roomId, canvas + ":events"), 0, 1499)).map(
        (x) => JSON.parse(x) as InkEvent,
      );
    },
    async append(roomId, canvas, event) {
      const n = event.command.op === "stroke" ? event.command.points.length : 0;
      const result = await client.eval(
        "local n=tonumber(redis.call('GET',KEYS[1]) or '0'); local seq=tonumber(ARGV[1]); if seq<=n then return 'duplicate' end; if seq~=n+1 then return 'resync' end; local points=tonumber(redis.call('GET',KEYS[3]) or '0'); if n>=1499 or points+tonumber(ARGV[3])>12000 then return 'full' end; redis.call('SET',KEYS[1],seq,'EX',900);redis.call('RPUSH',KEYS[2],ARGV[2]);redis.call('EXPIRE',KEYS[2],900);redis.call('SET',KEYS[3],ARGV[4]=='clear' and 0 or points+tonumber(ARGV[3]),'EX',900);redis.call('PUBLISH',ARGV[5],ARGV[6]);return 'ok'",
        {
          keys: [
            key(roomId, canvas + ":seq"),
            key(roomId, canvas + ":events"),
            key(roomId, canvas + ":points"),
          ],
          arguments: [
            String(event.seq),
            JSON.stringify(event),
            String(n),
            event.command.op,
            channel,
            JSON.stringify({ roomId, canvas, event }),
          ],
        },
      );
      return String(result) as "ok" | "duplicate" | "resync" | "full";
    },
    async listen(handler) {
      const subscriber = client.duplicate();
      subscriber.on("error", () => {});
      await subscriber.connect();
      await subscriber.subscribe(channel, (body) => {
        try {
          handler(JSON.parse(body));
        } catch {
          /* invalid messages never reach clients */
        }
      });
      return async () => {
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      };
    },
  };
  return {
    store,
    async sync(authority: InkAuthority) {
      await client.eval(
        "local old=redis.call('GET',KEYS[1]);if old and tonumber(cjson.decode(old).revision)>tonumber(ARGV[2]) then return 0 end;redis.call('SET',KEYS[1],ARGV[1],'EX',120);redis.call('PUBLISH',ARGV[3],ARGV[4]);return 1",
        {
          keys: [key(authority.roomId, "authority")],
          arguments: [
            JSON.stringify(authority),
            String(authority.revision),
            channel,
            JSON.stringify({ roomId: authority.roomId, authority }),
          ],
        },
      );
    },
    async close() {
      await client.quit();
    },
  };
}
