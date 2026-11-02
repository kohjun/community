import Link from "next/link";
import { Plus } from "lucide-react";
import type { LibraryKind } from "@/domain/library";
export function ArchiveHeading({
  canWrite = false,
  kind,
}: {
  canWrite?: boolean;
  kind?: LibraryKind | "";
}) {
  return (
    <section className="marketplace-hero">
      <div>
        <span className="marketplace-kicker">SLIPER PLAY ARCHIVE</span>
        <h1>아카이브</h1>
        <p>
          함께 놀 방법과 실제로 함께한 경험을 한곳에. 룰북·이벤트 템플릿과 완료된 행사의 기록을
          만나보세요.
        </p>
      </div>
      {canWrite && (
        <Link
          href={kind === "template" ? "/archive/new?kind=template" : "/archive/new"}
          className="participation-primary"
        >
          <Plus size={17} />
          자료 올리기
        </Link>
      )}
    </section>
  );
}
