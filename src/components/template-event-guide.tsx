import Link from "next/link";
import type { TemplateSnapshot } from "@/domain/library";
import { RecordBacklink } from "./record-discovery";
import { ParticipationShell } from "./participation-shell";
import { LibraryPlaybook } from "./library-playbook";
import { LibraryUsageTerms } from "./library-version-panel";
export function TemplateEventGuide({ postId, guide }: { postId: string; guide: TemplateSnapshot }) {
  return (
    <ParticipationShell>
      <div className="marketplace-heading">
        <div>
          <span className="marketplace-kicker">HOST PLAYBOOK</span>
          <h1>행사 진행 가이드</h1>
          <p>
            {guide.title} · 원저작자 {guide.author} ·{" "}
            {guide.versionNumber ? `v${guide.versionNumber}` : "이전 자료 사본 · 버전 미확인"}
          </p>
          <small>
            개설 시점에 보존한 자료예요. 원본 수정·삭제와 관계없이 이 행사에서 사용할 수 있어요.
          </small>
        </div>
        <Link className="participation-secondary" href={`/management/events/${postId}`}>
          행사 관리
        </Link>
      </div>
      <section className="marketplace-section">
        <h2>개설 당시 이용 조건</h2>
        {guide.usageTerms ? (
          <LibraryUsageTerms
            usageTerms={guide.usageTerms}
            allowDerivatives={guide.allowDerivatives ?? false}
            allowCommercialUse={guide.allowCommercialUse ?? false}
          />
        ) : (
          <p>
            버전 관리 도입 전의 행사입니다. 보존된 진행 가이드와 원작성자의 안내를 확인해주세요.
          </p>
        )}
        <Link
          className="library-source-link"
          href={`/archive/${guide.sourceId}${guide.versionNumber ? "?version=" + guide.versionNumber : ""}`}
        >
          개설에 사용한 원본 자료 확인
        </Link>
        <p>
          이 행사는 개설 당시의 버전과 이용 조건을 사용합니다. 원본의 다음 버전은 자동으로 적용되지
          않아요.
        </p>
      </section>
      <RecordBacklink postId={postId} />
      <LibraryPlaybook payload={guide} summary={guide.summary} />
    </ParticipationShell>
  );
}
