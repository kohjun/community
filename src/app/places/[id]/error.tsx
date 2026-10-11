"use client";
import Link from "next/link";
import { ParticipationShell } from "@/components/participation-shell";
export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ParticipationShell>
      <section className="record-page record-empty">
        <h1>장소 기록을 불러오지 못했어요</h1>
        <p role="alert">잠시 후 다시 시도해주세요.</p>
        <div className="record-actions">
          <button type="button" className="participation-primary" onClick={() => retry()}>
            다시 불러오기
          </button>
          <Link className="participation-secondary" href="/map">
            이벤트 맵으로 돌아가기
          </Link>
        </div>
      </section>
    </ParticipationShell>
  );
}
