"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { appRequest } from "@/lib/api-client";
import type { WaitlistView } from "@/domain/community-growth";
import { currentWaitlist } from "@/domain/participation-availability";
export function WaitlistPanel({
  postId,
  onChanged,
}: {
  postId: string;
  onChanged?: (value: WaitlistView) => void;
}) {
  const [value, setValue] = useState<WaitlistView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const gate = useRef(false),
    base = "/api/growth/waitlist/" + postId;
  const latest = useRef<WaitlistView | null>(null),
    changed = useRef(onChanged),
    revision = useRef(0),
    mutation = useRef<AbortController | null>(null);
  changed.current = onChanged;
  const receive = useCallback((result: WaitlistView) => {
    const next = currentWaitlist(result);
    const previous = latest.current;
    latest.current = next;
    setValue(next);
    if (
      !previous ||
      previous.state !== next.state ||
      previous.full !== next.full ||
      previous.available !== next.available ||
      previous.offerUntil !== next.offerUntil
    )
      changed.current?.(next);
  }, []);
  useEffect(() => {
    const c = new AbortController();
    latest.current = null;
    setValue(null);
    const refresh = () => {
      if (document.visibilityState === "visible" && !gate.current) {
        const token = ++revision.current;
        void appRequest<WaitlistView>(base, "GET", undefined, c.signal)
          .then((next) => {
            if (!c.signal.aborted && token === revision.current) receive(next);
          })
          .catch(() => {});
      }
    };
    refresh();
    const t = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      c.abort();
      mutation.current?.abort();
      ++revision.current;
      clearInterval(t);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [base, receive]);
  useEffect(() => {
    if (value?.state !== "offered" || !value.offerUntil) return;
    const timer = setTimeout(
      () => receive(value),
      Math.max(0, Date.parse(value.offerUntil) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [value, receive]);
  async function change(join: boolean) {
    if (gate.current) return;
    gate.current = true;
    const abort = new AbortController(),
      token = ++revision.current;
    mutation.current = abort;
    setBusy(true);
    setError("");
    try {
      const next = await appRequest<WaitlistView>(base, "PUT", { join }, abort.signal);
      if (!abort.signal.aborted && token === revision.current) receive(next);
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "다시 시도해주세요.");
    } finally {
      gate.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  if (!value || (!value.available && !value.state) || (!value.full && !value.state)) return null;
  return (
    <section className="maturity-panel">
      <h2>정원 대기</h2>
      {value.state === "waiting" ? (
        <p>내 대기 순서 {value.position}번째 · 자리가 생기면 알림함으로 알려드려요.</p>
      ) : value.state === "offered" ? (
        <p>
          신청할 자리가 생겼어요.{" "}
          {value.offerUntil
            ? new Date(value.offerUntil).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
            : ""}
          까지 아래 신청서를 제출해주세요.
        </p>
      ) : value.state === "expired" ? (
        <p>자리 안내 기한이 지났어요. 정원이 찼다면 다시 대기 신청할 수 있어요.</p>
      ) : value.state === "cancelled" ? (
        <p>대기를 취소했어요. 신청 가능한 자리와 대기 상태를 다시 확인해주세요.</p>
      ) : value.state === "submitted" ? (
        <p>대기 안내 후 신청서를 제출했어요. 참가 현황에서 승인·결제 상태를 확인해주세요.</p>
      ) : (
        <p>
          정원이 찼을 때 등록할 수 있어요. 자리가 생기면 순서대로 최대 2시간의 신청 기회를 드려요.
        </p>
      )}
      <p className="form-note">
        대기 등록은 참가 확정이 아니에요. 번개는 담당자 승인 후 공지방에 입장합니다. 기한이 지나면
        다음 사람에게 안내해요.
      </p>
      {["waiting", "offered"].includes(value.state ?? "") ? (
        <button disabled={busy} onClick={() => void change(false)}>
          대기 취소
        </button>
      ) : value.available && value.full && value.state !== "submitted" ? (
        <button disabled={busy} onClick={() => void change(true)}>
          자리 알림 대기 신청
        </button>
      ) : null}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
