"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { REFUND_STEPS, type RefundView, type RefundRequestView } from "@/domain/refund";
import type { RefundCause } from "@/domain/event-lifecycle";
import { participationRequest as request } from "@/lib/participation-client";
import { RequestError } from "@/lib/api-client";
const causeLabel = (cause?: RefundCause) =>
  cause === "host_cancel"
    ? "주최자 행사 취소 · 전액 기준"
    : cause === "schedule_change"
      ? "일정 변경 미동의 · 전액 기준"
      : "참가자 사정 취소";
export function RefundPolicy({
  startsAt,
  cause,
}: {
  startsAt?: string | null | undefined;
  cause?: RefundCause | undefined;
}) {
  const hostChange = cause === "host_cancel" || cause === "schedule_change";
  return (
    <section className="participation-card refund-policy">
      <h2>{hostChange ? "주최자 변경에 따른 취소·환불" : "참가자 사정 취소·환불 기준"}</h2>
      <p>
        {hostChange
          ? cause === "host_cancel"
            ? "주최자가 취소한 행사에는 기존 날짜별 차감 규칙을 적용하지 않습니다. 결제 금액 전액으로 취소·환불을 요청할 수 있어요."
            : "주최자가 일정을 변경하여 참여하기 어려우면, 변경된 행사 시작 전까지 날짜별 차감 없이 전액 취소·환불을 요청할 수 있어요."
          : "한국 시간의 달력 날짜 기준으로 행사 5일 전까지 전액 환불, 이후 하루마다 20%씩 차감합니다."}
      </p>
      {!hostChange && (
        <div className="refund-steps">
          {REFUND_STEPS.map((step) => (
            <div key={step.days}>
              <span>{step.days}</span>
              <strong>{step.rate}%</strong>
            </div>
          ))}
        </div>
      )}
      {!hostChange && (
        <p className="participation-muted">
          주최자 행사 취소 또는 일정 변경에 따른 취소 요청에는 전액 환불 기준이 적용돼요.
        </p>
      )}
      <small>
        {startsAt
          ? `행사 시작: ${new Date(startsAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 원 단위 미만은 버립니다.`
          : "시작일이 지정되지 않은 기존 행사는 담당자에게 환불 기준을 문의해주세요."}
      </small>
      <p className="participation-muted">
        외부 플랫폼의 환불 처리가 완료되면 참가와 공지방 참여가 종료돼요. 금액은 요청한 날짜의
        기준으로 기록됩니다.
      </p>
    </section>
  );
}
export function RefundPanel({
  postId,
  startsAt,
  manage = false,
  refreshRevision = 0,
}: {
  postId: string;
  startsAt?: string | null | undefined;
  manage?: boolean;
  refreshRevision?: number;
}) {
  const [data, setData] = useState<RefundView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [selected, setSelected] = useState<RefundRequestView | null>(null),
    [checked, setChecked] = useState(false),
    [note, setNote] = useState("");
  const epoch = useRef(0),
    gate = useRef(false),
    loaded = useRef(false),
    base = `/events/${postId}/refunds?manage=${manage ? 1 : 0}`;
  const denied = (e: unknown) =>
    e instanceof RequestError &&
    ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(e.code ?? "");
  async function load(cursor?: string, retainOlder = false) {
    const ticket = ++epoch.current;
    try {
      const next = await request<RefundView>(
        base + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
      );
      if (ticket === epoch.current)
        setData((prev) =>
          retainOlder && prev
            ? {
                ...next,
                requests: prev.requests.map(
                  (item) => next.requests.find((updated) => updated.id === item.id) ?? item,
                ),
                nextCursor: prev.nextCursor,
              }
            : cursor && prev
              ? { ...next, requests: [...prev.requests, ...next.requests] }
              : next,
        );
    } catch (e) {
      if (denied(e)) {
        epoch.current++;
        setData(null);
        setSelected(null);
      }
      throw e;
    }
  }
  useEffect(() => {
    loaded.current = false;
    void load().catch(() => {});
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !gate.current)
        void load(undefined, loaded.current).catch(() => {});
    }, 15000);
    return () => {
      epoch.current++;
      clearInterval(timer);
    };
  }, [base, refreshRevision]);
  async function work(fn: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    epoch.current++;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (denied(e)) {
        epoch.current++;
        setData(null);
        setSelected(null);
      }
      setError(e instanceof Error ? e.message : "다시 시도해주세요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!data?.applicationId) return;
    void work(async () => {
      setData(
        await request<RefundView>(`/events/${postId}/refunds`, "POST", {
          applicationId: data.applicationId,
          reason,
        }),
      );
      setReason("");
    });
  }
  function resolve(e: FormEvent, decision: "complete" | "reject") {
    e.preventDefault();
    if (!selected) return;
    void work(async () => {
      await request(`/refunds/${selected.id}/resolve`, "PUT", {
        decision,
        externalRefundChecked: checked,
        ...(decision === "complete" ? { actualRefundKRW: selected.refundableKRW } : {}),
        reason: note,
      });
      setSelected(null);
      loaded.current = false;
      await load();
    });
  }
  return (
    <div className="refund-panel">
      <RefundPolicy startsAt={startsAt ?? data?.startsAt} cause={data?.cause} />
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <section className="participation-card">
          <div className="dashboard-section-heading">
            <h2>{manage ? "취소·환불 요청 관리" : "나의 취소·환불 요청"}</h2>
            <button
              className="participation-secondary"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  loaded.current = false;
                  await load();
                })
              }
            >
              <RefreshCw size={14} />
              새로고침
            </button>
          </div>
          {!manage && data.cause && data.cause !== "participant" && (
            <span className="refund-cause">{causeLabel(data.cause)}</span>
          )}
          {!manage && data.quote && (
            <p className="refund-quote">
              오늘 요청 시 예상 환불{" "}
              <strong>
                {data.quote.refundableKRW.toLocaleString("ko-KR")}원 ({data.quote.rate}%)
              </strong>
            </p>
          )}
          {!manage && data.canRequest && (
            <form className="refund-form" onSubmit={submit}>
              <label>
                취소 사유
                <textarea
                  required
                  minLength={2}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <p>
                요청만으로 결제·참가가 취소되지 않습니다. 담당자가 외부 플랫폼에서 처리한 후
                완료돼요.
              </p>
              <button disabled={busy} className="participation-secondary">
                취소·환불 요청
              </button>
            </form>
          )}
          {data.requests.map((item) => (
            <article className="marketplace-request" key={item.id}>
              <strong>
                {manage ? item.attendeeName : "나의 요청"} ·{" "}
                {item.state === "pending"
                  ? "처리 대기"
                  : item.state === "completed"
                    ? "취소·환불 처리 완료"
                    : "담당자 확인 필요"}
              </strong>
              <span className="refund-cause">{causeLabel(item.cause)}</span>
              <p>
                요청일{" "}
                {new Date(item.requestedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} ·
                기준 {item.rate}% · {item.refundableKRW.toLocaleString("ko-KR")}원
              </p>
              {item.actualRefundKRW !== null && (
                <p>실제 환불 확인: {item.actualRefundKRW.toLocaleString("ko-KR")}원</p>
              )}
              <p>{item.reason}</p>
              {item.decisionNote && <small>{item.decisionNote}</small>}
              {manage && item.state === "pending" && (
                <button
                  className="participation-secondary"
                  disabled={busy}
                  onClick={() => {
                    setSelected(item);
                    setChecked(false);
                    setNote("");
                  }}
                >
                  처리하기
                </button>
              )}
            </article>
          ))}
          {!data.requests.length && (
            <p className="participation-muted">접수된 취소·환불 요청이 없어요.</p>
          )}
          {data.nextCursor && (
            <button
              className="participation-secondary"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  loaded.current = true;
                  await load(data.nextCursor!);
                })
              }
            >
              이전 요청 더 보기
            </button>
          )}
          {selected && (
            <form className="refund-form" onSubmit={(e) => resolve(e, "complete")}>
              <h3>{selected.attendeeName}님의 요청 처리</h3>
              <p>
                외부 플랫폼에서 {selected.refundableKRW.toLocaleString("ko-KR")}원 환불과 참가
                취소를 먼저 처리해주세요. 0원인 경우 금전 환불 없이 참가 취소를 확인합니다.
              </p>
              <label className="participation-checkbox">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                외부 플랫폼에서 위 금액으로 취소·환불 처리를 완료했어요
              </label>
              <label>
                처리 메모·반려 사유
                <textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="marketplace-actions">
                <button disabled={busy || !checked} className="participation-primary">
                  완료 확인
                </button>
                <button
                  type="button"
                  disabled={busy || !note.trim()}
                  className="participation-secondary"
                  onClick={(e) => resolve(e, "reject")}
                >
                  사유와 함께 반려
                </button>
                <button
                  type="button"
                  className="participation-secondary"
                  onClick={() => setSelected(null)}
                >
                  닫기
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
