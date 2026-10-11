import type { Metadata } from "next";
import Link from "next/link";
import { getDatabase } from "@/db/client";
import { currentActor } from "@/server/identity";
import { playerService } from "@/server/player-service";
import { crewService } from "@/server/crew-service";
import { playerDirectorySchema } from "@/domain/player";
import { crewListSchema } from "@/domain/crew";
import { PlayerDirectory } from "@/components/player-directory";
import { CrewDirectory } from "@/components/crew-directory";
import { PeopleDirectory } from "@/components/people-directory";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "플레이어·크루 — Sliper",
  description: "함께 놀 플레이어와 다음 이벤트를 만들 크루를 한곳에서 찾아보세요.",
};
type Query = Record<string, string | string[] | undefined>;
export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const actor = await currentActor(),
    search = await searchParams;
  const single = (key: string) => (typeof search[key] === "string" ? search[key] : undefined);
  if (single("tab") === "crews") {
    const parsed = crewListSchema.safeParse({
      q: single("q") ?? "",
      ...(single("category") ? { category: single("category") } : {}),
      mine: actor && single("mine") === "1" ? "1" : "0",
      page: single("page") ?? "1",
    });
    const query = parsed.success ? parsed.data : crewListSchema.parse({});
    return (
      <PeopleDirectory tab="crews">
        <CrewDirectory
          key={JSON.stringify(query)}
          embedded
          initial={await crewService(getDatabase()).list(actor, query)}
          canWrite={!!actor}
          initialQuery={{ q: query.q, category: query.category ?? "", mine: query.mine === "1" }}
        />
      </PeopleDirectory>
    );
  }
  if (!actor)
    return (
      <PeopleDirectory tab="players">
        <section className="participation-card participation-empty">
          <h2>로그인하고 플레이어를 만나보세요</h2>
          <p>플레이어의 성향과 공개한 참가 경험을 확인할 수 있어요.</p>
          <Link className="participation-primary" href="/login?next=%2Fplayers">
            로그인하기
          </Link>
        </section>
      </PeopleDirectory>
    );
  const parsed = playerDirectorySchema.safeParse({
    ...(single("role") ? { role: single("role") } : {}),
    ...(single("region") ? { region: single("region") } : {}),
  });
  const query = parsed.success ? parsed.data : playerDirectorySchema.parse({});
  return (
    <PeopleDirectory tab="players">
      <PlayerDirectory
        key={JSON.stringify(query)}
        embedded
        initial={await playerService(getDatabase()).directory(actor, query)}
        initialQuery={{ role: query.role ?? "", region: query.region ?? "" }}
      />
    </PeopleDirectory>
  );
}
