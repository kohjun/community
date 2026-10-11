import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
export default function NotFound() {
  return (
    <ParticipationShell>
      <section className="crew-panel crew-empty">
        <h1>크루를 찾을 수 없어요.</h1>
        <p>삭제되거나 접근할 수 없는 크루입니다.</p>
        <Link className="participation-primary" href="/players?tab=crews">
          다른 크루 둘러보기
        </Link>
      </section>
    </ParticipationShell>
  );
}
