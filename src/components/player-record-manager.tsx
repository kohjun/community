"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import {
  PLAYER_ROLES,
  PLAYER_ROLE_LABELS,
  type PlayerRole,
  type PlayerRosterView,
} from "@/domain/player";
import { appRequest, RequestError } from "@/lib/api-client";
export function PlayerRecordManager({ postId }: { postId: string }) {
  const [data, setData] = useState<PlayerRosterView | null>(null),
    [selected, setSelected] = useState(""),
    [presence, setPresence] = useState<"attended" | "no_show">("attended"),
    [outcome, setOutcome] = useState<"participated" | "won">("participated"),
    [role, setRole] = useState<PlayerRole | "">(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    const request = ++sequence.current;
    const controller = new AbortController();
    setData(null);
    setSelected("");
    setBusy(false);
    setError("");
    appRequest<PlayerRosterView>(
      `/api/players/events/${postId}/records`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted && request === sequence.current) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted && request === sequence.current)
          setError(e instanceof Error ? e.message : "불러오지 못했어요.");
      });
    return () => {
      controller.abort();
      if (request === sequence.current) sequence.current++;
    };
  }, [postId]);
  async function refresh() {
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const result = await appRequest<PlayerRosterView>(`/api/players/events/${postId}/records`);
      if (request !== sequence.current) return;
      setData(result);
    } catch (e) {
      if (request !== sequence.current) return;
      if (
        e instanceof RequestError &&
        ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(e.code ?? "")
      ) {
        setData(null);
        setSelected("");
      }
      setError(e instanceof Error ? e.message : "불러오지 못했어요.");
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  function choose(id: string) {
    const member = data?.attendees.find((m) => m.applicationId === id);
    setSelected(id);
    setPresence(member?.result?.presence ?? "attended");
    setOutcome(member?.result?.outcome ?? "participated");
    setRole(member?.result?.observedRole ?? "");
    setReason("");
  }
  async function save() {
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const result = await appRequest<PlayerRosterView>(
        `/api/players/events/${postId}/records`,
        "PUT",
        {
          applicationId: selected,
          presence,
          outcome: presence === "no_show" ? "participated" : outcome,
          observedRole: presence === "no_show" ? null : role || null,
          reason,
          ...(data?.attendees.find((member) => member.applicationId === selected)?.result?.updatedAt
            ? {
                expectedUpdatedAt: data.attendees.find(
                  (member) => member.applicationId === selected,
                )?.result?.updatedAt,
              }
            : {}),
        },
      );
      if (request !== sequence.current) return;
      setData(result);
      setSelected("");
    } catch (e) {
      if (request !== sequence.current) return;
      if (
        e instanceof RequestError &&
        ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(e.code ?? "")
      ) {
        setData(null);
        setSelected("");
      }
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  return (
    <section className="player-record-manager participation-card">
      <div className="player-section-heading">
        <div>
          <h2>
            <ClipboardCheck size={19} />
            참가 전적 기록
          </h2>
          <p className="player-note">
            행사가 끝난 뒤 실제 참가 여부와 게임 결과를 확인해 기록하세요. 참가 확정 플레이어만
            대상이며, 자신의 전적은 다른 담당자가 확인해야 해요.
          </p>
        </div>
        <button className="participation-secondary" disabled={busy} onClick={() => void refresh()}>
          명단 새로고침
        </button>
      </div>
      {error && (
        <p role="alert" className="participation-error">
          {error}
        </p>
      )}
      {data && !data.canRecord && (
        <p className="player-note">
          정확한 행사 종료 시각을 신청 설정에 등록하고, 종료 후 기록할 수 있어요.
        </p>
      )}
      {data && (
        <div className="player-record-list">
          {data.attendees.map((m) => (
            <div key={m.applicationId}>
              <Link href={`/players/${m.publicId}`}>{m.nickname}</Link>
              <span>
                {m.result
                  ? m.result.presence === "no_show"
                    ? "미참석"
                    : m.result.outcome === "won"
                      ? "우승"
                      : "참가 완료"
                  : "기록 대기"}
              </span>
              <button
                className="participation-secondary"
                disabled={busy || !data.canRecord || m.isMe}
                onClick={() => choose(m.applicationId)}
              >
                {m.isMe ? "다른 담당자 확인 필요" : m.result ? "기록 수정" : "기록하기"}
              </button>
            </div>
          ))}
        </div>
      )}
      {data && !data.attendees.length && (
        <p className="player-note">참가가 확정된 플레이어가 아직 없어요.</p>
      )}
      {selected && data?.canRecord && (
        <form
          className="player-result-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3>{data.attendees.find((m) => m.applicationId === selected)?.nickname}의 행사 기록</h3>
          <label>
            참가 여부
            <select
              value={presence}
              onChange={(e) => setPresence(e.target.value as "attended" | "no_show")}
            >
              <option value="attended">실제 참가 확인</option>
              <option value="no_show">미참석 확인</option>
            </select>
          </label>
          {presence === "attended" && (
            <>
              <label>
                게임 결과
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as "participated" | "won")}
                >
                  <option value="participated">참가</option>
                  <option value="won">우승</option>
                </select>
              </label>
              <label>
                관찰한 역할
                <select value={role} onChange={(e) => setRole(e.target.value as PlayerRole | "")}>
                  <option value="">역할 기록 안 함</option>
                  {PLAYER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {PLAYER_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            확인 내용 · 수정 사유
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="기존 전적을 바꾸는 경우 사유가 필요합니다. 담당자에게만 표시돼요."
            />
          </label>
          <div className="player-actions">
            <button className="participation-primary" disabled={busy}>
              확인한 전적 저장
            </button>
            <button
              type="button"
              className="participation-secondary"
              onClick={() => setSelected("")}
            >
              닫기
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
