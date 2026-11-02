"use client";
import { loginHref } from "@/domain/login-return";
import { ParticipantGuideCard } from "./participant-guide";
import { notifyPushOnboardingMoment } from "@/lib/push-onboarding-events";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Megaphone,
  ShieldCheck,
  Ticket,
  Settings2,
  ArrowLeft,
  CalendarDays,
  MapPin,
  Wallet,
  Users,
  Clock3,
} from "lucide-react";
import { externalClaimSchema, STATUS_LABELS, type EventOverview } from "@/domain/participation";
import { participationRequest as request } from "@/lib/participation-client";
import { RequestError } from "@/lib/api-client";
import { EventPrivateContact } from "./event-private-contact";
import { AdmissionTicket } from "./admission-ticket";
import { RecordBacklink } from "./record-discovery";
import { VerifiedEventReviews } from "./verified-event-reviews";
import { RefundPanel } from "./refund-panel";
import { EventLifecyclePanel } from "./event-lifecycle-panel";
import {
  ApplicantProfileSummary,
  ApplicationQuestionFields,
  SubmittedApplicationDetails,
  questionAnswers,
  type ApplicationAnswer,
} from "./application-question-fields";
import { ParticipationShell } from "./participation-shell";
export function ExternalEvent({ initial }: { initial: EventOverview }) {
  const [event, setEvent] = useState(initial),
    [showConfirm, setShowConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (event.application?.status !== "confirmed") return;
    const timer = setTimeout(() => notifyPushOnboardingMoment("participation"), 0);
    return () => clearTimeout(timer);
  }, [event.application?.status]);
  const [draft, setDraft] = useState({
      externalReference: initial.application?.externalReference ?? "",
      note: initial.application?.note ?? "",
      consent: false,
      refundConsent: false,
      answers: [] as ApplicationAnswer[],
    }),
    gate = useRef(false);
  const [cancelled, setCancelled] = useState(!!initial.config?.cancelledAt);
  const [lifecycleRevision, setLifecycleRevision] = useState(
    initial.config?.lifecycleRevision ?? 0,
  );
  const app = event.application,
    active =
      !!app && ["pending_approval", "confirmed", "review", "pending_payment"].includes(app.status);
  const needsAnswers =
    !!app && ["pending_approval", "review"].includes(app.status) && !app.questionnaireCompleted;
  useEffect(() => {
    if (busy) return;
    const abort = new AbortController();
    const refresh = () => {
      if (document.visibilityState === "visible" && !gate.current)
        void request<EventOverview>(`/events/${event.postId}`, "GET", undefined, abort.signal)
          .then((value) => {
            if (!abort.signal.aborted) setEvent(value);
          })
          .catch(() => {});
    };
    const timer = setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [event.postId, busy]);
  async function work(fn: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 시도해주세요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  function confirm(e: FormEvent) {
    e.preventDefault();
    const parsed = externalClaimSchema.safeParse({
      ...draft,
      externalReference: needsAnswers ? (app?.externalReference ?? "") : draft.externalReference,
      answers: questionAnswers(event.config?.questions ?? [], draft.answers),
      questionnaireVersion: event.config?.questionnaireVersion ?? "",
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ||
          "질문 답변·외부 신청 번호와 정보 제공 동의를 확인해주세요.",
      );
      return;
    }
    void work(async () => {
      try {
        setEvent(
          await request<EventOverview>(
            `/events/${event.postId}/external-confirmation`,
            "POST",
            parsed.data,
          ),
        );
        setShowConfirm(false);
      } catch (error) {
        if (error instanceof RequestError && error.code === "CONFLICT") {
          const latest = await request<EventOverview>(`/events/${event.postId}`).catch(() => null);
          if (latest) setEvent(latest);
        }
        throw error;
      }
    });
  }
  function confirmationForm() {
    if (!event.applicantProfile?.ready)
      return <ApplicantProfileSummary profile={event.applicantProfile} postId={event.postId} />;
    return (
      <form onSubmit={confirm}>
        <ApplicantProfileSummary profile={event.applicantProfile} postId={event.postId} />
        {!needsAnswers && (
          <label>
            외부 신청 번호 · 주문 번호
            <input
              required
              minLength={3}
              maxLength={160}
              disabled={busy}
              value={draft.externalReference}
              onChange={(e) => setDraft({ ...draft, externalReference: e.target.value })}
              placeholder="외부 플랫폼에서 받은 번호"
            />
            <small>담당자가 외부 결제 내역과 대조하는 데 사용해요.</small>
          </label>
        )}
        <ApplicationQuestionFields
          questions={event.config?.questions ?? []}
          answers={draft.answers}
          onChange={(answers) => setDraft({ ...draft, answers })}
          disabled={busy}
        />
        <label>
          참가 요청사항 <small>선택</small>
          <textarea
            rows={3}
            maxLength={500}
            disabled={busy}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="참가와 관련해 담당자에게 전할 내용을 적어주세요"
          />
        </label>
        <label className="participation-checkbox">
          <input
            type="checkbox"
            required
            disabled={busy}
            checked={draft.consent}
            onChange={(e) => setDraft({ ...draft, consent: e.target.checked })}
          />
          <span>
            참가 확인과 행사 연락을 위해 등록된 닉네임·연락처와 신청 번호·질문 답변·요청사항을 해당
            행사 담당자에게 제공하는 데 동의합니다.
          </span>
        </label>
        {event.config?.startsAt && event.config.amountKRW > 0 && (
          <label className="participation-checkbox">
            <input
              type="checkbox"
              required
              disabled={busy}
              checked={draft.refundConsent}
              onChange={(e) => setDraft({ ...draft, refundConsent: e.target.checked })}
            />
            한국 날짜 기준 환불 정책(5일 전까지 100%, 이후 하루마다 20% 차감)을 확인했어요
          </label>
        )}
        <button disabled={busy} className="participation-primary">
          {busy ? "제출 중…" : needsAnswers ? "답변 제출하고 참가 확인" : "참가 확인 요청 보내기"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="participation-text-link"
          onClick={() => setShowConfirm(false)}
        >
          닫기
        </button>
      </form>
    );
  }
  const paid = (event.config?.amountKRW ?? 0) > 0;
  return (
    <ParticipationShell>
      <div className="participation-workspace participation-flow">
        <header className="participation-heading">
          <Link className="participation-flow-back" href={`/posts/${event.postId}`}>
            <ArrowLeft size={15} /> 모집글 보기
          </Link>
          <span>외부 플랫폼 신청 모임</span>
          <h1>{event.title}</h1>
          <p>
            {paid
              ? "외부 플랫폼에서 신청·결제를 마친 뒤, 슬리퍼에서 참가 확인을 요청해주세요."
              : "외부 플랫폼에서 신청을 마친 뒤, 슬리퍼에서 참가 확인을 요청해주세요."}
          </p>
        </header>
        <section
          className="participation-card participation-flow-summary"
          aria-label="신청할 모임 요약"
        >
          <dl>
            <div>
              <dt>
                <CalendarDays size={16} /> 일정
              </dt>
              <dd>{event.eventDate || "외부 신청 페이지에서 확인해주세요"}</dd>
            </div>
            <div>
              <dt>
                <MapPin size={16} /> 장소
              </dt>
              <dd>{event.location || "모집글에서 확인해주세요"}</dd>
            </div>
            <div>
              <dt>
                <Wallet size={16} /> 비용
              </dt>
              <dd>
                {event.config
                  ? event.config.amountKRW === 0
                    ? "사전 결제 없음"
                    : `${event.config.amountKRW.toLocaleString("ko-KR")}원 / 1인`
                  : "외부 신청 페이지에서 확인"}
              </dd>
            </div>
            <div>
              <dt>
                <Users size={16} /> 모집
              </dt>
              <dd>
                {event.config
                  ? `${event.config.occupied} / ${event.config.capacity}명 · ${event.config.open ? "확인 접수 중" : "확인 접수 마감"}`
                  : "참가 확인 준비 중"}
              </dd>
            </div>
          </dl>
          <p className="participation-flow-method">
            <ShieldCheck size={16} />
            외부 신청 내역 확인 후 공지방 입장 · 슬리퍼에서 중복 결제하지 않아요
          </p>
        </section>
        <ParticipantGuideCard guide={event.config?.participantGuide ?? null} />
        <ol className="participation-steps participation-flow-steps" aria-label="참가 진행 순서">
          <li className={!app ? "current" : "done"}>
            <ArrowUpRight size={17} />
            <span>01 {paid ? "외부 신청·결제" : "외부 신청"}</span>
          </li>
          <li
            className={
              app?.status === "confirmed" ? "done" : active || showConfirm ? "current" : ""
            }
          >
            <ShieldCheck size={17} />
            <span>02 참가 확인·승인</span>
          </li>
          <li className={app?.status === "confirmed" ? "current" : ""}>
            <Megaphone size={17} />
            <span>03 공지방 입장</span>
          </li>
        </ol>
        {cancelled && (
          <p className="lifecycle-cancelled-note" role="status">
            주최자가 모임을 취소했어요. 새로운 신청은 받지 않아요.
          </p>
        )}
        {!active && !cancelled && !showConfirm && (
          <section className="participation-card participation-flow-external-start">
            <span className="participation-eyebrow">아직 신청하지 않았다면</span>
            <h2>먼저 외부 플랫폼에서 신청해주세요</h2>
            <p>
              {paid
                ? "신청과 결제는 연결된 플랫폼에서 진행해요. 완료 후 아래에서 참가 내역을 연결하면 공지방에 참여할 수 있어요."
                : "연결된 플랫폼에서 신청한 후 아래에서 참가 내역을 연결하면 공지방에 참여할 수 있어요."}
            </p>
            <a
              className="participation-primary"
              href={event.externalUrl!}
              target="_blank"
              rel="noopener noreferrer"
            >
              외부 플랫폼에서 신청하기 <ArrowUpRight size={17} />
            </a>
            <small>새 탭으로 열려요. 신청을 마쳤다면 이 화면으로 돌아와주세요.</small>
          </section>
        )}
        <section className="participation-card application-form participation-flow-form">
          <div className="participation-flow-form-heading">
            <h2>
              <Ticket size={19} />
              {active
                ? "나의 참가 현황"
                : showConfirm
                  ? "외부 신청 내역 연결"
                  : "이미 외부 신청을 마쳤나요?"}
            </h2>
            {!active && (
              <p>
                신청 번호와 질문 답변을 제출하면 담당자가 확인해요. 승인 후 전용 공지방이 열려요.
              </p>
            )}
          </div>
          {error && (
            <p className="participation-error" role="alert">
              {error}
            </p>
          )}
          {active && app ? (
            <div className="application-state" role="status" aria-live="polite">
              <span className={`participation-status ${app.status}`}>
                {STATUS_LABELS[app.status]}
              </span>
              <h3>
                {app.status === "confirmed" ? "함께할 준비가 되었어요" : "참가 확인을 요청했어요"}
              </h3>
              {app.externalReference && <p>외부 신청 번호: {app.externalReference}</p>}
              {app.status === "confirmed" ? (
                <>
                  <p>참가가 승인되었어요. 공지방에서 준비물과 모임 안내를 확인하세요.</p>
                  <Link
                    className="participation-primary participation-flow-primary"
                    href={`/rooms/${event.postId}`}
                  >
                    <CheckCircle2 size={18} /> 공지방 입장하기
                  </Link>
                  <EventPrivateContact postId={event.postId} />
                  {!cancelled && (
                    <details className="participation-flow-details">
                      <summary>행사 당일 QR 입장권</summary>
                      <AdmissionTicket postId={event.postId} applicationId={app.id} />
                    </details>
                  )}
                  {cancelled && (
                    <p className="lifecycle-cancelled-note">
                      QR 입장이 중단되었어요. 결제한 내역은 아래 취소·환불 안내를 확인해주세요.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="participation-flow-status-note">
                    <Clock3 size={20} />
                    <div>
                      <strong>
                        {needsAnswers
                          ? "참가 질문에 답변해주세요"
                          : "담당자가 신청 내역을 확인하고 있어요"}
                      </strong>
                      <p>
                        {needsAnswers
                          ? "신청 내역이 연결되었어요. 질문에 답변하고 정보 제공에 동의하면 참가 확인을 이어갈 수 있어요."
                          : app.status === "review"
                            ? "정원이나 결제 내역에 추가 확인이 필요해요. 확인 후 담당자가 안내드립니다."
                            : "승인 결과가 이 화면과 내 신청 내역에 반영되면 공지방에 입장할 수 있어요."}
                      </p>
                    </div>
                  </div>
                  {!cancelled &&
                    needsAnswers &&
                    (showConfirm ? (
                      confirmationForm()
                    ) : (
                      <button
                        type="button"
                        className="participation-primary"
                        onClick={() => setShowConfirm(true)}
                      >
                        참가 질문에 답변하기
                      </button>
                    ))}
                  {app.status === "pending_approval" && !app.externalPaymentVerified && (
                    <button
                      disabled={busy}
                      className="participation-text-link"
                      onClick={() => {
                        void work(async () =>
                          setEvent(
                            await request<EventOverview>(`/applications/${app.id}`, "DELETE"),
                          ),
                        );
                      }}
                    >
                      참가 확인 요청 취소
                    </button>
                  )}
                </>
              )}
              {app.decisionNote && (
                <p className="dashboard-decision-note">담당자 안내: {app.decisionNote}</p>
              )}
              <SubmittedApplicationDetails
                answers={app.answers}
                note={app.note}
                completed={app.questionnaireCompleted}
              />
              <p className="participation-muted">
                실제 신청 취소·환불은 외부 플랫폼에서 요청해주세요.
              </p>
            </div>
          ) : (
            <>
              {app && (
                <p className="participation-muted">
                  이전 내역: {STATUS_LABELS[app.status]}
                  {app.decisionNote && ` · ${app.decisionNote}`}
                </p>
              )}
              {cancelled ? (
                <p className="participation-muted">
                  이미 신청·결제한 내역은 담당자에게 확인해주세요.
                </p>
              ) : !event.canApply ? (
                <div className="participation-flow-login">
                  <p>외부 신청 내역을 연결하려면 로그인해주세요.</p>
                  <Link
                    href={loginHref(`/events/${event.postId}`)}
                    className="participation-primary"
                  >
                    로그인하고 참가 확인하기
                  </Link>
                </div>
              ) : !event.applicantProfile?.ready ? (
                <ApplicantProfileSummary profile={event.applicantProfile} postId={event.postId} />
              ) : !event.config?.open ? (
                <p className="participation-muted">
                  담당자가 참가 확인 접수를 준비 중이거나 마감했어요. 외부 플랫폼의 안내도
                  확인해주세요.
                </p>
              ) : !showConfirm ? (
                <button className="participation-primary" onClick={() => setShowConfirm(true)}>
                  {paid ? "외부 신청·결제를 완료했어요" : "외부 신청을 완료했어요"}{" "}
                  <CheckCircle2 size={17} />
                </button>
              ) : (
                confirmationForm()
              )}
            </>
          )}
        </section>
        <section className="participation-note participation-flow-note">
          <Megaphone size={20} />
          <div>
            <strong>승인 후 공지방에 자동 참여해요</strong>
            <p>
              신청 번호 입력만으로 참가가 확정되지는 않아요. 담당자 또는 연동 플랫폼의 내역 확인이
              필요해요.
            </p>
          </div>
        </section>
        {event.publicProfileId && (
          <details className="participation-card workspace-disclosure participation-flow-details external-member-code">
            <summary>외부 플랫폼에서 회원 연결 코드를 요청하나요?</summary>
            <p>슬리퍼 회원 코드를 요청하는 경우에만 아래 코드를 사용해주세요.</p>
            <code>{event.publicProfileId}</code>
            <small>이름만으로 회원을 자동 연결하지 않아요.</small>
          </details>
        )}
        {event.canManage && (
          <details className="participation-card workspace-disclosure participation-flow-details">
            <summary>
              <Settings2 size={18} />
              담당자 관리
            </summary>
            <Link className="participation-secondary" href={`/management/events/${event.postId}`}>
              참가 확인 · 승인 대시보드
            </Link>
          </details>
        )}
        {event.config && (
          <details
            className="participation-card workspace-disclosure participation-flow-details"
            open={cancelled || lifecycleRevision > 0}
          >
            <summary>일정 변경 · 취소 안내{event.isOwner ? " 및 관리" : ""}</summary>
            <EventLifecyclePanel
              postId={event.postId}
              onChanged={async (view) => {
                setCancelled(!!view.cancelledAt);
                setLifecycleRevision(view.revision);
                if (view.cancelledAt) setShowConfirm(false);
                setEvent(await request<EventOverview>(`/events/${event.postId}`));
              }}
            />
          </details>
        )}
        <details className="participation-card workspace-disclosure participation-flow-details">
          <summary>취소 · 환불 안내</summary>
          <RefundPanel
            postId={event.postId}
            startsAt={event.config?.startsAt}
            refreshRevision={lifecycleRevision}
          />
        </details>
        <RecordBacklink postId={event.postId} />
        <VerifiedEventReviews postId={event.postId} />
      </div>
    </ParticipationShell>
  );
}
