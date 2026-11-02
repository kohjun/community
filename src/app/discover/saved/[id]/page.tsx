import Link from "next/link";
import { currentActor } from "@/server/identity";
import { getDatabase } from "@/db/client";
import { savedSearchService } from "@/server/saved-search-service";
import { ParticipationShell, ParticipationLogin } from "@/components/participation-shell";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) return <ParticipationLogin />;
  const { id } = await params,
    page = Number((await searchParams).page ?? 1),
    result = await savedSearchService(getDatabase()).matches(actor, id, page);
  return (
    <ParticipationShell>
      <h1>저장한 조건에 맞는 모임</h1>
      <Link href="/discover/saved">저장 조건 관리</Link>
      <div className="growth-list">
        {result.items.map((p) => (
          <article key={p.id} className="maturity-panel">
            <h2>
              <Link href={"/events/" + p.id}>{p.title}</Link>
            </h2>
            <p>
              {p.location} ·{" "}
              {new Date(p.starts_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
            </p>
            <p>사전 참가비 {p.amount.toLocaleString()}원 · 현장 비용은 참가 안내 확인</p>
          </article>
        ))}
      </div>
      {!result.items.length && <p>현재 조건에 맞는 모집이 없어요.</p>}
      <nav className="maturity-actions">
        {page > 1 && <Link href={"?page=" + (page - 1)}>이전</Link>}
        <span>{page}페이지</span>
        {result.hasMore && <Link href={"?page=" + (page + 1)}>다음</Link>}
      </nav>
    </ParticipationShell>
  );
}
