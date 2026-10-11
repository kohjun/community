import type { ImageStorageBackend } from "../domain/image-storage";
import { safeExternalLink } from "../domain/post-document";
export type ImageStorageConfiguration =
  { backend: "local" } | { backend: "supabase"; url: string; secretKey: string; bucket: string };
export class ImageStorageConfigurationError extends Error {
  constructor() {
    super("Image storage server configuration is invalid.");
  }
}
export function imageStorageConfiguration(
  backend?: ImageStorageBackend,
  env: Record<string, string | undefined> = process.env,
): ImageStorageConfiguration {
  const selected = backend ?? env.MEDIA_STORAGE_BACKEND ?? "local";
  if (selected === "local") return { backend: "local" };
  if (selected !== "supabase") throw new ImageStorageConfigurationError();
  const rawUrl = env.SUPABASE_STORAGE_URL ?? "";
  const key = env.SUPABASE_STORAGE_SECRET_KEY?.trim() ?? "";
  const bucket = env.SUPABASE_STORAGE_BUCKET ?? "";
  try {
    const url = new URL(rawUrl);
    let serviceKey = key.startsWith("sb_secret_") && key.length >= 32 && !/\s/.test(key);
    if (key.startsWith("eyJ")) {
      const parts = key.split(".");
      serviceKey =
        parts.length === 3 &&
        JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")).role ===
          "service_role";
    }
    if (
      !safeExternalLink(rawUrl) ||
      url.protocol !== "https:" ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !serviceKey ||
      !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket)
    )
      throw new Error();
    return { backend: "supabase", url: url.origin, secretKey: key, bucket };
  } catch {
    throw new ImageStorageConfigurationError();
  }
}
