"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import {
  PAYMENT_ISSUE_LABELS,
  type PaymentReconciliation,
  type PaymentIssue,
} from "@/domain/event-operations";
import { STATUS_LABELS, type ApplicationStatus } from "@/domain/participation";
import { appRequest } from "@/lib/api-client";
import { ParticipationShell } from "./participation-shell";
export function PaymentReconciliationPanel({ initial }: { initial: PaymentReconciliation }) {
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const gate = useRef(false),
    base = `/api/participation/events/${initial.postId}/payment-review`;
  async function refresh(page = data.page) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      setData(await appRequest<PaymentReconciliation>(`${base}?page=${page}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "내역을 불러오지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function note(event: FormEvent<HTMLFormElement>, item: PaymentIssue) {
    event.preventDefault();
    if (gate.current) return;
    const form = event.currentTarget,
      fields = new FormData(form);
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await appRequest(base, "POST", {
        applicationId: item.applicationId,
        fingerprint: item.fingerprint,
        note: fields.get("note"),
      });
      setData(await appRequest<PaymentReconciliation>(`${base}?page=${data.page}`));
      setNotice("확인 내용을 기록했어요. 참가·결제 상태가 달라지면 새로운 검토 건으로 표시돼요.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "기록하지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <ParticipationShell>
      <div className="ops-page">
        <header className="ops-heading">
          <div>
            <span className="ops-eyebrow">PAYMENT RECONCILIATION</span>
            <h1>{data.title}</h1>
            <p>결제 확인과 참가·환불 상태를 함께 확인하세요.</p>
          </div>
          <Link className="participation-secondary" href={`/management/events/${data.postId}`}>
            행사 관리
          </Link>
        </header>
        <section className="participation-card ops-card">
          <div className="ops-section-heading">
            <h2>
              <ClipboardCheck size={18} />
              결제 예외 · 처리 대기
            </h2>
            <button
              className="participation-secondary"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} />
              갱신
            </button>
          </div>
          <p className="ops-note">
            검증된 결제 내역과 신청 상태를 비교합니다. 확인 기록만으로 참가가 승인되거나 실제 환불이
            실행되지는 않아요.
          </p>
          {error && (
            <p className="participation-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="ops-success" role="status">
              {notice}
            </p>
          )}
          {!data.items.length && (
            <div className="ops-empty">
              <ClipboardCheck size={28} />
              <h3>확인할 결제 예외가 없어요</h3>
              <p>새로운 상태 불일치나 환불 요청이 생기면 여기에 표시됩니다.</p>
            </div>
          )}
          {data.items.map((item) => (
            <article className="ops-payment-entry" key={item.applicationId}>
              <div className="ops-section-heading">
                <h3>{item.attendeeName}</h3>
                <span className="ops-status">
                  {item.notes.length ? "검토 기록 있음" : "확인 필요"}
                </span>
              </div>
              <div className="ops-tags">
                {item.issues.map((issue) => (
                  <span key={issue}>{PAYMENT_ISSUE_LABELS[issue]}</span>
                ))}
              </div>
              <dl className="ops-payment-facts">
                <div>
                  <dt>참가 상태</dt>
                  <dd>
                    {STATUS_LABELS[item.applicationStatus as ApplicationStatus] ??
                      item.applicationStatus}
                  </dd>
                </div>
                <div>
                  <dt>신청 금액</dt>
                  <dd>{item.amountKRW.toLocaleString("ko-KR")}원</dd>
                </div>
                <div>
                  <dt>결제 확인</dt>
                  <dd>
                    {item.paymentState === "paid"
                      ? "결제 확인"
                      : item.paymentState === "refunded"
                        ? "환불 확인"
                        : "미확인"}{" "}
                    · {item.provider ?? "연동 내역 없음"}
                  </dd>
                </div>
                {item.reference && (
                  <div>
                    <dt>외부 주문·결제 번호</dt>
                    <dd>{item.reference}</dd>
                  </div>
                )}
                {item.pendingRefundKRW !== null && (
                  <div>
                    <dt>요청 기준 환불액</dt>
                    <dd>{item.pendingRefundKRW.toLocaleString("ko-KR")}원</dd>
                  </div>
                )}
              </dl>
              <div className="ops-actions">
                <Link
                  className="participation-secondary"
                  href={`/management/events/${data.postId}`}
                >
                  참가 승인·환불 관리로 이동
                </Link>
              </div>
              {item.notes.map((entry, index) => (
                <div className="ops-review-note" key={`${entry.createdAt}-${index}`}>
                  <small>{new Date(entry.createdAt).toLocaleString("ko-KR")}</small>
                  <p>{entry.note}</p>
                </div>
              ))}
              <form onSubmit={(event) => void note(event, item)}>
                <label>
                  외부 플랫폼에서 확인한 내용
                  <textarea
                    name="note"
                    rows={2}
                    minLength={5}
                    maxLength={1000}
                    required
                    placeholder="확인한 주문·정원·환불 상태와 다음 조치를 적어주세요."
                  />
                </label>
                <button type="submit" className="participation-secondary" disabled={busy}>
                  확인 기록 남기기
                </button>
              </form>
            </article>
          ))}
          <div className="ops-pagination">
            <button
              className="participation-secondary"
              disabled={busy || data.page === 1}
              onClick={() => void refresh(data.page - 1)}
            >
              이전
            </button>
            <span>{data.page}</span>
            <button
              className="participation-secondary"
              disabled={busy || !data.hasMore}
              onClick={() => void refresh(data.page + 1)}
            >
              다음
            </button>
          </div>
        </section>
      </div>
    </ParticipationShell>
  );
}
