"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, ChevronRight, Info, RefreshCw } from "lucide-react";
import type { EventLifecycleView, EventChangeView } from "@/domain/event-lifecycle";
import { appRequest, RequestError } from "@/lib/api-client";
import { koreanDateTimeInput, koreanDateTimeISO } from "@/domain/refund";

const parseInput = (value: string) => {
  try {
    return koreanDateTimeISO(value);
  } catch {
    return null;
  }
};
const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "일정 미정";
function ScheduleChange({ change }: { change: EventChangeView }) {
  return (
    <article className="lifecycle-change">
      <div className="lifecycle-change-heading">
        <strong>{change.kind === "cancel" ? "행사 취소 안내" : "일정 변경 안내"}</strong>
        <time dateTime={change.createdAt}>{when(change.createdAt)}</time>
      </div>
      {change.kind === "reschedule" && (
        <div className="lifecycle-schedule-change">
          <span>
            <small>변경 전</small>
            {when(change.beforeStartsAt)}
          </span>
          <ChevronRight size={15} aria-hidden="true" />
          <span>
            <small>변경 후</small>
            {when(change.startsAt)}
            <small>종료 {when(change.endsAt)}</small>
          </span>
        </div>
      )}
      <p>{change.reason}</p>
    </article>
  );
}
export function EventLifecyclePanel({
  postId,
  onChanged,
}: {
  postId: string;
  onChanged?: (view: EventLifecycleView) => void | Promise<void>;
}) {
  const [data, setData] = useState<EventLifecycleView | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [kind, setKind] = useState<"reschedule" | "cancel">("reschedule");
  const [reason, setReason] = useState(""),
    [checked, setChecked] = useState(false);
  const [startsAt, setStartsAt] = useState(""),
    [endsAt, setEndsAt] = useState("");
  const gate = useRef(false),
    epoch = useRef(0),
    seenRevision = useRef<number | null>(null);
  const pageRef = useRef(1);
  const callback = useRef(onChanged);
  callback.current = onChanged;
  const base = `/api/participation/events/${postId}/lifecycle`;
  async function commit(next: EventLifecycleView) {
    setData(next);
    pageRef.current = next.page;
    if (seenRevision.current !== next.revision) {
      seenRevision.current = next.revision;
      setStartsAt(koreanDateTimeInput(next.startsAt));
      setEndsAt(koreanDateTimeInput(next.endsAt));
      await callback.current?.(next);
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    seenRevision.current = null;
    pageRef.current = 1;
    setData(null);
    setError("");
    const read = async () => {
      if (gate.current) return;
      const token = ++epoch.current;
      try {
        const next = await appRequest<EventLifecycleView>(
          `${base}?page=${pageRef.current}`,
          "GET",
          undefined,
          abort.signal,
        );
        if (!abort.signal.aborted && token === epoch.current) {
          setError("");
          await commit(next);
        }
      } catch (cause) {
        if (!abort.signal.aborted && token === epoch.current)
          setError(cause instanceof Error ? cause.message : "행사 안내를 불러오지 못했어요.");
      }
    };
    void read();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, 30000);
    return () => {
      epoch.current++;
      abort.abort();
      clearInterval(timer);
    };
  }, [base]);
  async function load(page = 1) {
    if (gate.current) return;
    gate.current = true;
    epoch.current++;
    setBusy(true);
    setError("");
    try {
      await commit(await appRequest<EventLifecycleView>(`${base}?page=${page}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "다시 불러오지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (gate.current || !data || !checked) return;
    const cleaned = reason.trim();
    if (cleaned.length < 5) {
      setError("변경·취소 사유를 5자 이상 적어주세요.");
      return;
    }
    const nextStart = kind === "reschedule" ? parseInput(startsAt) : null;
    const nextEnd = kind === "reschedule" ? parseInput(endsAt) : null;
    if (
      kind === "reschedule" &&
      (!nextStart ||
        !nextEnd ||
        new Date(nextStart) <= new Date() ||
        new Date(nextEnd) <= new Date(nextStart))
    ) {
      setError(
        "새 시작·종료 일시를 확인해주세요. 시작은 현재보다 이후, 종료는 시작보다 이후여야 해요.",
      );
      return;
    }
    gate.current = true;
    epoch.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await appRequest<EventLifecycleView>(base, "POST", {
        kind,
        reason: cleaned,
        expectedRevision: data.revision,
        confirmed: true,
        ...(kind === "reschedule" ? { startsAt: nextStart, endsAt: nextEnd } : {}),
      });
      setReason("");
      setChecked(false);
      await commit(next);
      setNotice(
        kind === "cancel"
          ? "행사를 취소하고 참가자에게 안내했어요."
          : "일정을 변경하고 기존 참가자에게 안내했어요.",
      );
    } catch (cause) {
      if (
        cause instanceof RequestError &&
        ["CONFLICT", "UNAUTHENTICATED", "FORBIDDEN"].includes(cause.code ?? "")
      ) {
        try {
          await commit(await appRequest<EventLifecycleView>(base));
          if (cause.code === "CONFLICT") setChecked(false);
        } catch {
          /* Keep the original error visible. */
        }
      }
      setError(cause instanceof Error ? cause.message : "변경 내용을 저장하지 못했어요.");
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  if (!data && !error)
    return <p className="lifecycle-loading">행사 일정 안내를 확인하고 있어요.</p>;
  return (
    <section
      className={`participation-card lifecycle-panel${data?.cancelledAt ? " is-cancelled" : ""}`}
    >
      <div className="lifecycle-heading">
        <div>
          <h2>
            <CalendarDays size={18} />
            {data?.cancelledAt ? "취소된 행사" : "행사 일정과 변경 안내"}
          </h2>
          {data && (
            <p>
              {data.cancelledAt ? "행사 접수와 QR 입장이 종료되었어요." : when(data.startsAt)}
              {!data.cancelledAt && data.endsAt && <small>종료 {when(data.endsAt)}</small>}
            </p>
          )}
        </div>
        <button
          type="button"
          className="participation-secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
          <span>새로고침</span>
        </button>
      </div>
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="lifecycle-success" role="status">
          {notice}
        </p>
      )}
      {data && (data.cancelledAt || data.revision > 0) && (
        <p className="lifecycle-information">
          <Info size={16} />
          <span>
            {data.cancelledAt
              ? "주최자 취소에 따른 취소·환불은 기존 차감 규칙 없이 전액 요청할 수 있어요. 아래 취소·환불 요청에서 접수해주세요."
              : "기존 참가 신청은 유지돼요. 변경된 일정에 참여하기 어렵다면 행사 시작 전까지 아래에서 전액 취소·환불을 요청할 수 있어요."}
          </span>
        </p>
      )}
      {data?.changes.length ? (
        <details className="lifecycle-history" open={!!data.cancelledAt}>
          <summary>변경·취소 사유와 기록 확인</summary>
          {data.changes.map((change) => (
            <ScheduleChange key={change.id} change={change} />
          ))}
          {(data.page > 1 || data.hasMore) && (
            <div className="lifecycle-pagination">
              <button
                type="button"
                className="participation-secondary"
                disabled={busy || data.page === 1}
                onClick={() => void load(data.page - 1)}
              >
                이전
              </button>
              <span>{data.page}페이지</span>
              <button
                type="button"
                className="participation-secondary"
                disabled={busy || !data.hasMore}
                onClick={() => void load(data.page + 1)}
              >
                다음
              </button>
            </div>
          )}
        </details>
      ) : null}
      {data?.canManage && !data.cancelledAt && (
        <details className="lifecycle-editor">
          <summary>주최자 일정 변경·행사 취소</summary>
          <p className="lifecycle-help">
            행사 시작 전, 입장 확인된 참가자가 없을 때 변경할 수 있어요. 참가자에게 사유와 변경
            안내가 전달됩니다.
          </p>
          <form onSubmit={(event) => void submit(event)}>
            <fieldset disabled={busy}>
              <label>
                처리 방식
                <select
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as typeof kind);
                    setChecked(false);
                    setNotice("");
                  }}
                >
                  <option value="reschedule">일정 변경 · 참가 유지</option>
                  <option value="cancel">행사 취소 · 전액 취소 요청 허용</option>
                </select>
              </label>
              {kind === "reschedule" && (
                <div className="lifecycle-date-fields">
                  <label>
                    새 시작 일시 · 한국 시간
                    <input
                      type="datetime-local"
                      required
                      value={startsAt}
                      onChange={(event) => setStartsAt(event.target.value)}
                    />
                  </label>
                  <label>
                    새 종료 일시 · 한국 시간
                    <input
                      type="datetime-local"
                      required
                      value={endsAt}
                      onChange={(event) => setEndsAt(event.target.value)}
                    />
                  </label>
                </div>
              )}
              <label>
                {kind === "cancel" ? "취소" : "일정 변경"} 사유
                <textarea
                  required
                  minLength={5}
                  maxLength={500}
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="참가자에게 전달할 사유를 자세히 적어주세요"
                />
              </label>
              <p className="lifecycle-information">
                <Info size={16} />
                <span>
                  {kind === "cancel"
                    ? "취소하면 접수와 QR 입장이 중단되고 되돌릴 수 없어요. 외부 플랫폼의 접수 종료와 환불은 별도로 처리해주세요."
                    : "참가와 공지방은 유지하고 기존 입장권은 무효화해요. 변경에 동의하지 않는 참가자는 전액 취소·환불을 요청할 수 있어요."}
                </span>
              </p>
              <label className="participation-checkbox lifecycle-acknowledgement">
                <input
                  type="checkbox"
                  required
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                <span>
                  참가자에게 안내하고, 주최자 변경에 따른 전액 취소·환불 요청을 받는 내용을
                  확인했어요.
                </span>
              </label>
              <button type="submit" className="participation-primary" disabled={!checked}>
                {busy
                  ? "처리 중…"
                  : kind === "cancel"
                    ? "확인 후 행사 취소하기"
                    : "확인 후 일정 변경하기"}
              </button>
            </fieldset>
          </form>
        </details>
      )}
    </section>
  );
}
