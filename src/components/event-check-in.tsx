"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, QrCode, RefreshCw, Search } from "lucide-react";
import {
  ticketCodeFromScan,
  type AdmissionCandidate,
  type AdmissionRoster,
} from "@/domain/event-operations";
import { appRequest, RequestError } from "@/lib/api-client";
import { ParticipationShell } from "./participation-shell";
import { QrScanner } from "./qr-scanner";
export function EventCheckIn({ postId }: { postId: string }) {
  const [roster, setRoster] = useState<AdmissionRoster | null>(null),
    [candidate, setCandidate] = useState<AdmissionCandidate | null>(null),
    [code, setCode] = useState(""),
    [raw, setRaw] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [login, setLogin] = useState(false),
    [returnTo] = useState(`/management/events/${postId}/check-in`);
  const gate = useRef(false),
    pendingHash = useRef<string | null>(null);
  const base = `/api/participation/events/${postId}`;
  async function refresh(page = 1, filter = search) {
    const next = await appRequest<AdmissionRoster>(
      `${base}/check-ins?page=${page}&search=${encodeURIComponent(filter)}`,
    );
    setRoster(next);
    setLogin(false);
  }
  function failed(cause: unknown) {
    if (cause instanceof RequestError && cause.code === "UNAUTHENTICATED") setLogin(true);
    setError(cause instanceof Error ? cause.message : "처리하지 못했어요.");
  }
  useEffect(() => {
    const controller = new AbortController();
    if (pendingHash.current === null) {
      pendingHash.current = new URLSearchParams(window.location.hash.slice(1)).get("ticket") ?? "";
      try {
        if (pendingHash.current)
          sessionStorage.setItem(`sliper:pending-admission:${postId}`, pendingHash.current);
        else
          pendingHash.current = sessionStorage.getItem(`sliper:pending-admission:${postId}`) ?? "";
      } catch {
        /* Scanning again works when session storage is unavailable. */
      }
      window.history.replaceState(null, "", window.location.pathname);
    }
    appRequest<AdmissionRoster>(`${base}/check-ins`, "GET", undefined, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setRoster(next);
        const initial = pendingHash.current;
        pendingHash.current = "";
        if (initial) void preview(initial);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) failed(cause);
      });
    return () => controller.abort();
  }, [base]);
  async function preview(value: string) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    setCandidate(null);
    setCode("");
    try {
      const parsed = ticketCodeFromScan(value, postId, window.location.origin);
      const next = await appRequest<AdmissionCandidate>(`${base}/check-in-preview`, "POST", {
        code: parsed,
      });
      try {
        sessionStorage.removeItem(`sliper:pending-admission:${postId}`);
      } catch {}
      setCode(parsed);
      setCandidate(next);
      setRaw("");
    } catch (cause) {
      failed(cause);
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function finalize() {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await appRequest<{ recorded: number }>(`${base}/finalize`, "POST", {});
      await refresh(roster?.page ?? 1);
      setError("");
      setNotice(
        `${result.recorded}명의 QR 참가 전적을 반영하고 행사를 완료 확인했어요. 기록 초안에서 회고를 작성할 수 있습니다.`,
      );
    } catch (cause) {
      failed(cause);
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function admit() {
    if (gate.current || !candidate?.canAdmit) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      setCandidate(await appRequest<AdmissionCandidate>(`${base}/check-in`, "POST", { code }));
      await refresh(roster?.page ?? 1);
    } catch (cause) {
      setCandidate(null);
      setCode("");
      failed(cause);
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
            <span className="ops-eyebrow">EVENT CHECK-IN</span>
            <h1>{roster?.title ?? "행사 QR 입장 확인"}</h1>
            <p>QR을 읽고 참가자 정보를 확인한 뒤 입장을 처리하세요.</p>
          </div>
          <Link href={`/management/events/${postId}`} className="participation-secondary">
            행사 관리
          </Link>
        </header>
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
        {login && (
          <Link
            className="participation-primary"
            href={`/login?returnTo=${encodeURIComponent(returnTo)}`}
          >
            담당자 계정으로 로그인
          </Link>
        )}
        {roster && (
          <>
            <div className="ops-summary">
              <div>
                <small>참가 확정</small>
                <strong>
                  {roster.confirmed}
                  <span>명</span>
                </strong>
              </div>
              <div>
                <small>입장 완료</small>
                <strong>
                  {roster.checkedIn}
                  <span>명</span>
                </strong>
              </div>
              <div>
                <small>입장 대기</small>
                <strong>
                  {roster.confirmed - roster.checkedIn}
                  <span>명</span>
                </strong>
              </div>
            </div>
            {roster.endsAt && new Date(roster.endsAt).getTime() <= Date.now() && (
              <div className="ops-actions">
                <button
                  className="participation-primary"
                  disabled={busy}
                  onClick={() => void finalize()}
                >
                  행사 완료 확인 · 기록 초안 만들기
                </button>
                <p className="ops-note">
                  실제 행사 종료를 확인하고 기록 초안을 만듭니다. QR 참가 전적을 반영하며 기존
                  우승·역할 기록은 유지해요.
                </p>
              </div>
            )}
            <div className="ops-columns">
              <section className="participation-card ops-card">
                <h2>
                  <QrCode size={18} />
                  QR 입장권 확인
                </h2>
                <p className="ops-note">행사 시작 2시간 전부터 종료 시각까지 확인할 수 있어요.</p>
                <QrScanner disabled={busy} onRead={(value) => void preview(value)} />
                <form
                  className="ops-manual"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void preview(raw);
                  }}
                >
                  <label>
                    입장 코드 또는 QR 링크
                    <input
                      value={raw}
                      onChange={(event) => setRaw(event.target.value)}
                      placeholder="입장 코드를 붙여넣으세요"
                      maxLength={2048}
                      required
                      autoComplete="off"
                    />
                  </label>
                  <button className="participation-secondary" disabled={busy} type="submit">
                    참가자 조회
                  </button>
                </form>
                {candidate && (
                  <div className="ops-candidate" role="status">
                    <span className="ops-eyebrow">
                      {candidate.checkedAt ? "입장 완료" : "참가 확정 · 확인 대기"}
                    </span>
                    <h3>{candidate.nickname}</h3>
                    <p>신청 이름: {candidate.attendeeName}</p>
                    <small>신청 번호 {candidate.applicationId.slice(0, 8).toUpperCase()}</small>
                    <p>{candidate.message}</p>
                    {candidate.checkedAt ? (
                      <p className="ops-success">
                        <CheckCircle2 size={17} />
                        {new Date(candidate.checkedAt).toLocaleString("ko-KR")}
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="participation-primary"
                        disabled={busy || !candidate.canAdmit}
                        onClick={() => void admit()}
                      >
                        참가자 확인 · 입장 완료
                      </button>
                    )}
                  </div>
                )}
              </section>
              <section className="participation-card ops-card">
                <div className="ops-section-heading">
                  <h2>현장 참가 명단</h2>
                  <button
                    className="participation-secondary"
                    disabled={busy}
                    type="button"
                    onClick={() => void refresh(roster.page).catch(failed)}
                  >
                    <RefreshCw size={14} />
                    갱신
                  </button>
                </div>
                <form
                  className="ops-search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void refresh(1).catch(failed);
                  }}
                >
                  <input
                    aria-label="참가자 이름 검색"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    maxLength={80}
                    placeholder="닉네임·신청 이름 검색"
                  />
                  <button className="participation-secondary" type="submit">
                    <Search size={16} />
                    <span className="sr-only">검색</span>
                  </button>
                </form>
                <div className="ops-roster">
                  {roster.items.map((member) => (
                    <div key={member.applicationId}>
                      <div>
                        <strong>{member.nickname}</strong>
                        <small>
                          {member.attendeeName} · {member.applicationId.slice(0, 8).toUpperCase()}
                        </small>
                      </div>
                      <span className={member.checkedAt ? "ops-status" : "ops-status pending"}>
                        {member.checkedAt ? "입장 완료" : "입장 대기"}
                      </span>
                    </div>
                  ))}
                </div>
                {!roster.items.length && <p className="ops-note">확인할 참가자가 없어요.</p>}
                <div className="ops-pagination">
                  <button
                    className="participation-secondary"
                    disabled={busy || roster.page === 1}
                    onClick={() => void refresh(roster.page - 1).catch(failed)}
                  >
                    이전
                  </button>
                  <span>{roster.page}</span>
                  <button
                    className="participation-secondary"
                    disabled={busy || !roster.hasMore}
                    onClick={() => void refresh(roster.page + 1).catch(failed)}
                  >
                    다음
                  </button>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </ParticipationShell>
  );
}
