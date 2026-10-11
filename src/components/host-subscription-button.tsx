"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, BellRing, Check } from "lucide-react";
import type { HostSubscriptionView } from "@/domain/engagement";
import { appRequest, RequestError } from "@/lib/api-client";

export function HostSubscriptionButton({
  publicId,
  canAct,
}: {
  publicId: string;
  canAct: boolean;
}) {
  const [data, setData] = useState<HostSubscriptionView | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(!canAct);
  const mounted = useRef(false),
    gate = useRef(false),
    epoch = useRef(0);
  const mutation = useRef<AbortController | null>(null);
  const url = `/api/engagement/hosts/${publicId}`;
  const current = data?.publicId === publicId ? data : null;
  useEffect(() => {
    mounted.current = true;
    const token = ++epoch.current;
    const abort = new AbortController();
    mutation.current?.abort();
    gate.current = false;
    setData(null);
    setBusy(false);
    setError("");
    setNeedsLogin(!canAct);
    if (canAct) {
      void appRequest<HostSubscriptionView>(url, "GET", undefined, abort.signal)
        .then((result) => {
          if (!abort.signal.aborted && epoch.current === token) setData(result);
        })
        .catch((cause) => {
          if (abort.signal.aborted || epoch.current !== token) return;
          if (cause instanceof RequestError && cause.code === "UNAUTHENTICATED")
            setNeedsLogin(true);
          else setError(cause instanceof Error ? cause.message : "구독 정보를 불러오지 못했어요.");
        });
    }
    return () => {
      mounted.current = false;
      epoch.current++;
      abort.abort();
      mutation.current?.abort();
    };
  }, [url, canAct]);
  async function toggle() {
    if (!current || gate.current || !canAct) return;
    const token = epoch.current,
      abort = new AbortController();
    mutation.current?.abort();
    mutation.current = abort;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await appRequest<HostSubscriptionView>(
        url,
        "PUT",
        { subscribed: !current.subscribed },
        abort.signal,
      );
      if (mounted.current && !abort.signal.aborted && epoch.current === token) setData(result);
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted && epoch.current === token) {
        if (cause instanceof RequestError && cause.code === "UNAUTHENTICATED") setNeedsLogin(true);
        setError(cause instanceof Error ? cause.message : "구독을 변경하지 못했어요.");
      }
    } finally {
      if (epoch.current === token) {
        gate.current = false;
        if (mounted.current && !abort.signal.aborted) setBusy(false);
      }
    }
  }
  if (current?.isMe) return null;
  return (
    <div className="host-subscription">
      {needsLogin || !canAct ? (
        <Link className="participation-secondary" href="/login">
          <Bell size={15} />
          로그인하고 구독하기
        </Link>
      ) : (
        <button
          type="button"
          className={`participation-secondary host-subscription-button${current?.subscribed ? " subscribed" : ""}`}
          aria-pressed={current?.subscribed ?? false}
          disabled={!current || busy}
          onClick={() => void toggle()}
        >
          {current?.subscribed ? <Check size={15} /> : <BellRing size={15} />}
          {busy ? "저장 중…" : current?.subscribed ? "호스트 구독 중" : "호스트 구독"}
        </button>
      )}
      <small>이 호스트가 올린 새 모집 소식을 받아요.</small>
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
