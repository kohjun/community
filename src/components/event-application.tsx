"use client";
import { notifyPushOnboardingMoment } from "@/lib/push-onboarding-events";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CalendarDays,
  MapPin,
  ShieldCheck,
  Ticket,
  Wallet,
  Megaphone,
  ArrowRight,
  Settings2,
} from "lucide-react";
import type { EventOverview } from "@/domain/participation";
import { STATUS_LABELS, applicationSchema } from "@/domain/participation";
import { formatKoreanDateTime } from "@/domain/refund";
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
const money = (amount: number) => (amount === 0 ? "무료" : `${amount.toLocaleString("ko-KR")}원`);
export function EventApplication({
  initial,
  paymentMode,
}: {
  initial: EventOverview;
  paymentMode: "external" | "local-test" | "unavailable";
}) {
  const [event, setEvent] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState({
      answers: [] as ApplicationAnswer[],
      note: "",
      consent: false,
      refundConsent: false,
    });
  const gate = useRef(false),
    [settings, setSettings] = useState({
      amountKRW: initial.config?.amountKRW ?? 0,
      capacity: initial.config?.capacity ?? 20,
      open: initial.config?.open ?? true,
    });
  const [cancelled, setCancelled] = useState(!!initial.config?.cancelledAt);
  const [lifecycleRevision, setLifecycleRevision] = useState(
    initial.config?.lifecycleRevision ?? 0,
  );
  const application = event.application,
    config = event.config;
  useEffect(() => {
    if (application?.status !== "confirmed") return;
    const timer = setTimeout(() => notifyPushOnboardingMoment("participation"), 0);
    return () => clearTimeout(timer);
  }, [application?.status]);
  useEffect(() => {
    if (application?.status !== "pending_payment" || busy) return;
    const abort = new AbortController();
    const refresh = () => {
      if (document.visibilityState === "visible")
        void request<EventOverview>(`/events/${event.postId}`, "GET", undefined, abort.signal)
          .then(setEvent)
          .catch(() => {});
    };
    const timer = setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [event.postId, application?.status, busy]);
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
  function apply(e: FormEvent) {
    e.preventDefault();
    const parsed = applicationSchema.safeParse({
      ...draft,
      answers: questionAnswers(config?.questions ?? [], draft.answers),
      questionnaireVersion: config?.questionnaireVersion ?? "",
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "질문 답변과 정보 제공 동의를 확인해주세요.");
      return;
    }
    void work(async () => {
      try {
        setEvent(
          await request<EventOverview>(`/events/${event.postId}/applications`, "POST", parsed.data),
        );
      } catch (error) {
        if (error instanceof RequestError && error.code === "CONFLICT") {
          const latest = await request<EventOverview>(`/events/${event.postId}`).catch(() => null);
          if (latest) setEvent(latest);
        }
        throw error;
      }
    });
  }
  function save(e: FormEvent) {
    e.preventDefault();
    void work(async () => {
      setEvent(await request<EventOverview>(`/events/${event.postId}/settings`, "PUT", settings));
    });
  }
  async function pay() {
    const orderId = application?.orderId;
    if (!orderId) return;
    await work(async () => {
      if (paymentMode === "local-test") {
        await request(`/orders/${orderId}/simulate`, "POST", { status: "paid" });
        setEvent(await request<EventOverview>(`/events/${event.postId}`));
      } else {
        const result = await request<{ checkoutUrl: string }>(
          `/orders/${orderId}/checkout`,
          "POST",
        );
        window.location.assign(result.checkoutUrl);
      }
    });
  }
  const active =
    application && ["pending_payment", "confirmed", "review"].includes(application.status);
  return (
    <ParticipationShell>
      <header className="participation-heading">
        <span>YOUR NEXT EPISODE</span>
        <h1>{event.title}</h1>
        <p>신청은 슬리퍼에서, 결제는 연결된 플랫폼에서.</p>
      </header>
      <ol className="participation-steps">
        <li className={application ? "done" : "current"}>
          <Ticket size={18} />
          01 참가 신청
        </li>
        <li
          className={
            application?.status === "confirmed"
              ? "done"
              : application?.status === "pending_payment"
                ? "current"
                : ""
          }
        >
          <Wallet size={18} />
          02 결제 확인
        </li>
        <li className={application?.status === "confirmed" ? "current" : ""}>
          <Megaphone size={18} />
          03 전용 공지방
        </li>
      </ol>
      {event.config && (
        <EventLifecyclePanel
          postId={event.postId}
          onChanged={async (view) => {
            setCancelled(!!view.cancelledAt);
            setLifecycleRevision(view.revision);
            if (view.cancelledAt) setSettings((previous) => ({ ...previous, open: false }));
            setEvent(await request<EventOverview>(`/events/${event.postId}`));
          }}
        />
      )}
      <div className="participation-grid">
        <div>
          <section className="participation-card event-summary">
            <div className="participation-eyebrow">함께할 준비 되셨나요?</div>
            <h2>화면 밖에서 만나는 우리</h2>
            <p>
              <MapPin size={17} />
              {event.location || "장소는 모집글을 확인해주세요"}
            </p>
            <p>
              <CalendarDays size={17} />
              {event.eventDate || "일정은 모집글을 확인해주세요"}
            </p>
            {config && (
              <>
                <strong className="participation-price">
                  {money(config.amountKRW)}
                  <small> / 1인</small>
                </strong>
                <p>
                  {config.open ? "신청 접수 중" : "신청 마감"} · {config.occupied} /{" "}
                  {config.capacity}명 <small>(결제 대기 포함)</small>
                </p>
              </>
            )}
            {event.externalUrl && (
              <a
                className="participation-text-link"
                href={event.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                외부 행사 안내 보기 ↗
              </a>
            )}
          </section>
          <section className="participation-note">
            <ShieldCheck size={22} />
            <div>
              <strong>참가 확정 후 공지방에 자동 참여</strong>
              <p>
                담당자만 공지를 보내고, 참가자는 편하게 읽어요. 유료 신청은 30분 동안 자리를
                예약하며, 결제 확인 후 확정됩니다. 환불은 결제한 플랫폼에서 진행해주세요.
              </p>
            </div>
          </section>
          {paymentMode === "local-test" && (
            <p className="participation-test-note">
              로컬 테스트 모드 · 실제 결제나 정산이 발생하지 않습니다.
            </p>
          )}
          {event.isOwner && (
            <section className="participation-card host-settings">
              <h2>
                <Settings2 size={19} />
                등록자 신청 설정
              </h2>
              <Link className="participation-text-link" href={`/management/events/${event.postId}`}>
                참가 질문 · 일정 · 참가 전적 관리 →
              </Link>
              <p>
                모집글의 비용 안내와 별도로 실제 신청 금액을 설정하세요. 금액 변경은 이후 신청에
                적용됩니다.
              </p>
              <form onSubmit={save}>
                <fieldset className="lifecycle-settings-fields" disabled={busy || cancelled}>
                  <label>
                    참가 금액 (원)
                    <input
                      type="number"
                      min="0"
                      max="10000000"
                      required
                      value={settings.amountKRW}
                      onChange={(e) =>
                        setSettings({ ...settings, amountKRW: Number(e.target.value) })
                      }
                    />
                    <small>0원은 무료 행사입니다.</small>
                  </label>
                  <label>
                    정원
                    <input
                      type="number"
                      min="1"
                      max="5000"
                      required
                      value={settings.capacity}
                      onChange={(e) =>
                        setSettings({ ...settings, capacity: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="participation-checkbox">
                    <input
                      type="checkbox"
                      checked={settings.open}
                      onChange={(e) => setSettings({ ...settings, open: e.target.checked })}
                    />
                    사이트 내 신청 받기
                  </label>
                  <button className="participation-primary" disabled={busy || cancelled}>
                    신청 설정 저장
                  </button>
                </fieldset>
                {cancelled && (
                  <p className="lifecycle-cancelled-note">
                    행사가 취소되어 접수를 다시 열 수 없어요.
                  </p>
                )}
              </form>
              {config && (
                <Link className="participation-text-link" href={`/rooms/${event.postId}`}>
                  공지 작성 · 담당자 · 신청자 관리 →
                </Link>
              )}
            </section>
          )}
        </div>
        <section className="participation-card application-form">
          <h2>{active ? "나의 참가 신청" : "참가 신청하기"}</h2>
          {error && (
            <p role="alert" className="participation-error">
              {error}
            </p>
          )}
          {active ? (
            <div className="application-state">
              <span className={`participation-status ${application.status}`}>
                {STATUS_LABELS[application.status]}
              </span>
              <h3>{application.attendeeName}님의 다음 에피소드</h3>
              <p>{money(application.amountKRW)}</p>
              <SubmittedApplicationDetails
                answers={application.answers}
                note={application.note}
                completed={application.questionnaireCompleted}
              />
              {application.status === "confirmed" ? (
                <>
                  <p>신청이 완료되었어요. 전용 공지방에서 준비물과 행사 안내를 확인하세요.</p>
                  <Link className="participation-primary" href={`/rooms/${event.postId}`}>
                    공지방 입장
                    <Megaphone size={18} />
                  </Link>
                  <EventPrivateContact postId={event.postId} />
                  {!cancelled && (
                    <AdmissionTicket postId={event.postId} applicationId={application.id} />
                  )}
                  {cancelled && (
                    <p className="lifecycle-cancelled-note">
                      주최자가 행사를 취소했어요. QR 입장은 중단되었고, 아래에서 전액 취소·환불을
                      요청할 수 있어요.
                    </p>
                  )}
                </>
              ) : application.status === "pending_payment" ? (
                <>
                  <p>결제 완료 알림을 받은 뒤 참가가 확정됩니다.</p>
                  <small>
                    결제 기한: {formatKoreanDateTime(application.expiresAt) || "확인 중"}
                  </small>
                  <button
                    className="participation-primary"
                    disabled={busy || cancelled || paymentMode === "unavailable"}
                    onClick={() => {
                      void pay();
                    }}
                  >
                    {busy
                      ? "확인 중…"
                      : paymentMode === "local-test"
                        ? "테스트 결제 확인 (실제 결제 없음)"
                        : "외부 플랫폼에서 결제하기"}
                    <ArrowRight size={17} />
                  </button>
                </>
              ) : (
                <p>
                  취소 또는 기한 만료 후 결제가 확인되었어요. 담당자에게 확인·환불을 요청해주세요.
                  공지방에는 아직 참여하지 않았어요.
                </p>
              )}
              {application.status === "pending_payment" ||
              (application.status === "confirmed" && application.amountKRW === 0) ? (
                <button
                  className="participation-secondary"
                  disabled={busy}
                  onClick={() => {
                    void work(async () =>
                      setEvent(
                        await request<EventOverview>(`/applications/${application.id}`, "DELETE"),
                      ),
                    );
                  }}
                >
                  신청 취소
                </button>
              ) : (
                application.status === "confirmed" && (
                  <p className="participation-muted">
                    취소·환불은 결제한 외부 플랫폼에서 요청해주세요.
                  </p>
                )
              )}
            </div>
          ) : cancelled ? (
            <p className="lifecycle-cancelled-note">
              주최자가 행사를 취소하여 새 참가 신청을 받지 않아요.
            </p>
          ) : !event.canApply ? (
            <div className="participation-empty">
              <p>로그인 후 참가 신청할 수 있어요.</p>
              <Link
                className="participation-primary"
                href={`/login?returnTo=${encodeURIComponent(`/events/${event.postId}`)}`}
              >
                로그인 안내
              </Link>
            </div>
          ) : !event.applicantProfile?.ready ? (
            <ApplicantProfileSummary profile={event.applicantProfile} postId={event.postId} />
          ) : !config ? (
            <p className="participation-muted">
              등록자가 사이트 내 신청을 준비 중이에요.
              {event.isOwner
                ? " 왼쪽의 신청 설정을 저장하면 신청 화면이 열립니다."
                : " 잠시 후 다시 확인해주세요."}
            </p>
          ) : !config.open || config.occupied >= config.capacity ? (
            <p className="participation-muted">현재 신청이 마감되었어요.</p>
          ) : (
            <form onSubmit={apply}>
              {application && (
                <p className="participation-muted">
                  이전 신청: {STATUS_LABELS[application.status]}
                </p>
              )}
              <ApplicantProfileSummary profile={event.applicantProfile} postId={event.postId} />
              <ApplicationQuestionFields
                questions={config.questions}
                answers={draft.answers}
                onChange={(answers) => setDraft({ ...draft, answers })}
                disabled={busy}
              />
              <label>
                참가 요청사항 <small>선택</small>
                <textarea
                  maxLength={500}
                  rows={3}
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="참가와 관련된 요청사항을 적어주세요"
                />
              </label>
              <label className="participation-checkbox">
                <input
                  required
                  type="checkbox"
                  checked={draft.consent}
                  onChange={(e) => setDraft({ ...draft, consent: e.target.checked })}
                />
                <span>
                  행사 진행 및 연락을 위해 등록된 닉네임·연락처와 질문 답변·요청사항을 이 행사
                  담당자에게 제공하는 데 동의합니다.
                </span>
              </label>
              {config?.startsAt && config.amountKRW > 0 && (
                <label className="participation-checkbox">
                  <input
                    type="checkbox"
                    required
                    checked={draft.refundConsent}
                    onChange={(e) => setDraft({ ...draft, refundConsent: e.target.checked })}
                  />
                  한국 날짜 기준 환불 정책(5일 전까지 100%, 이후 하루마다 20% 차감)을 확인했어요
                </label>
              )}
              <button
                className="participation-primary"
                disabled={busy || (config.amountKRW > 0 && paymentMode === "unavailable")}
              >
                {busy
                  ? "신청 중…"
                  : config.amountKRW === 0
                    ? "무료 참가 확정하기"
                    : "신청하고 결제로 이동"}
                <ArrowRight size={17} />
              </button>
              <small className="participation-muted">
                {config.amountKRW === 0
                  ? "신청 후 바로 전용 공지방에 참여할 수 있어요."
                  : paymentMode === "unavailable"
                    ? "결제 플랫폼 연결 준비 중입니다."
                    : "신청 후 결제 버튼을 눌러 결제를 진행해주세요."}
              </small>
            </form>
          )}
        </section>
      </div>
      <RecordBacklink postId={event.postId} />
      <VerifiedEventReviews postId={event.postId} />
      <RefundPanel
        postId={event.postId}
        startsAt={config?.startsAt}
        refreshRevision={lifecycleRevision}
      />
    </ParticipationShell>
  );
}
