import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseWakeTransport } from "./supabase-room-realtime-core";

export function supabaseWakeTransport(config: {
  url: string;
  secretKey: string;
}): SupabaseWakeTransport {
  const client = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { timeout: 5_000, params: { eventsPerSecond: 10 } },
  });
  return {
    subscribe(topic, receive, status) {
      const channel = client
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: "wake" }, (event) => receive(event.payload))
        .subscribe((value) => status(value === "SUBSCRIBED"));
      return async () => {
        await client.removeChannel(channel);
      };
    },
    async publish(topic, roomId, signal) {
      const response = await fetch(
        `${config.url}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/wake?private=true`,
        {
          method: "POST",
          headers: { apikey: config.secretKey, "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
          signal,
          cache: "no-store",
          redirect: "error",
        },
      );
      if (!response.ok) throw new Error("Announcement wake delivery unavailable.");
      await response.body?.cancel();
    },
    async close() {
      await client.removeAllChannels();
      client.realtime.disconnect();
    },
  };
}
