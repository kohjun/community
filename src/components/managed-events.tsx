"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Settings2 } from "lucide-react";
import type { ManagedEvent } from "@/domain/participation";
import type { AftercarePage } from "@/domain/event-aftercare";
import { participationRequest } from "@/lib/participation-client";
import { ParticipationShell } from "./participation-shell";
import { EventAftercare } from "./event-aftercare";
type Page = { items: ManagedEvent[]; nextCursor: string | null };
export function ManagedEvents({
  initial,
  initialAftercare,
}: {
  initial: Page;
  initialAftercare: AftercarePage;
}) {
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function more() {
    if (busy || !data.nextCursor) return;
    setBusy(true);
    try {
      const next = await participationRequest<Page>(
        `/management?cursor=${encodeURIComponent(data.nextCursor)}`,
      );
      setData((prev) => ({ ...next, items: [...prev.items, ...next.items] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ParticipationShell>
      <div className="participation-workspace participation-managed">
        <header className="participation-heading">
          <span>MY EVENT DESK</span>
          <h1>내 행사 관리</h1>
          <p>등록하거나 담당자로 참여하는 행사의 참가 현황을 한눈에 확인하세요.</p>
        </header>
        <EventAftercare initial={initialAftercare} scope="hosting" />
        {error && (
          <p className="participation-error" role="alert">
            {error}
          </p>
        )}
        <div className="managed-event-grid">
          {data.items.map((event) => (
            <Link
              className="participation-card managed-event-card"
              href={`/management/events/${event.postId}`}
              key={event.postId}
            >
              <div>
                <span className="participation-status">
                  {event.external ? "외부 신청" : "슬리퍼 신청"}
                </span>
                <span className="participation-muted">
                  {event.configured ? (event.open ? "접수 중" : "접수 마감") : "설정 필요"}
                </span>
              </div>
              <h2>{event.title}</h2>
              {(event.completedAt ||
                (event.endsAt && new Date(event.endsAt).getTime() <= Date.now())) && (
                <span className="record-status">
                  {event.recordStatus === "published"
                    ? "발행 완료"
                    : event.recordStatus === "withdrawn"
                      ? "공개 철회"
                      : event.completedAt
                        ? "기록 작성 중"
                        : "완료 확인 필요"}
                </span>
              )}
              <div className="managed-event-stats">
                <span>
                  확정
                  <strong>
                    {event.confirmed}
                    {event.capacity ? <small> / {event.capacity}</small> : null}
                  </strong>
                </span>
                <span>
                  승인 대기<strong>{event.pendingApproval}</strong>
                </span>
                <span>
                  확인 필요<strong>{event.review}</strong>
                </span>
              </div>
              <footer>
                <Settings2 size={16} />
                행사 대시보드
                <ArrowRight size={17} />
              </footer>
            </Link>
          ))}
        </div>
        {!data.items.length && (
          <section className="participation-card participation-empty">
            <Settings2 size={30} />
            <h2>아직 관리하는 행사가 없어요</h2>
            <p>모집글을 등록하거나 행사 담당자로 지정되면 여기에 표시됩니다.</p>
            <Link className="participation-primary" href="/">
              모집글 등록하러 가기
            </Link>
          </section>
        )}
        {data.nextCursor && (
          <button
            className="participation-secondary"
            disabled={busy}
            onClick={() => {
              void more();
            }}
          >
            이전 행사 더 보기
          </button>
        )}
      </div>
    </ParticipationShell>
  );
}
