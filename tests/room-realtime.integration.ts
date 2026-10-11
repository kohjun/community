import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { promisify } from "node:util";
import { createClient } from "redis";
import { roomChannel, RoomRealtimeHub } from "../src/server/room-realtime-core";

const exec = promisify(execFile);
const url = process.env.ROOM_REDIS_TEST_URL;
test(
  "a separate Node process publishes UUID wake-ups to all live room listeners",
  {
    skip: !url,
    timeout: 10_000,
  },
  async () => {
    const roomId = randomUUID();
    const otherRoomId = randomUUID();
    let publisher: ReturnType<typeof createClient> | undefined;
    let subscriber: ReturnType<typeof createClient> | undefined;
    const hub = new RoomRealtimeHub(() => {
      publisher = createClient({
        url: url!,
        disableOfflineQueue: true,
        commandsQueueMaxLength: 100,
        socket: { connectTimeout: 1_000, reconnectStrategy: false },
      });
      subscriber = publisher.duplicate();
      return { publisher, subscriber };
    });
    let first = 0,
      second = 0,
      other = 0;
    let delivered!: () => void;
    const received = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    const one = hub.subscribe(roomId, () => {
      first++;
      if (first === 1 && second === 1) delivered();
    });
    const two = hub.subscribe(roomId, () => {
      second++;
      if (first === 1 && second === 1) delivered();
    });
    const three = hub.subscribe(otherRoomId, () => other++);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.all([one.ready, two.ready, three.ready]);
      assert.equal(one.isReady(), true, "local Redis must acknowledge the subscription");
      assert.equal(two.isReady(), true);
      const childCode = [
        'import { createClient } from "redis";',
        "const client = createClient({url:process.env.ROOM_REDIS_TEST_URL,socket:{connectTimeout:1000,reconnectStrategy:false}});",
        'client.on("error", () => {});',
        "await client.connect();",
        "try { await client.publish(process.env.TEST_ROOM_CHANNEL, process.env.TEST_ROOM_ID); } finally { client.destroy(); }",
      ].join("\n");
      await exec(process.execPath, ["--input-type=module", "-e", childCode], {
        cwd: process.cwd(),
        timeout: 5_000,
        env: {
          ...process.env,
          TEST_ROOM_CHANNEL: roomChannel(roomId),
          TEST_ROOM_ID: roomId,
        },
      });
      await Promise.race([
        received,
        new Promise<void>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("cross-process room delivery timed out")),
            2_000,
          );
        }),
      ]);
      assert.deepEqual([first, second, other], [1, 1, 0]);
      one.unsubscribe();
      two.unsubscribe();
      three.unsubscribe();
      // Exact-channel Redis subscriptions are removed after the final local listener leaves.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      assert.equal(
        publisher?.isOpen,
        false,
        "a subscriber-only process does not connect its publisher",
      );
      assert.equal(subscriber?.isReady, true);
      const inspector = createClient({ url: url!, socket: { reconnectStrategy: false } });
      inspector.on("error", () => {});
      await inspector.connect();
      try {
        const counts = await inspector.pubSubNumSub(roomChannel(roomId));
        assert.equal(counts[roomChannel(roomId)], 0);
      } finally {
        inspector.destroy();
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      one.unsubscribe();
      two.unsubscribe();
      three.unsubscribe();
      hub.close();
    }
  },
);
