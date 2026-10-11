"use client";
import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <ParticipationShell>
      <section className="crew-panel crew-empty">
        <h1>크루를 불러오지 못했어요.</h1>
        <p>잠시 후 다시 확인해주세요.</p>
        <div className="crew-form-actions">
          <Link className="participation-secondary" href="/players?tab=crews">
            크루 목록
          </Link>
          <button className="participation-primary" onClick={retry}>
            다시 불러오기
          </button>
        </div>
      </section>
    </ParticipationShell>
  );
}
