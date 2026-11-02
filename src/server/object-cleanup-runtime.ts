import { createClient } from "@supabase/supabase-js";
import { imageStorageConfiguration } from "./image-storage-config";
import { localImageObjectStore, supabaseImageObjectStore } from "./image-storage-core";
import type { CleanupObject } from "./object-cleanup-service";
/** Worker entry point, with no Next server-only import and no public/signed object URLs. */
export async function removeCleanupObject(object: CleanupObject) {
  const config = imageStorageConfiguration(object.storageBackend);
  if (config.backend === "local")
    return localImageObjectStore().remove(object.kind, object.objectKey);
  const client = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        }),
    },
  });
  await supabaseImageObjectStore(client.storage, config.bucket).remove(
    object.kind,
    object.objectKey,
  );
}
