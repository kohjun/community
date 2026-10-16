"use client";
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
  return (
    <ParticipationShell>
      <header className="participation-heading">
        <span>EXTERNAL REGISTRATION</span>
        <h1>{event.title}</h1>
        <p>신청과 결제는 외부 플랫폼에서, 행사 공지는 슬리퍼에서.</p>
      </header>
      <ol className="participation-steps">
        <li className={!app ? "current" : "done"}>
          <ArrowUpRight size={17} />
          01 외부 신청 · 결제
        </li>
        <li className={app?.status === "confirmed" ? "done" : active ? "current" : ""}>
          <ShieldCheck size={17} />
          02 참가 승인
        </li>
        <li className={app?.status === "confirmed" ? "current" : ""}>
          <Megaphone size={17} />
          03 전용 공지방
        </li>
      </ol>
      {event.config && (
        <EventLifecyclePanel
          postId={event.postId}
          onChanged={async (view) => {
            setCancelled(!!view.cancelledAt);
            setLifecycleRevision(view.revision);
            if (view.cancelledAt) setShowConfirm(false);
            setEvent(await request<EventOverview>(`/events/${event.postId}`));
          }}
        />
      )}
      <div className="participation-grid">
        <div>
          <section className="participation-card event-summary">
            <div className="participation-eyebrow">신청 플랫폼으로 이동</div>
            <h2>이 모임은 외부에서 신청해요</h2>
            <p>{event.location || "모집글에서 장소를 확인해주세요"}</p>
            <p>{event.eventDate || "외부 신청 페이지에서 일정을 확인해주세요"}</p>
            {event.config && (
              <p>
                참가 확정 {event.config.occupied} / {event.config.capacity}명
              </p>
            )}
            {cancelled ? (
              <p className="lifecycle-cancelled-note">
                주최자가 행사를 취소하여 신규 신청을 받지 않아요.
              </p>
            ) : (
              <a
                className="participation-primary"
                href={event.externalUrl!}
                target="_blank"
                rel="noopener noreferrer"
              >
                외부 플랫폼에서 신청하기
                <ArrowUpRight size={17} />
              </a>
            )}
            <small>
              새 탭에서 신청과 결제를 완료해주세요. 슬리퍼에서는 별도의 참가 신청이나 결제를 받지
              않습니다.
            </small>
          </section>
          <section className="participation-note">
            <ShieldCheck size={23} />
            <div>
              <strong>승인되면 공지방에 자동 참여해요</strong>
              <p>
                외부 신청을 마친 후 참가 확인을 요청하면 담당자가 내역을 확인합니다. 자동 승인이
                연결된 행사는 플랫폼의 결제 확인 알림으로 참여가 승인됩니다. 신청 번호 입력만으로
                공지방이 열리지는 않아요.
              </p>
            </div>
          </section>
          {event.publicProfileId && (
            <section className="participation-card external-member-code">
              <h2>나의 회원 연결 코드</h2>
              <p>연동 플랫폼에서 슬리퍼 회원 코드를 요청하는 경우 아래 코드를 사용하세요.</p>
              <code>{event.publicProfileId}</code>
              <small>이름만으로 회원을 자동 연결하지 않습니다.</small>
            </section>
          )}
          {event.canManage && (
            <Link className="participation-primary" href={`/management/events/${event.postId}`}>
              <Settings2 size={18} />
              행사 관리 대시보드
            </Link>
          )}
        </div>
        <section className="participation-card application-form">
          <h2>
            <Ticket size={20} />
            {active ? "나의 참가 현황" : "결제 후 참가 확인"}
          </h2>
          {error && (
            <p className="participation-error" role="alert">
              {error}
            </p>
          )}
          {active && app ? (
            <div className="application-state">
              <span className={`participation-status ${app.status}`}>
                {STATUS_LABELS[app.status]}
              </span>
              <h3>{app.attendeeName}님의 참가 내역</h3>
              {app.externalReference && <p>외부 신청 번호: {app.externalReference}</p>}
              <SubmittedApplicationDetails
                answers={app.answers}
                note={app.note}
                completed={app.questionnaireCompleted}
              />
              {app.status === "confirmed" ? (
                <>
                  <p>참가가 승인되었어요. 행사 준비물과 일정 안내를 확인하세요.</p>
                  <Link className="participation-primary" href={`/rooms/${event.postId}`}>
                    <CheckCircle2 size={18} />
                    공지방 입장
                  </Link>
                  <EventPrivateContact postId={event.postId} />
                  {!cancelled && <AdmissionTicket postId={event.postId} applicationId={app.id} />}
                  {cancelled && (
                    <p className="lifecycle-cancelled-note">
                      주최자가 행사를 취소했어요. QR 입장은 중단되었고, 아래에서 전액 취소·환불을
                      요청할 수 있어요.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p>
                    {needsAnswers
                      ? "외부 신청 내역이 연결되었어요. 참가 질문에 답변하고 정보 제공에 동의하면 참가 확인을 이어갈 수 있어요."
                      : app.status === "review"
                        ? "결제 확인 내역에 담당자 확인이 필요해요. 정원이나 기존 내역을 확인한 후 담당자가 안내드립니다."
                        : "담당자가 외부 플랫폼의 신청·결제 내역을 확인하고 있어요. 승인 결과는 이 화면과 내 참가 내역에 자동 반영됩니다."}
                  </p>
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
                      className="participation-secondary"
                      onClick={() => {
                        void work(async () =>
                          setEvent(
                            await request<EventOverview>(`/applications/${app.id}`, "DELETE"),
                          ),
                        );
                      }}
                    >
                      확인 요청 취소
                    </button>
                  )}
                </>
              )}
              {app.decisionNote && (
                <p className="dashboard-decision-note">담당자 안내: {app.decisionNote}</p>
              )}
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
                <p className="lifecycle-cancelled-note">
                  취소된 행사는 새 참가 확인을 받지 않아요. 이미 결제한 내역은 담당자에게
                  확인해주세요.
                </p>
              ) : !event.canApply ? (
                <>
                  <p className="participation-muted">
                    외부 신청은 위 링크에서 진행할 수 있어요. 공지방 참여 확인은 로그인 후
                    이용해주세요.
                  </p>
                  <Link
                    href={`/login?returnTo=${encodeURIComponent(`/events/${event.postId}`)}`}
                    className="participation-secondary"
                  >
                    로그인 안내
                  </Link>
                </>
              ) : !event.applicantProfile?.ready ? (
                <ApplicantProfileSummary profile={event.applicantProfile} postId={event.postId} />
              ) : !event.config?.open ? (
                <p className="participation-muted">
                  담당자가 슬리퍼 참가 확인 접수를 준비 중이거나 마감했어요. 신청·결제는 외부
                  플랫폼의 안내를 확인해주세요.
                </p>
              ) : !showConfirm ? (
                <>
                  <p className="participation-muted">
                    이미 외부 플랫폼에서 신청·결제를 마쳤다면 확인 요청을 남겨주세요. 이 요청은 외부
                    신청 내역과 공지방 계정을 연결하기 위한 절차입니다.
                  </p>
                  <button className="participation-primary" onClick={() => setShowConfirm(true)}>
                    외부 신청 · 결제를 완료했어요
                  </button>
                </>
              ) : (
                confirmationForm()
              )}
            </>
          )}
        </section>
      </div>
      <RecordBacklink postId={event.postId} />
      <VerifiedEventReviews postId={event.postId} />
      <RefundPanel
        postId={event.postId}
        startsAt={event.config?.startsAt}
        refreshRevision={lifecycleRevision}
      />
    </ParticipationShell>
  );
}
