import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { crewService } from "@/server/crew-service";
import { AppError } from "@/server/errors";
import { uuidSchema } from "@/domain/validation";
import { CrewDetailView } from "@/components/crew-detail";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "우리 크루 — Sliper",
  description: "크루 소개와 구성원, 함께 진행한 행사와 활동 기록을 확인해보세요.",
};
export default async function Page({ params }: { params: Promise<{ crewId: string }> }) {
  const { crewId } = await params,
    parsed = uuidSchema.safeParse(crewId);
  if (!parsed.success) notFound();
  const actor = await currentActor();
  try {
    const crew = await crewService(getDatabase()).detail(actor, parsed.data);
    return <CrewDetailView key={crew.id} initial={crew} canWrite={!!actor} />;
  } catch (cause) {
    if (cause instanceof AppError && cause.code === "NOT_FOUND") notFound();
    throw cause;
  }
}
