import Link from "next/link";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { safetyService } from "@/server/safety-service";
import { operationsService } from "@/server/operations-service";
import { operationsQuerySchema } from "@/domain/operations";
import { OperationsCenter } from "@/components/operations-center";
import { ParticipationShell } from "@/components/participation-shell";
import { AppError } from "@/server/errors";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor(),
    database = getDatabase();
  const denied = (
    <ParticipationShell advertising={false}>
      <section className="safety-page safety-card">
        <h1>운영자 전용 공간</h1>
        <p>운영 권한이 있는 계정으로 로그인해주세요.</p>
        <Link href="/login?returnTo=/admin/operations">로그인</Link>
      </section>
    </ParticipationShell>
  );
  if (!(await safetyService(database).role(actor))) return denied;
  const params = await searchParams;
  const parsed = operationsQuerySchema.safeParse({
    ...(typeof params.kind === "string" ? { kind: params.kind } : {}),
    ...(typeof params.stage === "string" ? { stage: params.stage } : {}),
    ...(typeof params.assignment === "string" ? { assignment: params.assignment } : {}),
    ...(typeof params.page === "string" ? { page: params.page } : {}),
  });
  const query = parsed.success ? parsed.data : operationsQuerySchema.parse({});
  try {
    const initial = await operationsService(database).list(actor, query);
    return <OperationsCenter initial={initial} initialQuery={{ ...query, page: initial.page }} />;
  } catch (error) {
    if (error instanceof AppError && ["FORBIDDEN", "UNAUTHENTICATED"].includes(error.code))
      return denied;
    throw error;
  }
}
