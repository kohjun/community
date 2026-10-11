"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Users, MapPin, ArrowUpRight, Thermometer } from "lucide-react";
import { PLAYER_ROLES, PLAYER_ROLE_LABELS, type PlayerDirectoryView } from "@/domain/player";
import { appRequest } from "@/lib/api-client";
import { ParticipationShell } from "./participation-shell";
export interface PlayerFilters {
  role: string;
  region: string;
}
const DEFAULT_PLAYER_FILTERS: PlayerFilters = { role: "", region: "" };

export function PlayerDirectory({
  initial,
  initialQuery = DEFAULT_PLAYER_FILTERS,
  embedded = false,
}: {
  initial: PlayerDirectoryView;
  initialQuery?: PlayerFilters;
  embedded?: boolean;
}) {
  const [data, setData] = useState(initial),
    [role, setRole] = useState(initialQuery.role),
    [region, setRegion] = useState(initialQuery.region),
    [appliedFilters, setAppliedFilters] = useState(initialQuery),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const version = useRef(0),
    pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      version.current++;
      pending.current?.abort();
    },
    [],
  );
  useEffect(() => {
    version.current++;
    pending.current?.abort();
    setData(initial);
    setRole(initialQuery.role);
    setRegion(initialQuery.region);
    setAppliedFilters(initialQuery);
    setBusy(false);
    setError("");
  }, [initial, initialQuery]);
  async function load(more = false) {
    const request = ++version.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const filters = more ? appliedFilters : { role, region: region.trim() };
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (filters.role) query.set("role", filters.role);
      if (filters.region) query.set("region", filters.region);
      if (more && data.nextCursor) query.set("cursor", data.nextCursor);
      const result = await appRequest<PlayerDirectoryView>(
        `/api/players?${query}`,
        "GET",
        undefined,
        controller.signal,
      );
      if (request !== version.current || controller.signal.aborted) return;
      if (!more) {
        setAppliedFilters(filters);
        const view = new URLSearchParams();
        if (filters.role) view.set("role", filters.role);
        if (filters.region) view.set("region", filters.region);
        window.history.replaceState(null, "", "/players" + (view.size ? "?" + view : ""));
      }
      setData((previous) =>
        more ? { ...result, items: [...previous.items, ...result.items] } : result,
      );
    } catch (e) {
      if (request === version.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "불러오지 못했어요.");
    } finally {
      if (request === version.current && !controller.signal.aborted) setBusy(false);
    }
  }
  const content = (
    <>
      <section className={embedded ? "people-section-heading" : "player-hero"}>
        <div>
          {!embedded && <span className="player-eyebrow">취향과 매너로 만나요</span>}
          {embedded ? <h2>나와 잘 맞는 플레이어</h2> : <h1>나와 잘 맞는 플레이어</h1>}
          <p>역할 성향을 찾고, 함께 즐긴 참가 전적을 확인해보세요.</p>
        </div>
        <Link
          className="participation-primary"
          href={data.myPublicId ? `/players/${data.myPublicId}` : "/login"}
        >
          <Users size={17} />내 플레이어 프로필
        </Link>
      </section>
      <form
        className="player-filters participation-card"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          역할 성향
          <select disabled={busy} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">모든 성향</option>
            {PLAYER_ROLES.map((r) => (
              <option key={r} value={r}>
                {PLAYER_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          관심 지역
          <input
            disabled={busy}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="예: 서울, 부산"
            maxLength={80}
          />
        </label>
        <button className="participation-primary" disabled={busy}>
          플레이어 찾기
        </button>
      </form>
      {error && (
        <p role="alert" className="participation-error">
          {error}
        </p>
      )}
      <p className="player-note">
        프로필에서 탐색 공개를 선택한 플레이어가 표시됩니다. 성향은 자기 선택이고, 전적은 행사
        담당자가 확인한 기록입니다.
      </p>
      <section className="player-directory-grid">
        {data.items.map((player) => (
          <Link
            className="player-card participation-card"
            key={player.publicId}
            href={`/players/${player.publicId}`}
          >
            <div className="player-card-top">
              <span className="player-avatar">
                <Users size={24} />
              </span>
              <ArrowUpRight size={18} />
            </div>
            <h2>{player.nickname}</h2>
            <span className="player-role">
              {player.preferredRole ? PLAYER_ROLE_LABELS[player.preferredRole] : "성향 탐색 중"}
            </span>
            <p className="player-bio">{player.bio || "다음 게임에서 만나요."}</p>
            <p className="player-region">
              <MapPin size={14} />
              {player.region || "지역 미등록"}
            </p>
            <div className="player-card-stats">
              <span>
                <Thermometer size={15} />
                {player.summary.mannerTemperature.toFixed(1)}℃
              </span>
              <span>
                {player.careerVisible
                  ? "참가 " + player.summary.attended + "회"
                  : "참가 전적 비공개"}
              </span>
            </div>
          </Link>
        ))}
      </section>
      {!data.items.length && (
        <section className="participation-card participation-empty">
          <Users size={32} />
          <h2>첫 번째 플레이어가 되어보세요</h2>
          <p>프로필에서 탐색 공개를 켜면 다른 플레이어가 찾을 수 있어요.</p>
        </section>
      )}
      {data.nextCursor && (
        <button className="participation-secondary" disabled={busy} onClick={() => void load(true)}>
          플레이어 더 보기
        </button>
      )}
    </>
  );
  return embedded ? content : <ParticipationShell>{content}</ParticipationShell>;
}
