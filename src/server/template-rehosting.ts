import type { Database } from "../db/connection";
import type { LibraryDetail } from "../domain/library";
import type { TemplateHostOrigin } from "../domain/template-rehosting";
import { uuidSchema } from "../domain/validation";
import { AppError } from "./errors";
import { recordService } from "./record-service";

/** A record link never grants library access or copies the old event's private assets. */
export async function templateRehostingOrigin(
  db: Database,
  actor: string | null,
  template: LibraryDetail,
  rawPostId: string,
): Promise<TemplateHostOrigin> {
  const postId = uuidSchema.parse(rawPostId);
  if (!template.canHost) throw new AppError("FORBIDDEN", "자료 이용 권한을 먼저 확인해주세요.");
  const record = await recordService(db).detail(actor, postId);
  if (record.snapshot.template?.id !== template.id && template.sourceRecordPostId !== postId)
    throw new AppError("NOT_FOUND", "이 자료와 연결된 행사 기록을 찾을 수 없어요.");
  return {
    postId: record.postId,
    title: record.title,
    location: record.location === "장소 정보 비공개" ? "" : record.location,
    completedAt: record.completedAt,
    previousTemplateVersion:
      record.snapshot.template?.id === template.id
        ? (record.snapshot.template.versionNumber ?? null)
        : null,
  };
}
