"use client";
import Link from "next/link";
import { useState } from "react";
import { Users, MapPin, Thermometer, Trophy, History } from "lucide-react";
import {
  PLAYER_ROLES,
  PLAYER_ROLE_LABELS,
  type PlayerRole,
  type PlayerProfileView,
} from "@/domain/player";
import { appRequest } from "@/lib/api-client";
import { ParticipationShell } from "./participation-shell";
import { SafetyActions } from "./safety-actions";
import { PlayerPortfolio } from "./player-portfolio";
import { HostSubscriptionButton } from "./host-subscription-button";
export function PlayerProfile({
  initial,
  canAct = false,
}: {
  initial: PlayerProfileView;
  canAct?: boolean;
}) {
  const [data, setData] = useState(initial),
    [role, setRole] = useState<PlayerRole | "">(initial.preferredRole ?? ""),
    [matching, setMatching] = useState(initial.matchingVisible),
    [history, setHistory] = useState(initial.historyPublic),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      setData(
        await appRequest<PlayerProfileView>("/api/players/me", "PUT", {
          preferredRole: role || null,
          matchingVisible: matching,
          historyPublic: history,
        }),
      );
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ParticipationShell>
      <Link className="player-back" href="/players">
        ← 플레이어 찾기
      </Link>
      <section className="player-profile-heading participation-card">
        <span className="player-avatar player-avatar-large">
          <Users size={36} />
        </span>
        <div>
          <span className="player-eyebrow">플레이어 프로필</span>
          <h1>{data.nickname}</h1>
          <span className="player-role">
            {data.preferredRole ? PLAYER_ROLE_LABELS[data.preferredRole] : "성향 탐색 중"} · 자기
            선택
          </span>
          <p>{data.bio || "함께할 다음 에피소드를 기다리고 있어요."}</p>
          <p className="player-region">
            <MapPin size={15} />
            {data.region || "지역 미등록"}
          </p>
        </div>
        {!data.isMe && <HostSubscriptionButton publicId={data.publicId} canAct={canAct} />}
        {data.isMe && (
          <Link className="participation-secondary" href="/mypage">
            기본 프로필 수정
          </Link>
        )}
      </section>
      <SafetyActions
        targetType="player"
        targetId={data.publicId}
        canAct={canAct}
        isMine={data.isMe}
      />
      <section className="player-summary-grid">
        <div className="participation-card">
          <Thermometer size={20} />
          <strong>{data.summary.mannerTemperature.toFixed(1)}℃</strong>
          <span>매너 온도</span>
        </div>
        {data.careerVisible && (
          <>
            <div className="participation-card">
              <Users size={20} />
              <strong>{data.summary.attended}회</strong>
              <span>기존 참가 전적</span>
            </div>
            <div className="participation-card">
              <Trophy size={20} />
              <strong>{data.summary.wins}회</strong>
              <span>기존 우승 기록</span>
            </div>
            <div className="participation-card">
              <History size={20} />
              <strong>{data.summary.hosted}회</strong>
              <span>기존 진행 기록</span>
            </div>
          </>
        )}
      </section>
      <section className="player-manner participation-card">
        <h2>기록이 쌓이는 매너 온도</h2>
        <p>
          긍정 평가 {data.summary.positive}개 · 불편 평가 {data.summary.negative}개 · 미참석 기록{" "}
          {data.summary.noShow}회
        </p>
        <progress max={99.9} value={data.summary.mannerTemperature} aria-label="매너 온도" />
        <p className="player-note">
          36.5℃에서 시작합니다. 참가 +0.1℃, 긍정 평가 +0.2℃, 불편 평가 −0.5℃, 미참석 −2℃. 같은
          행사에 실제 참가가 확인된 플레이어의 평가만 집계하며 온도 범위는 0~99.9℃입니다. 참가·평가
          기록의 참고값이며 신원 확인이나 행사 안전을 보장하지 않아요.
        </p>
      </section>
      {data.careerVisible && (
        <section className="participation-card">
          <h2>게임에서 맡았던 역할</h2>
          <div className="player-role-stats">
            {PLAYER_ROLES.map((r) => (
              <div key={r}>
                <span>{PLAYER_ROLE_LABELS[r]}</span>
                <strong>{data.summary.observedRoles[r]}회</strong>
              </div>
            ))}
          </div>
          <p className="player-note">
            참가한 행사에서 담당자가 확인한 역할 기록입니다. 프로필의 자기 선택 성향과 별도로
            표시해요.
          </p>
        </section>
      )}
      {data.isMe && (
        <form
          className="player-preferences participation-card"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2>나의 플레이 스타일</h2>
          <label>
            가장 잘 맞는 역할
            <select value={role} onChange={(e) => setRole(e.target.value as PlayerRole | "")}>
              <option value="">아직 탐색 중</option>
              {PLAYER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {PLAYER_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="record-switch-line">
            <span>플레이어 탐색 목록에 내 프로필 공개</span>
            <button
              type="button"
              role="switch"
              aria-checked={matching}
              aria-label="플레이어 탐색 공개"
              className={"crew-switch " + (matching ? "is-on" : "")}
              disabled={busy}
              onClick={() => setMatching((value) => !value)}
            />
          </div>
          <div className="record-switch-line">
            <span>포트폴리오의 참가 행사와 전적 상세를 회원에게 공개</span>
            <button
              type="button"
              role="switch"
              aria-checked={history}
              aria-label="참가 이력 공개"
              className={"crew-switch " + (history ? "is-on" : "")}
              disabled={busy}
              onClick={() => setHistory((value) => !value)}
            />
          </div>
          <p className="player-note">
            포트폴리오와 참가 상세의 공개는 각각 직접 선택합니다. 연락처와 로그인 정보, 개별
            평가자는 공개하지 않습니다.
          </p>
          {error && (
            <p role="alert" className="participation-error">
              {error}
            </p>
          )}
          {saved && <p role="status">플레이 스타일을 저장했어요.</p>}
          <button className="participation-primary" disabled={busy}>
            {busy ? "저장 중" : "프로필 설정 저장"}
          </button>
        </form>
      )}
      <PlayerPortfolio key={String(data.historyPublic)} publicId={data.publicId} isMe={data.isMe} />
    </ParticipationShell>
  );
}
