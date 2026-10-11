"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Megaphone, Ticket } from "lucide-react";
import type { ParticipationHome } from "@/domain/participation";
import { STATUS_LABELS } from "@/domain/participation";
import { participationRequest } from "@/lib/participation-client";
import { ParticipationShell } from "./participation-shell";
import { EventNotices } from "./event-notices";
export function ParticipationDashboard({ initial }: { initial: ParticipationHome }) {
  const [home, setHome] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function more() {
    if (busy || !home.nextCursor) return;
    setBusy(true);
    setError("");
    try {
      const next = await participationRequest<ParticipationHome>(
        `/me?cursor=${encodeURIComponent(home.nextCursor)}`,
      );
      setHome((prev) => ({ ...next, applications: [...prev.applications, ...next.applications] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ParticipationShell>
      <div className="participation-workspace participation-overview">
        <header className="participation-heading">
          <span>MY EPISODES</span>
          <h1>신청과 공지방</h1>
          <p>함께할 모임부터 꼭 알아야 할 안내까지, 한곳에서.</p>
        </header>
        <EventNotices />
        <section>
          <h2 className="participation-section-title">
            <Megaphone size={21} />
            나의 전용 공지방
          </h2>
          <div className="room-grid">
            {home.rooms.map((room) => (
              <Link
                key={room.postId}
                className="participation-card room-preview"
                href={`/rooms/${room.postId}`}
              >
                <span className="room-preview-icon">
                  <Megaphone size={24} />
                </span>
                <div>
                  <span>{room.role === "manager" ? "담당자" : "참가자 · 읽기 전용"}</span>
                  <h3>{room.title}</h3>
                  <p>행사 준비물과 일정 안내 확인하기</p>
                </div>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
          {!home.rooms.length && (
            <p className="participation-card participation-muted">
              참가가 확정되면 행사 전용 공지방이 여기에 나타나요.
            </p>
          )}
        </section>
        <section>
          <h2 className="participation-section-title">
            <Ticket size={21} />
            참가 신청 내역
          </h2>
          <div className="application-list">
            {home.applications.map((app) => (
              <Link
                key={app.id}
                className="participation-card application-list-row"
                href={`/events/${app.postId}`}
              >
                <div className="application-list-info">
                  <div className="application-list-copy">
                    <h3>{app.title}</h3>
                    <small>
                      {new Date(app.createdAt).toLocaleDateString("ko-KR")} ·{" "}
                      {app.amountKRW === 0 ? "무료" : `${app.amountKRW.toLocaleString("ko-KR")}원`}
                    </small>
                  </div>
                  <span className={`participation-status ${app.status}`}>
                    {STATUS_LABELS[app.status]}
                  </span>
                </div>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
          {!home.applications.length && (
            <p className="participation-card participation-muted">
              아직 신청한 모임이 없어요. 모집글에서 다음 에피소드를 찾아보세요.
            </p>
          )}
          {error && (
            <p role="alert" className="participation-error">
              {error}
            </p>
          )}
          {home.nextCursor && (
            <button
              disabled={busy}
              className="participation-secondary"
              onClick={() => {
                void more();
              }}
            >
              이전 신청 더 보기
            </button>
          )}
        </section>
      </div>
    </ParticipationShell>
  );
}
