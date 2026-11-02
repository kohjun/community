import { config as loadEnvironment } from "dotenv";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { assertCloudDatabase } from "../src/server/cloud-runtime-config";
import { imageStorageConfiguration } from "../src/server/image-storage-config";
import { roomRealtimeConfiguration } from "../src/server/room-realtime-config";
import { SupabaseRoomRealtimeHub } from "../src/server/supabase-room-realtime-core";
import { supabaseWakeTransport } from "../src/server/supabase-room-realtime";

loadEnvironment({ path: [".env.local", ".env"], quiet: true });
const args = process.argv.slice(2);
if (args.some((value) => !["--verify-realtime", "--verify-storage"].includes(value)))
  throw new Error("Usage: npm run cloud:check -- [--verify-realtime] [--verify-storage]");
async function waitFor(check: () => boolean, ms = 8_000) {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until) await delay(50);
  if (!check()) throw new Error("Cloud verification did not complete within its budget.");
}
async function run() {
  if (process.env.SLIPER_CLOUD_ONLY !== "true") throw new Error("Enable SLIPER_CLOUD_ONLY first.");
  const databaseUrl = process.env.DATABASE_URL ?? "";
  assertCloudDatabase(databaseUrl);
  const storage = imageStorageConfiguration();
  const realtime = roomRealtimeConfiguration();
  if (storage.backend !== "supabase" || realtime.provider !== "supabase")
    throw new Error("Supabase storage and realtime are required.");
  const sql = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 8 });
  try {
    const [inventory] = await sql.unsafe(`select
      (select count(*)::int from sliper.profiles) as members,
      (select count(*)::int from sliper.media_assets where storage_backend='local') as local_images,
      (select count(*)::int from sliper.profile_photos where storage_backend='local') as local_profile_photos,
      (select count(*)::int from sliper.video_assets where storage_backend='local') as local_videos,
      (select count(*)::int from sliper.video_processing_jobs where source_storage_backend='local' and source_removed_at is null) as local_video_sources`);
    console.log(JSON.stringify({ database: "connected", inventory }));
    if (
      !inventory ||
      [
        inventory.local_images,
        inventory.local_profile_photos,
        inventory.local_videos,
        inventory.local_video_sources,
      ].some((count) => Number(count) > 0)
    )
      throw new Error("Referenced local media requires a migration before cloud-only operation.");
  } finally {
    await sql.end({ timeout: 2 });
  }
  const client = createClient(storage.url, storage.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(8_000),
        }),
    },
  });
  const bucket = await client.storage.getBucket(storage.bucket);
  if (bucket.error || !bucket.data || bucket.data.public)
    throw new Error("A private storage bucket is required.");
  console.log(JSON.stringify({ storage: "private-bucket-verified" }));
  if (args.includes("--verify-storage")) {
    const object = `checks/${randomUUID()}.bin`;
    const bytes = Uint8Array.from([83, 76, 73, 80, 69, 82]);
    let uploaded = false;
    try {
      const write = await client.storage
        .from(storage.bucket)
        .upload(object, bytes, { contentType: "application/octet-stream", upsert: false });
      if (write.error) throw new Error("Storage probe upload failed.");
      uploaded = true;
      const read = await client.storage.from(storage.bucket).download(object);
      if (
        read.error ||
        !read.data ||
        Buffer.compare(Buffer.from(await read.data.arrayBuffer()), Buffer.from(bytes))
      )
        throw new Error("Storage probe read failed.");
    } finally {
      if (uploaded) {
        const cleanup = await client.storage.from(storage.bucket).remove([object]);
        if (cleanup.error) throw new Error("Storage probe cleanup needs attention.");
      }
    }
    console.log(JSON.stringify({ storageRoundTrip: "upload-read-delete-passed" }));
  }
  if (args.includes("--verify-realtime")) {
    const first = new SupabaseRoomRealtimeHub(() => supabaseWakeTransport(realtime));
    const second = new SupabaseRoomRealtimeHub(() => supabaseWakeTransport(realtime));
    const topicId = randomUUID();
    let a = 0,
      b = 0;
    const x = first.subscribe(topicId, () => {
      a++;
    });
    const y = second.subscribe(topicId, () => {
      b++;
    });
    const browser = createClient(
      realtime.url,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { timeout: 5_000 },
      },
    );
    try {
      await waitFor(() => x.isReady() && y.isReady());
      await first.publish(topicId);
      await waitFor(() => a > 0 && b > 0);
      const channel = browser.channel(`sliper:room:${topicId}`, { config: { private: true } });
      let status = "";
      channel.subscribe((value) => {
        status = value;
      });
      await waitFor(() => ["SUBSCRIBED", "CHANNEL_ERROR"].includes(status));
      if (status !== "CHANNEL_ERROR")
        throw new Error("Public clients must not join server-only private channels.");
      console.log(
        JSON.stringify({
          realtime: "two-independent-server-clients-passed",
          anonymousPrivateJoin: "denied",
        }),
      );
    } finally {
      x.unsubscribe();
      y.unsubscribe();
      await Promise.all([first.close(), second.close(), browser.removeAllChannels()]);
      browser.realtime.disconnect();
    }
  }
}
try {
  await run();
} catch {
  console.error(
    "Cloud verification failed. Check server configuration, cloud service access and outstanding local media; no credentials or user content were logged.",
  );
  process.exitCode = 1;
}
