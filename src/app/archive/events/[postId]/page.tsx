import Link from "next/link";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { libraryService } from "@/server/library-service";
import { AppError } from "@/server/errors";
import { TemplateEventGuide } from "@/components/template-event-guide";
import { ParticipationLogin, ParticipationShell } from "@/components/participation-shell";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ postId: string }> }) {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  const { postId } = await params;
  try {
    const guide = await libraryService(getDatabase()).eventTemplate(actor, postId);
    if (guide) return <TemplateEventGuide postId={postId} guide={guide} />;
    return (
      <ParticipationShell>
        <section className="participation-card participation-empty">
          <h1>템플릿 진행 가이드가 없어요</h1>
          <p>이 행사는 템플릿을 이용해 개설한 행사가 아니에요.</p>
          <Link className="participation-secondary" href={`/management/events/${postId}`}>
            행사 관리로
          </Link>
        </section>
      </ParticipationShell>
    );
  } catch (e) {
    if (e instanceof AppError && ["FORBIDDEN", "NOT_FOUND"].includes(e.code))
      return (
        <ParticipationShell>
          <section className="participation-card participation-empty">
            <h1>진행 가이드를 확인할 수 없어요</h1>
            <p>{e.message}</p>
            <Link className="participation-secondary" href="/management">
              내 행사 관리
            </Link>
          </section>
        </ParticipationShell>
      );
    throw e;
  }
}
