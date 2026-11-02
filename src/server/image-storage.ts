import { cachedImageObjectStore } from "./image-object-cache";
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { ImageStorageBackend } from "../domain/image-storage";
import { imageStorageConfiguration } from "./image-storage-config";
import { supabaseObjectRangeReader } from "./object-range-stream";
import {
  localImageObjectStore,
  supabaseImageObjectStore,
  type ImageObjectStore,
} from "./image-storage-core";
/** Credentials never cross this server-only boundary or appear in image DTOs. */
export function imageObjectStore(backend?: ImageStorageBackend): ImageObjectStore {
  const config = imageStorageConfiguration(backend);
  if (config.backend === "local")
    return cachedImageObjectStore(localImageObjectStore(), process.cwd());
  const client = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          redirect: "error",
          signal: init?.signal ?? AbortSignal.timeout(15000),
        }),
    },
  });
  return cachedImageObjectStore(
    supabaseImageObjectStore(client.storage, config.bucket, supabaseObjectRangeReader(config)),
    config.url + "/" + config.bucket,
  );
}
