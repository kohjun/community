import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { ImageStorageBackend } from "../domain/image-storage";
import { imageStorageConfiguration } from "./image-storage-config";
import {
  localImageObjectStore,
  supabaseImageObjectStore,
  type ImageObjectStore,
} from "./image-storage-core";
/** Credentials never cross this server-only boundary or appear in image DTOs. */
export function imageObjectStore(backend?: ImageStorageBackend): ImageObjectStore {
  const config = imageStorageConfiguration(backend);
  if (config.backend === "local") return localImageObjectStore();
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
  return supabaseImageObjectStore(client.storage, config.bucket);
}
