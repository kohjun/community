import type { Metadata } from "next";
import { currentActor } from "@/server/identity";
import { CrewCreateForm } from "@/components/crew-create-form";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "새 크루 만들기 — Sliper" };
export default async function Page() {
  return <CrewCreateForm canWrite={!!(await currentActor())} />;
}
