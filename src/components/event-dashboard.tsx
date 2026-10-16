"use client";
import Link from "next/link";
import { EventLocationField } from "./event-location-field";
import type { VenuePoint } from "@/domain/discovery";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Megaphone,
  RefreshCw,
  Search,
  Users,
  ShieldCheck,
  Settings2,
  Check,
  X,
} from "lucide-react";
import {
  STATUS_LABELS,
  eventConfigSchema,
  type EventDashboard,
  type ApplicationView,
} from "@/domain/participation";
import { EventPrivateContact } from "./event-private-contact";
import { EventQuestionEditor } from "./event-question-editor";
import { SubmittedApplicationDetails } from "./application-question-fields";
import { participationRequest as request } from "@/lib/participation-client";
import { RequestError } from "@/lib/api-client";
import { RequestSequence } from "@/lib/request-sequence";
import { RefundPanel } from "./refund-panel";
import { EventCompletionPanel } from "./record-discovery";
import { EventCreditManager } from "./event-credits";
import { PlayerRecordManager } from "./player-record-manager";
import { koreanDateTimeInput, koreanDateTimeISO, formatKoreanDate } from "@/domain/refund";
import { ParticipationShell } from "./participation-shell";
import { EventLifecyclePanel } from "./event-lifecycle-panel";
type Decision = "approve" | "reject" | "refund";
export function EventManagementDashboard({ initial }: { initial: EventDashboard }) {
  const [data, setData] = useState<EventDashboard | null>(initial),
    [status, setStatus] = useState("all"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selection, setSelection] = useState<{ app: ApplicationView; decision: Decision } | null>(null),
    [checked, setChecked] = useState(false),
    [reason, setReason] = useState("");
  const [settings, setSettings] = useState({
    amountKRW: initial.event.config?.amountKRW ?? 0,
    capacity: initial.event.config?.capacity ?? 20,
    open: initial.event.config?.open ?? true,
    approvalMode: initial.event.config?.approvalMode ?? "manual",
    questions: initial.event.config?.questions ?? [],
    startsAt: koreanDateTimeInput(initial.event.config?.startsAt),
    endsAt: koreanDateTimeInput(initial.event.config?.endsAt),
  });
  const [venue, setVenue] = useState<VenuePoint | null>(initial.event.config?.venue ?? null);
  const [venueChanged, setVenueChanged] = useState(false);
  const [cancelled, setCancelled] = useState(!!initial.event.config?.cancelledAt);
  const [lifecycleRevision, setLifecycleRevision] = useState(
    initial.event.config?.lifecycleRevision ?? 0,
  );
  const sequence = useRef(new RequestSequence()),
    gate = useRef(false),
    hasOlder = useRef(false),
    postId = initial.event.postId;
  const base = `/events/${postId}/dashboard?status=${encodeURIComponent(status)}&search=${encodeURIComponent(query)}`;
  async function refresh(cursor?: string, summaryOnly = false) {
    const token = sequence.current.begin();
    try {
      const next = await request<EventDashboard>(
        base + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
      );
      if (sequence.current.isCurrent(token))
        setData((prev) =>
          summaryOnly && prev
            ? { ...prev, event: next.event, stats: next.stats }
            : cursor && prev
              ? { ...next, attendees: [...prev.attendees, ...next.attendees] }
              : next,
        );
    } catch (e) {
      if (
        e instanceof RequestError &&
        ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(e.code || "")
      ) {
        sequence.current.invalidate();
        setData(null);
        setSelection(null);
      }
      throw e;
    }
  }
  useEffect(() => {
    hasOlder.current = false;
    void refresh().catch((e) => setError(e instanceof Error ? e.message : "다시 시도해주세요."));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !gate.current)
        void refresh(undefined, hasOlder.current).catch(() => {});
    }, 15000);
    return () => {
      clearInterval(timer);
      sequence.current.invalidate();
    };
  }, [base]);
  async function work(fn: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    sequence.current.invalidate();
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 시도해주세요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  function decide(e: FormEvent) {
    e.preventDefault();
    if (!selection) return;
    void work(async () => {
      await request(`/applications/${selection.app.id}/decision`, "POST", {
        decision: selection.decision,
        paymentChecked: checked,
        reason,
      });
      setSelection(null);
      hasOlder.current = false;
      await refresh();
    });
  }
  function select(app: ApplicationView, decision: Decision) {
    setSelection({ app, decision });
    setChecked(false);
    setReason("");
    setError("");
  }
  function configure(e: FormEvent) {
    e.preventDefault();
    void work(async () => {
      const parsed = eventConfigSchema.safeParse({
        ...settings,
        venue: venueChanged ? venue : undefined,
        startsAt: koreanDateTimeISO(settings.startsAt),
        endsAt: koreanDateTimeISO(settings.endsAt),
      });
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message || "행사 설정과 참가 질문을 확인해주세요.");
      await request(`/events/${postId}/settings`, "PUT", parsed.data);
      setVenueChanged(false);
      hasOlder.current = false;
      await refresh();
    });
  }
  if (!data)
    return (
      <ParticipationShell>
        <p className="participation-error">관리 권한이 없어요.</p>
      </ParticipationShell>
    );
  const { event, stats } = data;
  return (
    <ParticipationShell>
      <div className="participation-workspace participation-dashboard">
        <header className="participation-heading dashboard-heading">
          <div>
            <span>EVENT CONTROL ROOM</span>
            <h1>{event.title}</h1>
            <p>
              {event.externalUrl
                ? "외부 신청·결제 확인과 참가 승인을 관리해요."
                : "참가 신청과 결제 확인 현황을 관리해요."}
            </p>
          </div>
          <Link className="participation-secondary" href="/management">
            <ArrowLeft size={15} />내 행사
          </Link>
        </header>
        <div className="dashboard-summary">
          {[
            { label: "참가 확정", count: stats.confirmed, tone: "blue" },
            { label: "승인 대기", count: stats.pendingApproval, tone: "blue-soft" },
            { label: "결제 대기", count: stats.pendingPayment, tone: "gray" },
            { label: "확인 필요", count: stats.review, tone: "blue-soft" },
            { label: "환불 완료", count: stats.refunded, tone: "gray" },
            { label: "전체 내역", count: stats.total, tone: "gray" },
          ].map((item) => (
            <div className={`participation-card dashboard-metric ${item.tone}`} key={item.label}>
              <small>{item.label}</small>
              <strong>
                {item.count}
                <span>{item.label === "전체 내역" ? "건" : "명"}</span>
              </strong>
            </div>
          ))}
        </div>
        <div className="dashboard-toolbar-links">
          {cancelled ? (
            <span className="participation-secondary" aria-disabled="true">
              QR 입장 종료
            </span>
          ) : (
            <Link
              href={`/management/events/${postId}/check-in`}
              className="participation-secondary"
            >
              QR 입장 확인
            </Link>
          )}
          <Link href={`/management/events/${postId}/payments`} className="participation-secondary">
            결제 예외 관리
          </Link>
          <Link href={`/events/${postId}`} className="participation-secondary">
            {event.externalUrl ? "참가 확인 화면" : "신청 화면"}
          </Link>
          {event.config && (
            <Link href={`/rooms/${postId}`} className="participation-primary">
              <Megaphone size={16} />
              공지방 · 담당자 관리
            </Link>
          )}
          <span className="participation-muted">
            {event.config
              ? `${event.config.occupied} / ${event.config.capacity}명 · ${event.config.open ? "접수 중" : "접수 마감"}`
              : "행사 설정을 저장해 참가 확인을 활성화하세요."}
          </span>
        </div>
        {error && (
          <p role="alert" className="participation-error">
            {error}
          </p>
        )}
        {event.config && (
          <EventLifecyclePanel
            postId={postId}
            onChanged={async (view) => {
              setCancelled(!!view.cancelledAt);
              setLifecycleRevision(view.revision);
              setSettings((previous) => ({
                ...previous,
                startsAt: koreanDateTimeInput(view.startsAt),
                endsAt: koreanDateTimeInput(view.endsAt),
                ...(view.cancelledAt ? { open: false } : {}),
              }));
              if (view.cancelledAt) setSelection(null);
              hasOlder.current = false;
              await refresh();
            }}
          />
        )}
        <div className="dashboard-layout">
          <section className="participation-card dashboard-attendees">
            <div className="dashboard-section-heading">
              <h2>
                <Users size={19} />
                참가 현황
              </h2>
              <button
                disabled={busy}
                className="participation-secondary"
                onClick={() => {
                  void work(async () => {
                    hasOlder.current = false;
                    await refresh();
                  });
                }}
              >
                <RefreshCw size={14} />
                새로고침
              </button>
            </div>
            <div className="dashboard-filters">
              <label>
                상태
                <select
                  value={status}
                  disabled={busy}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setSelection(null);
                    setError("");
                  }}
                >
                  <option value="all">전체 내역</option>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setQuery(search.trim());
                  setSelection(null);
                }}
              >
                <label>
                  닉네임 · 연락처 · 신청 번호
                  <input
                    maxLength={100}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="참가 내역 검색"
                  />
                </label>
                <button type="submit" className="participation-secondary" disabled={busy}>
                  <Search size={16} />
                  <span>검색</span>
                </button>
              </form>
            </div>
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>참가자</th>
                    <th>신청 경로 · 번호</th>
                    <th>상태</th>
                    <th>처리</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attendees.map((app) => (
                    <tr key={app.id}>
                      <td>
                        <strong>{app.attendeeName}</strong>
                        <small>{app.contact}</small>
                        <SubmittedApplicationDetails
                          answers={app.answers}
                          note={app.note}
                          completed={app.questionnaireCompleted}
                        />
                      </td>
                      <td>
                        <span>{app.source === "external" ? "외부 신청" : "슬리퍼 신청"}</span>
                        <small>{app.externalReference || "내부 신청 내역"}</small>
                        <small>{formatKoreanDate(app.createdAt)}</small>
                      </td>
                      <td>
                        <span className={`participation-status ${app.status}`}>
                          {STATUS_LABELS[app.status]}
                        </span>
                        {app.externalPaymentVerified && <small>외부 결제 확인됨</small>}
                        {app.decisionNote && <small>{app.decisionNote}</small>}
                      </td>
                      <td>
                        {app.source === "external" &&
                        ["pending_approval", "review"].includes(app.status) ? (
                          <div className="dashboard-row-actions">
                            <button
                              disabled={busy || cancelled || !app.questionnaireCompleted}
                              title={
                                !app.questionnaireCompleted
                                  ? "참가 질문 답변을 기다리고 있어요"
                                  : undefined
                              }
                              onClick={() => select(app, "approve")}
                            >
                              <Check size={14} />
                              승인
                            </button>
                            {app.status === "pending_approval" && !app.externalPaymentVerified && (
                              <button disabled={busy} onClick={() => select(app, "reject")}>
                                <X size={14} />
                                반려
                              </button>
                            )}
                            {(app.status === "review" || app.externalPaymentVerified) && (
                              <button disabled={busy} onClick={() => select(app, "refund")}>
                                환불 확인
                              </button>
                            )}
                          </div>
                        ) : app.source === "external" && app.status === "confirmed" ? (
                          <button
                            disabled={busy}
                            className="dashboard-refund"
                            onClick={() => select(app, "refund")}
                          >
                            환불 확인
                          </button>
                        ) : (
                          <small>—</small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.attendees.length && (
                <p className="participation-empty">해당 조건의 참가 내역이 없어요.</p>
              )}
            </div>
            {data.nextCursor && (
              <button
                disabled={busy}
                className="participation-secondary"
                onClick={() => {
                  void work(async () => {
                    hasOlder.current = true;
                    await refresh(data.nextCursor!);
                  });
                }}
              >
                이전 참가 내역 더 보기
              </button>
            )}
            {hasOlder.current && (
              <p className="participation-muted">
                이전 내역을 보는 동안 요약과 관리 권한은 자동 확인해요. 새로고침하면 목록 전체가
                최신 상태로 갱신됩니다.
              </p>
            )}
            {selection && (
              <form className="dashboard-decision-panel" onSubmit={decide}>
                <h3>
                  {selection.app.attendeeName}님 ·{" "}
                  {selection.decision === "approve"
                    ? "참가 승인"
                    : selection.decision === "reject"
                      ? "확인 요청 반려"
                      : "외부 환불 확인"}
                </h3>
                <p>
                  신청 번호 {selection.app.externalReference} · 확인 금액{" "}
                  {selection.app.amountKRW.toLocaleString("ko-KR")}원
                </p>
                {selection.decision !== "reject" && (
                  <label className="participation-checkbox">
                    <input
                      required
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                    />
                    <span>
                      {selection.decision === "approve"
                        ? "외부 플랫폼에서 신청자·신청 번호·결제 금액을 대조하여 참가를 확인했습니다."
                        : "외부 플랫폼에서 환불 또는 취소 완료 내역을 확인했습니다. 처리 후 공지방 접근이 해제됩니다."}
                    </span>
                  </label>
                )}
                <label>
                  {selection.decision === "reject"
                    ? "반려 사유 (필수)"
                    : "참가자에게 전달할 안내 (선택)"}
                  <textarea
                    required={selection.decision === "reject"}
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div>
                  <button className="participation-primary" disabled={busy}>
                    {busy ? "처리 중…" : "확인 후 처리"}
                  </button>
                  <button
                    type="button"
                    className="participation-secondary"
                    onClick={() => setSelection(null)}
                  >
                    닫기
                  </button>
                </div>
              </form>
            )}
          </section>
          <aside>
            <section className="participation-card">
              <EventPrivateContact postId={postId} manage={event.isOwner} />
            </section>
            {event.isOwner && (
              <details
                className="participation-card host-settings workspace-disclosure"
                open={event.config == null}
              >
                <summary>
                  <Settings2 size={18} />
                  <span>행사 설정</span>
                </summary>
                <form onSubmit={configure}>
                  <fieldset className="lifecycle-settings-fields" disabled={busy || cancelled}>
                    <EventLocationField
                      value={venue}
                      onChange={(next) => {
                        setVenueChanged(true);
                        setVenue(next);
                      }}
                      disabled={busy}
                      purpose="venue"
                    />
                    <small>
                      공개 행사장 좌표로 반경·거리 검색에 표시합니다. 참가 내역이 있으면 지정한
                      좌표는 고정돼요.
                    </small>
                    <label>
                      시작 일시 (한국 시간)
                      <input
                        type="datetime-local"
                        disabled={stats.total > 0}
                        value={settings.startsAt}
                        onChange={(e) => setSettings({ ...settings, startsAt: e.target.value })}
                      />
                    </label>
                    <label>
                      종료 일시 (한국 시간)
                      <input
                        type="datetime-local"
                        disabled={stats.total > 0}
                        value={settings.endsAt}
                        onChange={(e) => setSettings({ ...settings, endsAt: e.target.value })}
                      />
                    </label>
                    <small>
                      참가 내역이 있으면 위의 ‘주최자 일정 변경·행사 취소’에서 사유와 함께 일정을
                      변경해주세요. 참가자에게 변경 안내와 전액 취소·환불 요청 권리가 전달됩니다.
                    </small>

                    <label>
                      {event.externalUrl ? "외부 플랫폼 참가 금액 (원)" : "참가 금액 (원)"}
                      <input
                        required
                        type="number"
                        min="0"
                        max="10000000"
                        readOnly={event.config?.meetupType === "lightning" && !event.externalUrl}
                        value={settings.amountKRW}
                        onChange={(e) =>
                          setSettings({ ...settings, amountKRW: Number(e.target.value) })
                        }
                      />
                    </label>
                    {event.config?.meetupType === "lightning" && (
                      <small>
                        {event.externalUrl
                          ? "실제 외부 플랫폼 참가비와 같은 금액을 설정해주세요. 결제 확인·승인 후 공지방에 초대돼요."
                          : "슬리퍼 직접 번개 참가는 무료예요. 유료 모집은 글 수정에서 외부 신청 링크를 연결해주세요."}
                      </small>
                    )}
                    <label>
                      정원
                      <input
                        required
                        type="number"
                        min={event.config?.meetupType === "lightning" ? 2 : 1}
                        max={event.config?.meetupType === "lightning" ? 12 : 5000}
                        value={settings.capacity}
                        onChange={(e) =>
                          setSettings({ ...settings, capacity: Number(e.target.value) })
                        }
                      />
                    </label>
                    {event.externalUrl && (
                      <label>
                        참가 승인 방식
                        <select
                          value={settings.approvalMode}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              approvalMode: e.target.value as "manual" | "automatic",
                            })
                          }
                        >
                          <option value="manual">담당자 확인 후 수동 승인</option>
                          <option value="automatic">연동된 결제 확인으로 자동 승인</option>
                        </select>
                        <small>
                          자동 승인은 외부 플랫폼의 회원 연결·결제 알림 연동이 완료되어야
                          작동합니다.
                        </small>
                      </label>
                    )}
                    <EventQuestionEditor
                      questions={settings.questions}
                      onChange={(questions) => setSettings({ ...settings, questions })}
                      disabled={busy}
                    />
                    <label className="participation-checkbox">
                      <input
                        type="checkbox"
                        checked={settings.open}
                        onChange={(e) => setSettings({ ...settings, open: e.target.checked })}
                      />
                      {event.externalUrl ? "참가 확인 요청 접수" : "사이트 내 참가 신청 접수"}
                    </label>
                    <button className="participation-primary" disabled={busy || cancelled}>
                      행사 설정 저장
                    </button>
                  </fieldset>
                  {cancelled && (
                    <p className="lifecycle-cancelled-note">
                      취소된 행사는 접수를 다시 열 수 없어요. 참가 내역과 취소·환불은 계속 관리할 수
                      있어요.
                    </p>
                  )}
                </form>
              </details>
            )}
            <section className="participation-card">
              <h2>
                <ShieldCheck size={18} />
                승인과 공지방
              </h2>
              <p className="participation-muted">
                외부 신청은 담당자가 결제 내역을 확인하거나 연결된 플랫폼의 검증된 알림을 받은 후
                승인됩니다. 승인 시 전용 공지방에 자동 참여합니다.
              </p>
              <p className="participation-muted">
                이 대시보드에서는 실제 결제·환불·정산을 실행하지 않습니다. 외부 플랫폼의 정원과
                접수·환불 상태도 함께 관리해주세요.
              </p>
            </section>
          </aside>
        </div>
        <section className="participation-card workspace-resource-card">
          <div>
            <h2>이 행사의 진행 자료</h2>
            <p>템플릿의 시나리오·규칙·준비물을 확인하세요.</p>
          </div>
          <Link className="participation-secondary" href={`/archive/events/${postId}`}>
            행사 진행 가이드
          </Link>
        </section>
        {!cancelled && (
          <EventCompletionPanel
            postId={postId}
            endsAt={event.config?.endsAt}
            onCompleted={() => refresh(undefined, true)}
          />
        )}
        <details
          id="event-credits"
          className="participation-card workspace-disclosure workspace-detail-section"
        >
          <summary>제작진 확인</summary>
          <EventCreditManager postId={postId} />
        </details>
        <details
          id="event-results"
          className="participation-card workspace-disclosure workspace-detail-section"
        >
          <summary>참가 전적 기록</summary>
          <PlayerRecordManager postId={postId} />
        </details>
        <details className="participation-card workspace-disclosure workspace-detail-section">
          <summary>취소·환불 관리</summary>
          <RefundPanel
            postId={postId}
            startsAt={event.config?.startsAt}
            refreshRevision={lifecycleRevision}
            manage
          />
        </details>
      </div>
    </ParticipationShell>
  );
}
