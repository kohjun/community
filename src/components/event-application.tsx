"use client";
import { naverPlaceLink } from "@/lib/naver-maps";
import { loginHref } from "@/domain/login-return";
import { WaitlistPanel } from "./waitlist-panel";
import type { WaitlistView } from "@/domain/community-growth";
import { applicationAccepting } from "@/domain/participation-availability";
import { ParticipantGuideCard } from "./participant-guide";
import { notifyPushOnboardingMoment } from "@/lib/push-onboarding-events";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  CalendarDays,
  MapPin,
  ShieldCheck,
  Ticket,
  Wallet,
  Megaphone,
  ArrowRight,
  ArrowLeft,
  Settings2,
  Users,
  Clock3,
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
  const [waitlist, setWaitlist] = useState<WaitlistView | null>(null);
  const waitlistRefresh = useRef<AbortController | null>(null);
  useEffect(() => () => waitlistRefresh.current?.abort(), []);
  const waitlistChanged = useCallback(
    (next: WaitlistView) => {
      setWaitlist(next);
      waitlistRefresh.current?.abort();
      if (gate.current) return;
      const abort = new AbortController();
      waitlistRefresh.current = abort;
      void request<EventOverview>(`/events/${initial.postId}`, "GET", undefined, abort.signal)
        .then((latest) => {
          if (!abort.signal.aborted && !gate.current) setEvent(latest);
        })
        .catch(() => {});
    },
    [initial.postId],
  );
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
  const lightning = config?.meetupType === "lightning" && !event.externalUrl;
  const paid = !lightning && (config?.amountKRW ?? 0) > 0;
  const active =
    !!application &&
    ["pending_payment", "pending_approval", "confirmed", "review"].includes(application.status);
  useEffect(() => {
    if (application?.status !== "confirmed") return;
    const timer = setTimeout(() => notifyPushOnboardingMoment("participation"), 0);
    return () => clearTimeout(timer);
  }, [application?.status]);
  useEffect(() => {
    if (
      !application ||
      !["pending_payment", "pending_approval"].includes(application.status) ||
      busy
    )
      return;
    const abort = new AbortController();
    const refresh = () => {
      if (document.visibilityState === "visible" && !gate.current)
        void request<EventOverview>(`/events/${event.postId}`, "GET", undefined, abort.signal)
          .then((next) => {
            if (!abort.signal.aborted) setEvent(next);
          })
          .catch(() => {});
    };
    const timer = setInterval(refresh, application.status === "pending_payment" ? 3000 : 15000);
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
      } catch (cause) {
        if (cause instanceof RequestError && cause.code === "CONFLICT") {
          const latest = await request<EventOverview>(`/events/${event.postId}`).catch(() => null);
          if (latest) setEvent(latest);
        }
        throw cause;
      }
    });
  }
  function save(e: FormEvent) {
    e.preventDefault();
    void work(async () =>
      setEvent(
        await request<EventOverview>(`/events/${event.postId}/settings`, "PUT", {
          ...settings,
          ...(lightning ? { amountKRW: 0, approvalMode: "manual" } : {}),
        }),
      ),
    );
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
  return (
    <ParticipationShell>
      <div className="participation-workspace participation-flow">
        <header className="participation-heading">
          <Link className="participation-flow-back" href={`/posts/${event.postId}`}>
            <ArrowLeft size={15} /> 모집글 보기
          </Link>
          <span>{lightning ? "번개 참가 신청" : "모임 참가 신청"}</span>
          <h1>{event.title}</h1>
          <p>
            {lightning
              ? "참가를 요청하면 담당자가 확인해요. 승인 후 공지방에서 만나요."
              : paid
                ? "참가 정보를 제출하고 결제를 완료하면 공지방이 열려요."
                : "참가 정보를 확인하고 신청하면 전용 공지방이 열려요."}
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
              <dd>{event.eventDate || "모집글에서 확인해주세요"}</dd>
            </div>
            <div>
              <dt>
                <MapPin size={16} /> 장소
              </dt>
              <dd>
                {event.location || "모집글에서 확인해주세요"}
                {config?.venue && (
                  <a
                    className="location-map-link"
                    href={naverPlaceLink(config.venue, event.location || event.title)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    네이버 지도에서 보기
                  </a>
                )}
              </dd>
            </div>
            <div>
              <dt>
                <Wallet size={16} /> 비용
              </dt>
              <dd>
                {lightning
                  ? "현장에서 함께 정산"
                  : config
                    ? `${money(config.amountKRW)}${paid ? " / 1인" : ""}`
                    : "담당자 안내 확인"}
              </dd>
            </div>
            <div>
              <dt>
                <Users size={16} /> 모집
              </dt>
              <dd>
                {config
                  ? `${config.occupied} / ${config.capacity}명 · ${config.open ? "접수 중" : "접수 마감"}`
                  : "신청 준비 중"}
              </dd>
            </div>
          </dl>
          <p className="participation-flow-method">
            <ShieldCheck size={16} />
            {lightning
              ? "담당자 승인 후 참가 확정 · 사전 결제 없음"
              : paid
                ? "결제 확인 후 참가 확정"
                : "신청 완료 후 바로 참가 확정"}
          </p>
        </section>
        <ParticipantGuideCard guide={event.config?.participantGuide ?? null} />
        {!active && config && !event.externalUrl && (
          <WaitlistPanel postId={event.postId} onChanged={waitlistChanged} />
        )}
        <ol className="participation-steps participation-flow-steps" aria-label="참가 진행 순서">
          <li className={application ? "done" : "current"}>
            <Ticket size={17} />
            <span>01 참가 신청</span>
          </li>
          <li
            className={
              application?.status === "confirmed"
                ? "done"
                : application?.status === "pending_payment" ||
                    application?.status === "pending_approval"
                  ? "current"
                  : ""
            }
          >
            {lightning ? (
              <ShieldCheck size={17} />
            ) : paid ? (
              <Wallet size={17} />
            ) : (
              <Ticket size={17} />
            )}
            <span>02 {lightning ? "담당자 승인" : paid ? "결제 확인" : "참가 확정"}</span>
          </li>
          <li className={application?.status === "confirmed" ? "current" : ""}>
            <Megaphone size={17} />
            <span>03 공지방 입장</span>
          </li>
        </ol>
        {cancelled && (
          <p className="lifecycle-cancelled-note" role="status">
            주최자가 모임을 취소했어요. 새로운 참가 신청은 받지 않아요.
          </p>
        )}
        <section className="participation-card application-form participation-flow-form">
          <div className="participation-flow-form-heading">
            <h2>{active ? "나의 참가 현황" : "참가 정보 확인"}</h2>
            {!active && <p>기본정보는 자동으로 불러와요. 질문 답변과 요청사항만 작성해주세요.</p>}
          </div>
          {error && (
            <p role="alert" className="participation-error">
              {error}
            </p>
          )}
          {active && application ? (
            <div className="application-state" role="status" aria-live="polite">
              <span className={`participation-status ${application.status}`}>
                {lightning && application.status === "rejected"
                  ? "참가 신청 반려"
                  : STATUS_LABELS[application.status]}
              </span>
              <h3>
                {application.status === "pending_approval"
                  ? "참가 요청을 보냈어요"
                  : application.status === "confirmed"
                    ? "함께할 준비가 되었어요"
                    : `${application.attendeeName}님의 참가 신청`}
              </h3>
              {!lightning && <p>{money(application.amountKRW)}</p>}
              {application.status === "confirmed" ? (
                <>
                  <p>
                    {lightning
                      ? "담당자가 참가를 승인했어요. 비용은 모임 현장에서 함께 정산해요."
                      : "참가가 확정되었어요. 공지방에서 준비물과 모임 안내를 확인하세요."}
                  </p>
                  <Link
                    className="participation-primary participation-flow-primary"
                    href={`/rooms/${event.postId}`}
                  >
                    <Megaphone size={18} /> 공지방 입장하기
                  </Link>
                  <EventPrivateContact postId={event.postId} />
                  {!cancelled && !lightning && (
                    <details className="participation-flow-details">
                      <summary>행사 당일 QR 입장권</summary>
                      <AdmissionTicket postId={event.postId} applicationId={application.id} />
                    </details>
                  )}
                  {cancelled && (
                    <p className="lifecycle-cancelled-note">
                      {lightning
                        ? "모임이 취소되었어요. 자세한 내용은 담당자의 공지를 확인해주세요."
                        : "QR 입장이 중단되었어요. 결제한 내역은 아래 취소·환불 안내를 확인해주세요."}
                    </p>
                  )}
                </>
              ) : application.status === "pending_approval" ? (
                <div className="participation-flow-status-note">
                  <Clock3 size={20} />
                  <div>
                    <strong>담당자의 승인을 기다리고 있어요</strong>
                    <p>
                      승인되면 이 화면과 내 신청 내역에 반영되고 전용 공지방이 열려요. 기다리는 동안
                      별도로 결제할 필요는 없어요.
                    </p>
                  </div>
                </div>
              ) : application.status === "pending_payment" ? (
                <>
                  <p>다음 버튼으로 결제를 완료하면 참가가 확정돼요.</p>
                  <small>
                    결제 기한: {formatKoreanDateTime(application.expiresAt) || "확인 중"}
                  </small>
                  <button
                    className="participation-primary participation-flow-primary"
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
                <p>결제 내역에 담당자 확인이 필요해요. 담당자가 확인한 뒤 공지방이 열려요.</p>
              )}
              {application.decisionNote && (
                <p className="dashboard-decision-note">담당자 안내: {application.decisionNote}</p>
              )}
              <SubmittedApplicationDetails
                answers={application.answers}
                note={application.note}
                completed={application.questionnaireCompleted}
              />
              {application.status === "pending_payment" ||
              (lightning && application.status === "pending_approval") ||
              (application.status === "confirmed" && application.amountKRW === 0) ? (
                <button
                  className="participation-text-link"
                  disabled={busy}
                  onClick={() => {
                    void work(async () =>
                      setEvent(
                        await request<EventOverview>(`/applications/${application.id}`, "DELETE"),
                      ),
                    );
                  }}
                >
                  참가 신청 취소
                </button>
              ) : (
                application.status === "confirmed" && (
                  <p className="participation-muted">
                    취소·환불은 결제한 외부 플랫폼에서 요청해주세요.
                  </p>
                )
              )}
              {application.status === "pending_approval" && (
                <Link className="participation-text-link" href="/mypage?tab=events">
                  내 신청 내역 보기 <ArrowRight size={14} />
                </Link>
              )}
            </div>
          ) : cancelled ? (
            <p className="participation-muted">
              취소된 모임이에요. 자세한 안내는 아래 변경·취소 안내에서 확인해주세요.
            </p>
          ) : !event.canApply ? (
            <div className="participation-flow-login">
              <p>로그인 후 참가 신청할 수 있어요.</p>
              <Link className="participation-primary" href={loginHref(`/events/${event.postId}`)}>
                로그인하고 신청하기 <ArrowRight size={16} />
              </Link>
            </div>
          ) : !event.applicantProfile?.ready ? (
            <ApplicantProfileSummary profile={event.applicantProfile} postId={event.postId} />
          ) : !config ? (
            <p className="participation-muted">
              담당자가 신청 접수를 준비하고 있어요.
              {event.isOwner
                ? " 아래 담당자 설정에서 접수를 열어주세요."
                : " 잠시 후 다시 확인해주세요."}
            </p>
          ) : !applicationAccepting(config, waitlist) ? (
            <p className="participation-muted">현재 모집이 마감되었어요.</p>
          ) : (
            <form onSubmit={apply} aria-busy={busy}>
              {application && (
                <p className="participation-muted">
                  이전 신청:{" "}
                  {lightning && application.status === "rejected"
                    ? "참가 신청 반려"
                    : STATUS_LABELS[application.status]}
                  {application.decisionNote && ` · ${application.decisionNote}`}
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
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="담당자에게 미리 전할 내용이 있다면 적어주세요"
                />
              </label>
              <label className="participation-checkbox">
                <input
                  required
                  type="checkbox"
                  checked={draft.consent}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, consent: e.target.checked })}
                />
                <span>
                  모임 진행 및 연락을 위해 등록된 닉네임·연락처와 질문 답변·요청사항을 이 모임
                  담당자에게 제공하는 데 동의합니다.
                </span>
              </label>
              {paid && config.startsAt && (
                <label className="participation-checkbox">
                  <input
                    required
                    type="checkbox"
                    checked={draft.refundConsent}
                    disabled={busy}
                    onChange={(e) => setDraft({ ...draft, refundConsent: e.target.checked })}
                  />
                  한국 날짜 기준 환불 정책(5일 전까지 100%, 이후 하루마다 20% 차감)을 확인했어요
                </label>
              )}
              <button
                className="participation-primary"
                disabled={busy || (paid && paymentMode === "unavailable")}
              >
                {busy
                  ? "신청 중…"
                  : lightning
                    ? "참가 요청 보내기"
                    : paid
                      ? "신청하고 결제하기"
                      : "참가 신청 완료하기"}
                <ArrowRight size={17} />
              </button>
              <small className="participation-muted">
                {lightning
                  ? "담당자 승인 후 공지방에 초대돼요. 비용은 모임 현장에서 함께 정산해요."
                  : !paid
                    ? "신청을 완료하면 바로 공지방에 참여할 수 있어요."
                    : paymentMode === "unavailable"
                      ? "결제 플랫폼 연결 준비 중입니다."
                      : "신청 후 연결된 플랫폼에서 결제를 진행해요."}
              </small>
            </form>
          )}
        </section>
        <section className="participation-note participation-flow-note">
          <Megaphone size={20} />
          <div>
            <strong>모임 안내는 전용 공지방에서</strong>
            <p>
              담당자만 공지를 보내고 참가자는 읽을 수 있어요.{" "}
              {lightning
                ? "승인된 참가자는 자동으로 초대돼요."
                : "참가가 확정되면 자동으로 초대돼요."}
            </p>
          </div>
        </section>
        {paid && paymentMode === "local-test" && (
          <p className="participation-test-note">
            로컬 테스트 모드 · 실제 결제나 정산이 발생하지 않습니다.
          </p>
        )}
        {event.isOwner && (
          <details
            className="participation-card host-settings workspace-disclosure participation-flow-details"
            open={!config}
          >
            <summary>
              <Settings2 size={18} />
              <span>담당자 신청 설정</span>
            </summary>
            <p>
              {lightning
                ? "참가 요청을 확인하고 승인하면 공지방에 초대돼요. 사전 결제는 사용하지 않아요."
                : "참가 금액과 정원을 설정해주세요. 금액 변경은 이후 신청에 적용돼요."}
            </p>
            <form onSubmit={save}>
              <fieldset className="lifecycle-settings-fields" disabled={busy || cancelled}>
                {!lightning && (
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
                )}
                <label>
                  정원
                  <input
                    type="number"
                    min={lightning ? 2 : 1}
                    max={lightning ? 12 : 5000}
                    required
                    value={settings.capacity}
                    onChange={(e) => setSettings({ ...settings, capacity: Number(e.target.value) })}
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
            </form>
            {cancelled && (
              <p className="lifecycle-cancelled-note">취소된 모임은 접수를 다시 열 수 없어요.</p>
            )}
            <Link className="participation-text-link" href={`/management/events/${event.postId}`}>
              참가 요청 승인 · 질문 · 일정 관리 <ArrowRight size={14} />
            </Link>
          </details>
        )}
        {config && (
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
                if (view.cancelledAt) setSettings((previous) => ({ ...previous, open: false }));
                setEvent(await request<EventOverview>(`/events/${event.postId}`));
              }}
            />
          </details>
        )}
        {!lightning && (
          <details className="participation-card workspace-disclosure participation-flow-details">
            <summary>취소 · 환불 안내</summary>
            <RefundPanel
              postId={event.postId}
              startsAt={config?.startsAt}
              refreshRevision={lifecycleRevision}
            />
          </details>
        )}
        <RecordBacklink postId={event.postId} />
        <VerifiedEventReviews postId={event.postId} />
      </div>
    </ParticipationShell>
  );
}
