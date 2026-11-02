"use client";
import { GameRoomSettingsPanel } from "./game-room-settings";
import { ToastGameStage } from "./toast-game-stage";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  Crown,
  Gamepad2,
  LogOut,
  Play,
  RefreshCw,
  UsersRound,
  X,
} from "lucide-react";
import type { GameRoomView } from "@/domain/game-room";
import { appRequest, RequestError } from "@/lib/api-client";
import { connectGameRoom } from "@/lib/game-room-client";
import styles from "./game-room.module.css";
import { GameTutorial } from "./game-tutorial";
import { GameRoomQr } from "./game-room-qr";
import { MbtiIntroStage, MbtiPicker } from "./mbti-intro-stage";
import type { Mbti } from "@/domain/mbti-game";
import { AuctionGameStage } from "./auction-game-stage";
import { MbtiGameStage } from "./mbti-game-stage";
import { gameJoinUrl } from "@/domain/game-invite";
const phases = {
  lobby: "함께 준비해요",
  playing: "게임 진행 중",
  finished: "라운드 종료",
  closed: "종료된 방",
};
export function GameRoomLobby({ roomId, host }: { roomId: string; host: boolean }) {
  const [room, setRoom] = useState<GameRoomView | null>(null),
    [nickname, setNickname] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [myMbti, setMyMbti] = useState<Mbti | "">("");
  const current = useRef<GameRoomView | null>(null),
    mounted = useRef(false),
    editing = useRef(false),
    actionPending = useRef(false);
  const suffix = host ? "?host=1" : "",
    base = `/api/games/${roomId}`;
  const apply = useCallback(
    (view: GameRoomView) => {
      if (
        !mounted.current ||
        view.id !== roomId ||
        (current.current && current.current.revision > view.revision)
      )
        return;
      if (
        current.current?.settingsVersion &&
        view.settingsVersion &&
        current.current.settingsVersion !== view.settingsVersion
      ) {
        setNotice("호스트가 게임방 설정을 변경했어요. 준비 상태는 그대로 유지돼요.");
      }
      current.current = view;
      setRoom(view);
      if (!editing.current) {
        setNickname(view.viewer.nickname ?? "");
        setMyMbti(view.mbtiIntro?.myMbti ?? "");
      }
    },
    [roomId],
  );
  useEffect(() => {
    mounted.current = true;
    let alive = true,
      source: EventSource | null = null,
      polling = false;
    let timer: ReturnType<typeof setInterval> | undefined,
      retry: ReturnType<typeof setInterval> | undefined;
    async function refresh(heartbeat = false) {
      if (
        !alive ||
        polling ||
        current.current?.phase === "closed" ||
        ["left", "kicked"].includes(current.current?.viewer.status ?? "")
      )
        return;
      polling = true;
      try {
        const value = current.current;
        const canPing =
          heartbeat &&
          !host &&
          value &&
          ["admitted", "waiting"].includes(value.viewer.status) &&
          value.phase !== "closed";
        const view = await appRequest<GameRoomView>(
          base + suffix,
          canPing ? "PATCH" : "GET",
          canPing ? { action: "heartbeat" } : undefined,
        );
        if (alive) apply(view);
      } catch (e) {
        if (
          alive &&
          e instanceof RequestError &&
          ["FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED"].includes(e.code ?? "")
        ) {
          setError(e.message);
          source?.close();
          setConnected(false);
        }
      } finally {
        polling = false;
      }
    }
    async function start() {
      try {
        const view = await connectGameRoom(roomId, host);
        if (!alive) return;
        apply(view);
        setError("");
        if (view.phase === "closed" || ["left", "kicked"].includes(view.viewer.status)) return;
        source = new EventSource(`${base}/stream${suffix}`);
        source.addEventListener("room", (event) => {
          if (!alive) return;
          try {
            const next = JSON.parse((event as MessageEvent<string>).data) as GameRoomView;
            apply(next);
            setConnected(true);
            if (next.phase === "closed" || ["left", "kicked"].includes(next.viewer.status)) {
              source?.close();
              setConnected(false);
            }
          } catch {
            setConnected(false);
          }
        });
        source.addEventListener("revoked", () => {
          if (alive) {
            source?.close();
            setConnected(false);
            setError("방 연결이 만료됐어요. 다시 입장해주세요.");
            void refresh();
          }
        });
        source.onerror = () => {
          if (alive) setConnected(false);
        };
        timer = setInterval(() => {
          if (!document.hidden) void refresh(true);
        }, 25_000);
        retry = setInterval(() => {
          if (source?.readyState === EventSource.CONNECTING && !document.hidden) void refresh();
        }, 8_000);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "방에 연결하지 못했어요.");
      }
    }
    const visible = () => {
      if (!document.hidden) void refresh(true);
    };
    void start();
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      mounted.current = false;
      source?.close();
      clearInterval(timer);
      clearInterval(retry);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [roomId, host, attempt, apply, base, suffix]);
  async function act(action: Record<string, unknown>, asHost = false) {
    if (actionPending.current) return false;
    actionPending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const view = await appRequest<GameRoomView>(
        base + (asHost ? "?host=1" : ""),
        "PATCH",
        action,
      );
      editing.current = false;
      apply(view);
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      setError(e instanceof Error ? e.message : "요청을 처리하지 못했어요.");
      try {
        apply(await appRequest<GameRoomView>(base + suffix));
      } catch {
        /* Preserve original error. */
      }
      return false;
    } finally {
      actionPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function copy() {
    const url = gameJoinUrl(window.location.origin, roomId);
    try {
      await navigator.clipboard.writeText(url);
      setNotice("참가 링크를 복사했어요.");
    } catch {
      setNotice("아래 참가 링크를 길게 눌러 복사해주세요.");
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (room?.gameType === "mbti-intro") {
      if (myMbti) void act({ action: "intro-profile", nickname, mbti: myMbti, shareAtEnd: true });
    } else void act({ action: "nickname", nickname });
  }
  if (!room)
    return (
      <div className={styles.screen}>
        <section className={`${styles.card} ${styles.center}`} aria-live="polite">
          <Gamepad2 size={36} />
          <h1>{error ? "입장을 확인해주세요" : "게임방에 연결하고 있어요"}</h1>
          <p>{error || "접속한 순서대로 자리를 안내할게요."}</p>
          {error && (
            <button className={styles.primary} onClick={() => setAttempt((v) => v + 1)}>
              다시 연결하기
            </button>
          )}
          {host && error && (
            <Link href={`/login?returnTo=${encodeURIComponent(`/games/${roomId}?host=1`)}`}>
              호스트 계정으로 로그인
            </Link>
          )}
          <Link href="/games">게임방 만들기로</Link>
        </section>
      </div>
    );
  const me = room.viewer,
    inactive = ["left", "kicked"].includes(me.status) || room.phase === "closed";
  return (
    <div className={styles.screen}>
      <div className={styles.breadcrumb}>
        <Link href="/games">웹 게임</Link>
        <Link href="/games/town">타운으로</Link>
        <ChevronRight size={14} />
        <span>{room.isHost ? "호스트 대기실" : "참가 대기실"}</span>
      </div>
      <header className={styles.roomHeader}>
        <div>
          <span className={styles.eyebrow}>
            <Gamepad2 size={17} /> ROUND {String(room.round).padStart(2, "0")}
          </span>
          <h1>{room.title}</h1>
          <p>
            <span className={styles.connection} data-connected={connected} />
            {connected ? "실시간으로 함께하고 있어요" : "연결 상태를 확인하고 있어요"}
          </p>
        </div>
        <span className={styles.pill}>{phases[room.phase]}</span>
      </header>
      <GameTutorial
        game={
          room.gameType ??
          (room.toast
            ? "toast"
            : room.auction
              ? "auction"
              : room.mbtiIntro
                ? "mbti-intro"
                : room.mbti?.words
                  ? "word-liar"
                  : room.mbti
                    ? "mbti"
                    : "lobby")
        }
        wordMode={room.mbti?.words?.mode}
        revealLiar={room.mbti?.revealLiar}
        audience={room.isHost ? "host" : "player"}
        compact
        inProgress={room.phase === "playing"}
      />
      <GameRoomSettingsPanel
        room={room}
        busy={busy}
        onSave={(settings, settingsVersion) =>
          act({ action: "settings", settings, settingsVersion }, true)
        }
      />
      {room.toast && (
        <ToastGameStage
          key={room.round}
          room={room}
          busy={busy}
          onAction={(action, asHost) => void act(action, asHost)}
          onRefresh={() => {
            void appRequest<GameRoomView>(base + suffix)
              .then(apply)
              .catch(() => {});
          }}
        />
      )}
      {room.auction && (
        <AuctionGameStage
          key={room.round}
          room={room}
          busy={busy}
          onAction={(action, asHost) => void act(action, asHost)}
          onRefresh={() => {
            void appRequest<GameRoomView>(base + suffix)
              .then(apply)
              .catch(() => {});
          }}
        />
      )}
      {room.mbtiIntro && room.phase !== "lobby" && (
        <MbtiIntroStage
          key={room.round}
          room={room}
          busy={busy}
          onAction={(action, asHost) => void act(action, asHost)}
        />
      )}
      {room.mbti && room.phase !== "lobby" && (
        <MbtiGameStage
          key={room.round}
          room={room}
          busy={busy}
          onAction={(action, asHost) => void act(action, asHost)}
          onRefresh={() => {
            void appRequest<GameRoomView>(base + suffix)
              .then(apply)
              .catch(() => {});
          }}
        />
      )}
      <div className={styles.stats}>
        <span>
          <UsersRound size={18} />
          <strong>{room.players.length}</strong> / {room.capacity}명 입장
        </span>
        <span>
          <CheckCheck size={18} />
          <strong>{room.readyCount}</strong>명 준비
        </span>
        <span>
          대기 <strong>{room.waitingCount}</strong>명
        </span>
      </div>
      <div className={styles.liveGrid}>
        <section className={styles.card}>
          <div className={styles.sectionTitle}>
            <h2>{room.phase === "lobby" ? "플레이어" : "이번 라운드 플레이어"}</h2>
            <small>최소 {room.minPlayers}명부터 시작</small>
          </div>
          <ul className={styles.players}>
            {room.players.map((p, i) => (
              <li key={p.id} data-self={p.id === me.id}>
                <span className={styles.avatar}>
                  {p.nickname?.slice(0, 1) || String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>
                    {p.nickname || "닉네임을 정하고 있어요"}
                    {p.id === me.id && <em>나</em>}
                  </strong>
                  <small>
                    {!p.online
                      ? "잠시 연결이 끊겼어요"
                      : p.ready
                        ? "준비를 마쳤어요"
                        : "함께할 준비 중"}
                  </small>
                </div>
                <span className={styles.readyMark} data-ready={p.ready}>
                  {p.ready ? (
                    <>
                      <Check size={14} /> 준비
                    </>
                  ) : (
                    "대기"
                  )}
                </span>
                {room.isHost && room.phase === "lobby" && (
                  <button
                    className={styles.iconButton}
                    aria-label={`${p.nickname || "플레이어"} 퇴장`}
                    disabled={busy}
                    onClick={() => {
                      if (confirm("이 참가자를 퇴장시킬까요? 같은 브라우저의 재입장이 제한돼요."))
                        void act({ action: "kick", playerId: p.id, revision: room.revision }, true);
                    }}
                  >
                    <X size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!room.players.length && (
            <div className={styles.empty}>
              <UsersRound size={30} />
              <h3>첫 플레이어를 기다려요</h3>
              <p>링크를 공유하고 함께할 사람들을 초대해보세요.</p>
            </div>
          )}
          {room.isHost && room.waiting.length > 0 && (
            <details className={styles.queueDetails}>
              <summary>입장 대기 {room.waitingCount}명</summary>
              <ol>
                {room.waiting.map((p) => (
                  <li key={p.id}>
                    <span>대기 {p.position}번</span>
                    <button
                      disabled={busy || room.phase !== "lobby"}
                      onClick={() => {
                        if (confirm("이 대기자의 입장을 제한할까요?"))
                          void act(
                            { action: "kick", playerId: p.id, revision: room.revision },
                            true,
                          );
                      }}
                    >
                      입장 제한
                    </button>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
        <aside className={styles.card}>
          {room.isHost ? (
            <>
              <div className={styles.sectionTitle}>
                <h2>
                  <Crown size={19} /> 호스트 진행
                </h2>
                <span className={styles.pill}>진행자</span>
              </div>
              <p className={styles.description}>
                호스트는 참가 정원에 포함되지 않아요. 준비 현황을 확인하고 라운드를 진행해주세요.
              </p>
              {room.phase === "lobby" && (
                <>
                  <div className={styles.progress}>
                    <i
                      style={{
                        width: `${room.players.length ? (room.readyCount / room.players.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <p className={styles.muted}>
                    {room.canStart
                      ? "모두 준비됐어요. 지금 시작할 수 있어요."
                      : `최소 ${room.minPlayers}명 입장 · 입장한 참가자 전원 준비가 필요해요.`}
                  </p>
                  {room.auction && room.players.length >= room.auction.settings.maxRounds && (
                    <p className={styles.error}>
                      라운드 수보다 참가자가 적어야 해요. 위의 ‘설정 변경’에서 라운드 수를
                      늘려주세요.
                    </p>
                  )}
                  <button
                    className={styles.primary}
                    disabled={busy || !room.canStart}
                    onClick={() => void act({ action: "start", revision: room.revision }, true)}
                  >
                    <Play size={18} />
                    게임 시작
                  </button>
                </>
              )}
              {room.phase === "playing" && (
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        room.mbti || room.mbtiIntro || room.auction || room.toast
                          ? room.auction
                            ? "진행 중인 경매를 취소하고 중단할까요? 이번 매입금은 환급하며 완료된 거래는 유지해요."
                            : "정답 공개 없이 현재 게임을 중단할까요?"
                          : "현재 라운드를 종료할까요?",
                      )
                    )
                      void act({ action: "finish", revision: room.revision }, true);
                  }}
                >
                  {room.mbti || room.mbtiIntro || room.auction || room.toast
                    ? "게임 중단"
                    : "이번 라운드 종료"}
                </button>
              )}
              {room.phase === "finished" && (
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void act({ action: "reset", revision: room.revision }, true)}
                >
                  <RefreshCw size={18} />
                  다음 라운드 준비
                </button>
              )}
              {room.phase !== "closed" && (
                <button
                  className={styles.subtle}
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "게임방을 완전히 닫을까요? 참가자들이 모두 퇴장하며 다시 열 수 없어요.",
                      )
                    )
                      void act({ action: "close", revision: room.revision }, true);
                  }}
                >
                  게임방 닫기
                </button>
              )}
            </>
          ) : inactive ? (
            <div className={styles.center}>
              <LogOut size={30} />
              <h2>
                {me.status === "kicked"
                  ? "입장이 제한됐어요"
                  : room.phase === "closed"
                    ? "게임방이 종료됐어요"
                    : "게임방에서 나왔어요"}
              </h2>
              <p>
                {me.status === "kicked" ? "호스트에게 문의해주세요." : "함께해주셔서 고마워요."}
              </p>
              {me.status === "left" && room.phase !== "closed" && (
                <button className={styles.primary} onClick={() => setAttempt((v) => v + 1)}>
                  다시 입장하기
                </button>
              )}
              <Link href="/games">새 게임방 만들기</Link>
            </div>
          ) : me.status === "waiting" ? (
            <div className={styles.queueCard} aria-live="polite">
              <span className={styles.pill}>선착순 대기 중</span>
              <strong>
                {me.queuePosition}
                <small>번째</small>
              </strong>
              <h2>
                {room.phase === "lobby" ? "곧 자리가 나면 알려드릴게요" : "다음 라운드를 기다려요"}
              </h2>
              <p>
                이 화면을 열어두면 순서대로 자동 입장해요. 화면을 오래 닫으면 대기 순서가 만료될 수
                있어요.
              </p>
            </div>
          ) : room.phase === "lobby" ? (
            <>
              <div className={styles.sectionTitle}>
                <h2>함께할 준비</h2>
                <span className={styles.pill}>입장 완료</span>
              </div>
              <form className={styles.form} onSubmit={save}>
                <label>
                  게임에서 사용할 닉네임
                  <input
                    aria-label="게임 닉네임"
                    minLength={2}
                    maxLength={16}
                    required
                    placeholder="2~16자로 입력해주세요"
                    value={nickname}
                    disabled={busy}
                    onChange={(e) => {
                      editing.current = true;
                      setNickname(e.target.value);
                    }}
                  />
                </label>
                {room.gameType === "mbti-intro" && (
                  <label>
                    내 MBTI
                    <MbtiPicker
                      label="내 MBTI"
                      value={myMbti}
                      disabled={busy}
                      onChange={(value) => {
                        editing.current = true;
                        setMyMbti(value);
                      }}
                    />
                    <small className={styles.muted}>
                      게임이 끝나면 이 방 참가자들에게 공개돼요. E 외향 / I 내향 · S 감각 / N 직관 ·
                      T 사고 / F 감정 · J 판단 / P 인식
                    </small>
                  </label>
                )}
                <button
                  className={styles.secondary}
                  disabled={
                    busy ||
                    (room.gameType === "mbti-intro"
                      ? !myMbti ||
                        (!editing.current &&
                          nickname.trim() === me.nickname &&
                          myMbti === room.mbtiIntro?.myMbti)
                      : nickname.trim() === me.nickname)
                  }
                >
                  {room.gameType === "mbti-intro" ? "소개 정보 저장" : "닉네임 저장"}
                </button>
              </form>
              <button
                className={styles.primary}
                disabled={
                  busy ||
                  !me.nickname ||
                  editing.current ||
                  (room.gameType === "mbti-intro" && !room.mbtiIntro?.myMbti)
                }
                onClick={() => void act({ action: "ready", ready: !me.ready })}
              >
                {me.ready ? (
                  <>
                    <CheckCheck size={18} />
                    준비 완료 · 취소하기
                  </>
                ) : (
                  <>
                    <Check size={18} />
                    준비 완료
                  </>
                )}
              </button>
              <p className={styles.muted}>
                {me.ready
                  ? "호스트가 시작하면 게임 화면으로 함께 이동해요."
                  : "닉네임을 저장하고 준비 버튼을 눌러주세요."}
              </p>
            </>
          ) : (
            <div className={styles.center}>
              <Gamepad2 size={34} />
              <h2>{room.phase === "playing" ? "게임이 시작됐어요!" : "이번 라운드를 마쳤어요"}</h2>
              <p>
                {room.phase === "playing"
                  ? "호스트의 안내에 따라 함께 플레이해주세요."
                  : "호스트가 다음 라운드를 열면 다시 준비할 수 있어요."}
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <p role="status" className={styles.notice}>
            {notice}
          </p>
          {!inactive && (
            <div className={styles.invite}>
              <GameRoomQr
                roomId={roomId}
                title={room.title}
                isHost={room.isHost}
                players={room.players.length}
                capacity={room.capacity}
                waitingCount={room.waitingCount}
              />
              <button className={styles.secondary} onClick={() => void copy()}>
                <Copy size={16} />
                참가 링크 복사
              </button>
              <label>
                참가 링크
                <input
                  aria-label="참가 링크"
                  readOnly
                  value={
                    typeof window === "undefined" ? "" : gameJoinUrl(window.location.origin, roomId)
                  }
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              {!room.isHost && (
                <button
                  className={styles.subtle}
                  disabled={busy}
                  onClick={() => {
                    if (confirm("게임방에서 나갈까요? 다시 입장하면 대기열 마지막에 연결돼요."))
                      void act({ action: "leave" });
                  }}
                >
                  <LogOut size={15} />방 나가기
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
      {room.phase === "playing" &&
        !room.mbti &&
        !room.mbtiIntro &&
        !room.auction &&
        !room.toast && (
          <section className={`${styles.card} ${styles.gameStage}`} data-game-phase="playing">
            <span className={styles.eyebrow}>PLAY TOGETHER</span>
            <h2>라운드 {room.round} 진행 중</h2>
            <p>문제·미션·점수판을 연결할 공통 게임 화면이에요.</p>
            <small>
              시작 시각{" "}
              {room.startedAt
                ? new Intl.DateTimeFormat("ko-KR", {
                    timeZone: "Asia/Seoul",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }).format(new Date(room.startedAt))
                : ""}
            </small>
          </section>
        )}
      <p className={styles.templateNote}>
        화면을 2분 이상 닫으면 대기실 자리가 해제될 수 있어요. 진행 중인 라운드는 연결이 끊겨도
        자리를 유지해요.
      </p>
    </div>
  );
}
