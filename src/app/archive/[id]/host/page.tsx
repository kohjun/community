import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AppError } from "@/server/errors";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { libraryService } from "@/server/library-service";
import { TemplateHost } from "@/components/template-host";
import { ParticipationLogin, ParticipationShell } from "@/components/participation-shell";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  try {
    const { id } = await params,
      template = await libraryService(getDatabase()).detail(actor, id);
    if (!template.canHost)
      return (
        <ParticipationShell>
          <section className="participation-card participation-empty">
            <h1>자료 이용 권한이 필요해요</h1>
            <p>외부 구매 확인 후 이 자료로 모임을 개설할 수 있어요.</p>
            <Link className="participation-primary" href={`/archive/${id}`}>
              자료 확인하기
            </Link>
          </section>
        </ParticipationShell>
      );
    return <TemplateHost key={id} template={template} />;
  } catch (error) {
    if (error instanceof ZodError || (error instanceof AppError && error.code === "NOT_FOUND"))
      notFound();
    throw error;
  }
}
