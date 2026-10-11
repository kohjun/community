export const IMAGE_STORAGE_BACKENDS = ["local", "supabase"] as const;
export type ImageStorageBackend = (typeof IMAGE_STORAGE_BACKENDS)[number];
export type ImageStorageKind = "post" | "profile" | "video";
export interface StoredImageObject {
  objectKey: string;
  storageBackend: ImageStorageBackend;
}
const uuidFile =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|gif)$/;
export function isImageStorageKey(kind: ImageStorageKind, value: string): boolean {
  if (kind === "video")
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/.test(value);
  return (
    typeof value === "string" &&
    value.length <= 41 + 1 &&
    uuidFile.test(value) &&
    (kind === "post" || value.endsWith(".webp"))
  );
}
export function imageStorageBackend(value: unknown): ImageStorageBackend {
  if (value !== "local" && value !== "supabase") throw new Error("Invalid image storage backend.");
  return value;
}
