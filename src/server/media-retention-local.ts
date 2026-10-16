import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { RetentionAssetKind } from "../domain/media-retention";
import { AppError } from "./errors";
/** A local cleanup must never traverse a symlinked storage folder outside its workspace. */
export async function verifyLocalRetentionPath(
  kind: RetentionAssetKind,
  key: string,
  workspace = process.cwd(),
) {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (
    !new RegExp("^" + uuid + (kind === "video" ? "[.]mp4$" : "[.](jpg|jpeg|png|webp|gif)$")).test(
      key,
    )
  )
    throw new AppError("VALIDATION", "정리 파일 식별자를 확인해주세요.");
  const base = await realpath(workspace),
    folder = path.resolve(base, ".local", kind === "video" ? "videos" : "uploads");
  let actual: string;
  try {
    actual = await realpath(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (
    actual.toLowerCase() !== folder.toLowerCase() ||
    !actual.toLowerCase().startsWith(base.toLowerCase() + path.sep)
  )
    throw new AppError("FORBIDDEN", "정리 저장소 경로를 확인해주세요.");
  const target = path.resolve(actual, key);
  try {
    if ((await lstat(target)).isSymbolicLink())
      throw new AppError("FORBIDDEN", "연결된 파일은 정리할 수 없어요.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
