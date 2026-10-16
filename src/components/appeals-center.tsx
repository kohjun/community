"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import {
  APPEAL_ACTION_LABELS,
  APPEAL_SCOPE_LABELS,
  type AppealAction,
  type AppealOriginalAction,
  type AppealPage,
  type AppealSubmission,
} from "@/domain/appeals";
import { appRequest, RequestError } from "@/lib/api-client";
import { ParticipationShell } from "./participation-shell";

const TICKET_LABELS = { open: "검토 요청 접수", answered: "답변 완료", closed: "검토 완료" };
const date = (value: string) =>
  new Date(value).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const accessDenied = (cause: unknown) =>
  cause instanceof RequestError &&
  ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(cause.code ?? "");

export function AppealActionSummary({
  action,
  href,
}: {
  action: AppealOriginalAction;
  href?: string;
}) {
  return (
    <div className="appeals-action-summary">
      <div className="appeals-action-heading">
        <strong>{APPEAL_ACTION_LABELS[action.type]}</strong>
        <span>
          {APPEAL_SCOPE_LABELS[action.scope as keyof typeof APPEAL_SCOPE_LABELS] ?? action.scope}
        </span>
        <time dateTime={action.createdAt}>{date(action.createdAt)}</time>
      </div>
      <p>{action.reason}</p>
      {href && (
        <Link href={href}>
          대상 조치와 신청 내역 확인
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

export function AppealActionCard({
  action,
  busy = false,
  onSubmit,
}: {
  action: AppealAction;
  busy?: boolean;
  onSubmit: (action: AppealAction, body: string) => Promise<boolean>;
}) {
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState("");
  const ticket = action.ticket;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (await onSubmit(action, body.trim())) {
      setBody("");
      setWriting(false);
    }
  }
  return (
    <li className="appeals-item" id={"action-" + action.id}>
      <AppealActionSummary action={action} />
      {ticket ? (
        <div className="appeals-ticket">
          <div className="appeals-ticket-heading">
            <span className={"appeals-status is-" + ticket.status}>
              {TICKET_LABELS[ticket.status]}
            </span>
            <span>최종 변경 {date(ticket.updatedAt)}</span>
          </div>
          <details className="appeals-history">
            <summary>이의신청 내역·답변 보기</summary>
            <div className="appeals-message">
              <strong>나의 이의신청</strong>
              <p>{ticket.body}</p>
              <time dateTime={ticket.createdAt}>{date(ticket.createdAt)}</time>
            </div>
            {ticket.replies.map((reply) => (
              <div
                className={"appeals-message" + (reply.role === "staff" ? " is-staff" : "")}
                key={reply.id}
              >
                <strong>{reply.role === "staff" ? "운영팀 답변" : "나의 추가 의견"}</strong>
                <p>{reply.body}</p>
                <time dateTime={reply.createdAt}>{date(reply.createdAt)}</time>
              </div>
            ))}
          </details>
          <p className="appeals-item-note">
            추가 의견은 같은 신청 내역에 이어지고 재검토를 요청해요.
          </p>
        </div>
      ) : (
        <p className="appeals-item-note">
          검토가 필요한 이유를 적어 이 조치에 대한 이의신청을 보낼 수 있어요.
        </p>
      )}
      {!writing ? (
        <button
          type="button"
          className="appeals-primary"
          disabled={busy}
          onClick={() => setWriting(true)}
        >
          {ticket ? "추가 의견 작성" : "이의신청 작성"}
        </button>
      ) : (
        <form className="appeals-form" onSubmit={(event) => void submit(event)}>
          <label>
            {ticket ? "추가 의견" : "이의신청 내용"}
            <textarea
              name="body"
              minLength={10}
              maxLength={3000}
              rows={4}
              required
              value={body}
              disabled={busy}
              onChange={(event) => setBody(event.target.value)}
              placeholder="검토가 필요한 이유와 확인할 내용을 구체적으로 적어주세요."
            />
          </label>
          <p>10~3,000자 · 신고자나 다른 회원의 개인정보, 비밀번호는 적지 마세요.</p>
          <div className="appeals-form-actions">
            <button
              type="submit"
              className="appeals-primary"
              disabled={busy || body.trim().length < 10}
            >
              {ticket ? "같은 신청에 의견 보내기" : "이의신청 접수"}
            </button>
            <button type="button" disabled={busy} onClick={() => setWriting(false)}>
              돌아가기
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function AppealsUnavailable({
  message,
  login = false,
}: {
  message: string;
  login?: boolean;
}) {
  return (
    <ParticipationShell advertising={false}>
      <section className="appeals-page appeals-empty">
        <h1>내 운영 조치와 이의신청</h1>
        <p>{message}</p>
        <Link
          className="appeals-button"
          href={login ? "/login?returnTo=/settings/appeals" : "/settings/account"}
        >
          {login ? "로그인하고 확인하기" : "계정·안전 설정으로"}
        </Link>
      </section>
    </ParticipationShell>
  );
}

export function AppealsCenter({
  initial,
  initialActionId = null,
}: {
  initial: AppealPage;
  initialActionId?: string | null;
}) {
  const [data, setData] = useState(initial);
  const [actionId, setActionId] = useState(initialActionId);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const submissionGate = useRef(false);
  const currentQuery = useRef({ page: initial.page, actionId: initialActionId });
  const failedQuery = useRef<typeof currentQuery.current | null>(null);
  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    submissionGate.current = false;
    currentQuery.current = { page: initial.page, actionId: initialActionId };
    failedQuery.current = null;
    setData(initial);
    setActionId(initialActionId);
    setLoading(false);
    setSubmitting(false);
    setError("");
    setNotice("");
    setUnavailable(false);
    setRefreshRequired(false);
    return () => activeRequest.current?.abort();
  }, [initial, initialActionId]);
  const isCurrent = (controller: AbortController) =>
    !controller.signal.aborted && activeRequest.current === controller;
  async function fetchPage(query: typeof currentQuery.current, controller: AbortController) {
    const params = new URLSearchParams({ page: String(query.page) });
    if (query.actionId) params.set("actionId", query.actionId);
    return appRequest<AppealPage>(
      "/api/safety/appeals?" + params,
      "GET",
      undefined,
      controller.signal,
    );
  }
  function apply(next: AppealPage, query: typeof currentQuery.current) {
    currentQuery.current = { ...query, page: next.page };
    failedQuery.current = null;
    setData(next);
    setActionId(query.actionId);
    setRefreshRequired(false);
    const params = new URLSearchParams({ page: String(next.page) });
    if (query.actionId) params.set("actionId", query.actionId);
    window.history.replaceState(
      null,
      "",
      "/settings/appeals?" + params + (query.actionId ? "#action-" + query.actionId : ""),
    );
  }
  async function load(query: typeof currentQuery.current) {
    if (submissionGate.current) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const next = await fetchPage(query, controller);
      if (isCurrent(controller)) apply(next, query);
    } catch (cause) {
      if (!isCurrent(controller)) return;
      failedQuery.current = query;
      setError(cause instanceof Error ? cause.message : "신청 내역을 확인하지 못했어요.");
      if (accessDenied(cause)) setUnavailable(true);
    } finally {
      if (isCurrent(controller)) setLoading(false);
    }
  }
  async function submit(action: AppealAction, body: string): Promise<boolean> {
    if (
      submissionGate.current ||
      loading ||
      refreshRequired ||
      body.length < 10 ||
      body.length > 3000
    )
      return false;
    submissionGate.current = true;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result = await appRequest<AppealSubmission>(
        "/api/safety/appeals",
        "POST",
        action.ticket
          ? {
              mode: "followup",
              ticketId: action.ticket.id,
              expectedRevision: action.ticket.revision,
              body,
            }
          : { mode: "open", actionId: action.id, body },
        controller.signal,
      );
      if (!isCurrent(controller)) return false;
      const next = await fetchPage(currentQuery.current, controller);
      if (!isCurrent(controller)) return false;
      apply(next, currentQuery.current);
      setNotice(
        result.reused
          ? "이미 접수된 같은 조치의 신청 내역을 불러왔어요. 작성한 내용은 추가 의견으로 보낼 수 있어요."
          : action.ticket
            ? "같은 신청 내역에 추가 의견을 남기고 재검토를 요청했어요."
            : "이의신청을 접수했어요. 같은 내역에서 처리 상태와 답변을 확인할 수 있어요.",
      );
      return !result.reused;
    } catch (cause) {
      if (!isCurrent(controller)) return false;
      setError(
        cause instanceof Error
          ? cause.message
          : "접수 결과를 확인하지 못했어요. 먼저 내역을 다시 조회해주세요.",
      );
      setRefreshRequired(true);
      if (accessDenied(cause)) setUnavailable(true);
      else if (cause instanceof RequestError && cause.code === "CONFLICT") {
        try {
          const next = await fetchPage(currentQuery.current, controller);
          if (isCurrent(controller)) {
            apply(next, currentQuery.current);
            setNotice(
              "다른 곳에서 변경된 최신 신청 내역을 불러왔어요. 확인한 후 추가 의견을 보내주세요.",
            );
          }
        } catch (refreshError) {
          if (isCurrent(controller) && accessDenied(refreshError)) setUnavailable(true);
        }
      }
      return false;
    } finally {
      if (isCurrent(controller)) {
        submissionGate.current = false;
        setSubmitting(false);
      }
    }
  }
  const busy = loading || submitting || refreshRequired;
  const first = Math.max(1, Math.min(data.page - 2, data.pageCount - 4));
  const pages = Array.from({ length: Math.min(5, data.pageCount) }, (_, index) => first + index);
  return (
    <ParticipationShell advertising={false}>
      <section className="appeals-page">
        <nav className="appeals-links" aria-label="계정과 도움">
          <Link href="/settings/account">계정·안전 설정</Link>
          <Link href="/support">일반 문의</Link>
        </nav>
        <header className="appeals-heading">
          <div>
            <span>계정과 안전</span>
            <h1>내 운영 조치와 이의신청</h1>
            <p>본인에게 적용된 조치를 확인하고 검토가 필요한 의견을 남겨주세요.</p>
          </div>
          <button
            type="button"
            disabled={loading || submitting || unavailable}
            onClick={() => void load(currentQuery.current)}
          >
            <RefreshCw size={14} aria-hidden="true" />
            새로고침
          </button>
        </header>
        <div className="appeals-policy">
          <p>
            아래 사유는 조치 유형을 안내하는 요약이에요. 신고 원문과 상세 운영 메모는 공개하지
            않아요.
          </p>
          <p>
            이의신청은 원래 조치한 담당자와 분리해서 검토하며, 접수만으로 기존 조치가 바로
            해제되지는 않아요. 이용 제한 중에도 본인 조치와 신청 내역을 확인할 수 있어요.
          </p>
        </div>
        {unavailable ? (
          <div className="appeals-empty">
            <h2>신청 내역을 열 수 없어요</h2>
            <p>로그인과 계정 상태를 확인해주세요. 탈퇴한 계정은 이의신청을 이용할 수 없어요.</p>
            <Link className="appeals-button" href="/settings/account">
              계정·안전 설정 확인
            </Link>
          </div>
        ) : (
          <>
            <div className="appeals-list-heading">
              <span>
                {actionId ? "선택한 대상 조치" : "나의 조치 내역"} · {data.total}건
              </span>
              {actionId && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void load({ page: 1, actionId: null })}
                >
                  전체 조치 보기
                </button>
              )}
            </div>
            {error && (
              <div className="appeals-error" role="alert">
                <p>
                  {error}
                  {refreshRequired
                    ? " 최신 내용을 확인한 후 다시 접수할 수 있어요."
                    : " 현재 내역은 유지하고 있어요."}
                </p>
                <button
                  type="button"
                  disabled={loading || submitting}
                  onClick={() => void load(failedQuery.current ?? currentQuery.current)}
                >
                  다시 조회
                </button>
              </div>
            )}
            {notice && (
              <p className="appeals-notice" role="status">
                {notice}
              </p>
            )}
            {(loading || submitting) && (
              <p className="appeals-loading" role="status">
                {submitting
                  ? "접수 결과와 최신 내역을 확인하고 있어요."
                  : "내역을 확인하고 있어요."}
              </p>
            )}
            {data.items.length ? (
              <ul className="appeals-list" aria-busy={loading || submitting}>
                {data.items.map((action) => (
                  <AppealActionCard key={action.id} action={action} busy={busy} onSubmit={submit} />
                ))}
              </ul>
            ) : (
              <div className="appeals-empty">
                <h2>이의신청 대상 조치가 없어요</h2>
                <p>
                  본인에게 적용된 경고, 이용 제한이나 콘텐츠 숨김 조치가 이곳에 표시돼요. 다른
                  도움은 일반 문의로 요청해주세요.
                </p>
                <Link className="appeals-button" href="/support">
                  일반 문의로 이동
                </Link>
              </div>
            )}
            {data.pageCount > 1 && (
              <nav className="appeals-pagination" aria-label="운영 조치 페이지">
                <button
                  type="button"
                  aria-label="이전 페이지"
                  disabled={busy || data.page <= 1}
                  onClick={() => void load({ page: data.page - 1, actionId })}
                >
                  <ChevronLeft size={16} />
                </button>
                {pages.map((page) => (
                  <button
                    type="button"
                    key={page}
                    disabled={busy || page === data.page}
                    aria-current={page === data.page ? "page" : undefined}
                    onClick={() => void load({ page, actionId })}
                  >
                    {page}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="다음 페이지"
                  disabled={busy || data.page >= data.pageCount}
                  onClick={() => void load({ page: data.page + 1, actionId })}
                >
                  <ChevronRight size={16} />
                </button>
                <span>
                  {data.page} / {data.pageCount} · 20개씩 보기
                </span>
              </nav>
            )}
          </>
        )}
      </section>
    </ParticipationShell>
  );
}
