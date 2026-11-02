"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Hand,
  LogOut,
  MapPin,
  MessageCircle,
  Send,
  Trees,
  UsersRound,
  X,
} from "lucide-react";
import { useSession } from "./session-provider";
import { appRequest, RequestError } from "../lib/api-client";
import { TOWN_SEATS, type TownInput, type TownSnapshot } from "../domain/town";
import { GAME_CATALOG } from "../domain/game-catalog";
import { gameRoomId } from "../domain/game-room";
import styles from "./town.module.css";
import { useTownMotion } from "./town-motion";
import { TownScene } from "./town-r3f";
import { TownVoice } from "./town-voice";
type Panel = "chat" | "games" | "board" | "people" | null;
export function TownClient() {
  const { session, ready } = useSession(),
    [entered, setEntered] = useState(false),
    [view, setView] = useState<TownSnapshot | null>(null),
    [connected, setConnected] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [attempt, setAttempt] = useState(0),
    [panel, setPanel] = useState<Panel>(null),
    [flat, setFlat] = useState(false),
    [channel, setChannel] = useState<"world" | "nearby">("world"),
    [message, setMessage] = useState(""),
    [roomCode, setRoomCode] = useState(""),
    [safety, setSafety] = useState<{
      target: string;
      kind: "message" | "player";
      name: string;
    } | null>(null),
    [safetyAction, setSafetyAction] = useState("report"),
    [reason, setReason] = useState("harassment"),
    [detail, setDetail] = useState(""),
    [busy, setBusy] = useState(false);
  const latest = useRef<TownSnapshot | null>(null),
    socket = useRef<{ readyState: number; send: (data: string) => void; close: () => void } | null>(
      null,
    ),
    direction = useRef({ x: 0, z: 0 }),
    keys = useRef(new Set<string>()),
    chatEnd = useRef<HTMLLIElement>(null);
  const canEnter = ready && session?.authenticated && !session.restricted;
  useEffect(() => {
    if (entered && ready && (!session?.authenticated || session.restricted)) {
      setEntered(false);
      setNotice("로그인 상태가 바뀌었어요. 계정을 확인한 뒤 다시 입장해주세요.");
    }
  }, [entered, ready, session?.authenticated, session?.restricted]);

  const correction = useRef<{ x: number; z: number; sequence: number } | null>(null),
    intent = useRef({ x: 0, z: 0 }),
    [voiceTargets, setVoiceTargets] = useState<string[]>([]);
  function send(value: TownInput) {
    if (value.type === "move") {
      intent.current = { x: value.x, z: value.z };
      return;
    }
    if (socket.current?.readyState === 1) socket.current.send(JSON.stringify(value));
  }
  const {
    position: predicted,
    ready: motionReady,
    error: motionError,
  } = useTownMotion(entered, latest, intent, correction, send, attempt);
  const sceneView = () => {
    const v = latest.current,
      p = predicted.current;
    return v && p
      ? {
          ...v,
          players: v.players.map((a) => (a.id === v.me ? { ...a, x: p.x, z: p.z, yaw: p.yaw } : a)),
        }
      : v;
  };
  useEffect(() => {
    if (!entered || !canEnter) return;
    let alive = true,
      retry: ReturnType<typeof setTimeout> | undefined,
      renew: ReturnType<typeof setInterval> | undefined,
      failures = 0,
      room: import("@colyseus/sdk").Room | undefined;
    const controller = new AbortController();
    async function ticket() {
      return appRequest<{ ticket: string; path: string; roomId: string }>(
        "/api/v1/world/ticket",
        "POST",
        { worldId: "main-world" },
        controller.signal,
        10_000,
      );
    }
    async function connect() {
      if (!alive) return;
      setConnected(false);
      try {
        const entry = await ticket();
        if (!alive) return;
        const { Client } = await import("@colyseus/sdk");
        const url = entry.path.startsWith("ws:")
          ? entry.path
          : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${entry.path}`;
        room = await new Client(url).joinById(entry.roomId, { ticket: entry.ticket });
        if (!alive) {
          await room.leave();
          return;
        }
        room.reconnection.enabled = false;
        socket.current = {
          readyState: 1,
          send: (data) => {
            const v = JSON.parse(data);
            if (v.type === "input") room?.send("player:input", v);
            else if (v.type === "report") room?.send("player:report", v);
            else room?.send("town:action", v);
          },
          close: () => {
            void room?.leave();
          },
        };
        room.onMessage("world:ready", () => {});
        const indices = new Map<number, string>();
        const publish = (v: TownSnapshot) => {
          latest.current = v;
          setView(v);
        };
        room.onMessage(
          "player:joined",
          (value: { index: number; avatar: TownSnapshot["players"][number] }) => {
            indices.set(value.index, value.avatar.id);
            const v = latest.current;
            if (v && !v.players.some((a) => a.id === value.avatar.id))
              publish({ ...v, players: [...v.players, value.avatar] });
          },
        );
        room.onMessage("player:left", (value: { index: number; id: string }) => {
          indices.delete(value.index);
          const v = latest.current;
          if (v) publish({ ...v, players: v.players.filter((a) => a.id !== value.id) });
        });
        room.onMessage("player:snapshots", (packets: number[][]) => {
          const v = latest.current;
          if (!v) return;
          const updates = new Map(packets.map((t) => [indices.get(t[0]!), t]));
          publish({
            ...v,
            now: Date.now(),
            players: v.players.map((a) => {
              const t = updates.get(a.id);
              if (!t) return a;
              return {
                ...a,
                x: t[1]! / 100,
                z: t[2]! / 100,
                yaw: t[3]! / 100,
                online: !!(t[4]! & 1),
                moving: !!(t[4]! & 2),
                seat: ["shade-a", "shade-b", "garden-a", "garden-b"][t[5]!] ?? null,
                wavingUntil: Date.now() + t[6]! * 100,
              };
            }),
          });
        });
        room.onMessage(
          "world:meta",
          (value: { now: number; occupancy: number; capacity: number }) => {
            if (latest.current) publish({ ...latest.current, ...value });
          },
        );
        room.onMessage("world:state", (next: TownSnapshot) => {
          if (!alive) return;
          if (!Array.isArray(next.messages)) next.messages = latest.current?.messages ?? [];
          latest.current = next;
          setView(next);
          setConnected(true);
          setError("");
          failures = 0;
        });
        room.onMessage("player:correction", (value: { x: number; z: number; sequence: number }) => {
          correction.current = value;
        });
        room.onMessage("voice:targets", (value: { nearbyPlayerIds: string[] }) =>
          setVoiceTargets((old) =>
            old.join() === value.nearbyPlayerIds.join() ? old : value.nearbyPlayerIds,
          ),
        );
        room.onMessage("town:error", (value: { message: string }) => setError(value.message));
        room.onLeave((code: number) => {
          if (!alive) return;
          socket.current = null;
          setConnected(false);
          keys.current.clear();
          direction.current = { x: 0, z: 0 };
          intent.current = { x: 0, z: 0 };
          if (renew) clearInterval(renew);
          if ([4003, 4009, 1008].includes(code)) {
            setError(
              code === 4009
                ? "다른 탭에서 타운에 입장했어요. 이 화면에서 다시 입장할 수 있어요."
                : "입장 권한을 확인하지 못했어요. 로그인 상태를 확인하고 다시 입장해주세요.",
            );
            return;
          }
          if (++failures >= 5) {
            setError("광장에 연결하지 못했어요. 잠시 뒤 다시 입장해주세요.");
            return;
          }
          setError("연결이 잠시 끊겼어요. 자리를 확인하며 다시 연결하고 있어요.");
          retry = setTimeout(() => void connect(), Math.min(12_000, 1500 * 2 ** (failures - 1)));
        });
        renew = setInterval(() => {
          void ticket()
            .then((fresh) => {
              if (alive) room?.send("town:action", { type: "auth", ticket: fresh.ticket });
            })
            .catch(() => {
              if (alive) setError("로그인 상태를 다시 확인하고 있어요.");
            });
        }, 45_000);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "타운에 연결하지 못했어요.");
        if (
          e instanceof RequestError &&
          ["UNAUTHENTICATED", "FORBIDDEN", "RATE_LIMITED", "CONFLICT"].includes(e.code ?? "")
        )
          return;
        if (++failures < 5) retry = setTimeout(() => void connect(), 3000 * failures);
      }
    }
    void connect();
    const leave = () => {
      room?.send("town:action", { type: "leave" });
    };
    window.addEventListener("pagehide", leave);
    return () => {
      alive = false;
      controller.abort();
      if (retry) clearTimeout(retry);
      if (renew) clearInterval(renew);
      leave();
      void room?.leave();
      socket.current = null;
      window.removeEventListener("pagehide", leave);
      latest.current = null;
      setView(null);
      setConnected(false);
    };
  }, [entered, canEnter, attempt]);
  useEffect(() => {
    if (!entered) return;
    const clear = () => {
      keys.current.clear();
      direction.current = { x: 0, z: 0 };
      send({ type: "move", x: 0, z: 0 });
    };
    const down = (e: KeyboardEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest("input,textarea,select,button,[contenteditable=true]")
      )
        return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"].includes(e.key)) {
        e.preventDefault();
        keys.current.add(e.key);
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.key);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    const timer = setInterval(() => {
      let x = direction.current.x,
        z = direction.current.z;
      const k = keys.current;
      if (k.has("w") || k.has("ArrowUp")) {
        x -= 0.62;
        z -= 0.78;
      }
      if (k.has("s") || k.has("ArrowDown")) {
        x += 0.62;
        z += 0.78;
      }
      if (k.has("a") || k.has("ArrowLeft")) {
        x -= 0.78;
        z += 0.62;
      }
      if (k.has("d") || k.has("ArrowRight")) {
        x += 0.78;
        z -= 0.62;
      }
      const len = Math.max(1, Math.hypot(x, z));
      send({ type: "move", x: x / len, z: z / len });
    }, 100);
    return () => {
      clearInterval(timer);
      clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [entered]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [view?.messages.length, panel]);
  const me = view?.players.find((p) => p.id === view.me),
    nearest = me
      ? [...TOWN_SEATS].sort(
          (a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z),
        )[0]
      : null;
  function leave() {
    send({ type: "leave" });
    setEntered(false);
    setPanel(null);
    setSafety(null);
    setError("");
  }
  function chat(e: FormEvent) {
    e.preventDefault();
    if (!message.trim() || !connected) return;
    send({ type: "chat", channel, text: message.trim() });
    setMessage("");
  }
  async function saveSafety(e: FormEvent) {
    e.preventDefault();
    if (!safety || busy) return;
    setBusy(true);
    try {
      await appRequest("/api/town/safety", "POST", {
        ...safety,
        name: undefined,
        action: safetyAction,
        reason,
        detail,
      });
      setNotice(
        safetyAction === "block"
          ? "차단했어요. 서로의 아바타와 채팅이 숨겨져요."
          : "운영 신고함에 접수했어요. 내 신고 내역에서 확인할 수 있어요.",
      );
      setSafety(null);
      setDetail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  const controls = [
    { label: "앞으로 이동", x: -0.62, z: -0.78, Icon: ChevronUp, className: styles.up },
    { label: "왼쪽으로 이동", x: -0.78, z: 0.62, Icon: ChevronLeft, className: styles.left },
    { label: "뒤로 이동", x: 0.62, z: 0.78, Icon: ChevronDown, className: styles.down },
    { label: "오른쪽으로 이동", x: 0.78, z: -0.62, Icon: ChevronRight, className: styles.right },
  ];
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href="/games" className={styles.back}>
            <ArrowLeft size={16} /> 웹게임
          </Link>
          <h1>
            슬리퍼 타운 <small>베타</small>
          </h1>
        </div>
        <span className={styles.online} data-connected={connected}>
          <i />
          {connected
            ? `${view?.occupancy ?? 0} / ${view?.capacity ?? 8}명`
            : entered
              ? "연결 확인 중"
              : "햇살 광장"}
        </span>
        {entered && (
          <button type="button" onClick={leave} className={styles.exit}>
            <LogOut size={16} /> 나가기
          </button>
        )}
      </header>
      {!entered ? (
        <section className={styles.welcome}>
          <div className={styles.welcomeArt} aria-hidden="true">
            <span className={styles.sun} />
            <Trees size={88} />
            <span className={styles.welcomeMark}>
              sliper town<span>잠깐 들러도, 함께라서</span>
            </span>
            <span className={styles.cloud} />
          </div>
          <div className={styles.welcomeText}>
            <span className={styles.eyebrow}>OUR LITTLE MEETING PLACE</span>
            <h2>
              어디서 만날까요?
              <br />
              우리, 광장에서 만나요.
            </h2>
            <p>
              산책하다 인사를 나누고, 벤치에 앉아 이야기해요.
              <br />
              마음이 맞으면 함께 게임을 시작해도 좋아요.
            </p>
            <div className={styles.facts}>
              <span>
                <UsersRound size={16} /> 로그인 회원 · 8명
              </span>
              <span>
                <MessageCircle size={16} /> 광장 전체 채팅
              </span>
              <span>
                <Gamepad2 size={16} /> 기존 웹게임 연결
              </span>
            </div>
            {!ready ? (
              <p role="status">로그인 상태를 확인하고 있어요.</p>
            ) : canEnter ? (
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  setEntered(true);
                  setError("");
                }}
              >
                타운 입장 <ArrowUpRight size={18} />
              </button>
            ) : (
              <Link href="/login?returnTo=%2Fgames%2Ftown" className={styles.primary}>
                로그인하고 입장
              </Link>
            )}
            <p className={styles.policy}>
              프로필 닉네임이 광장에 표시돼요. 채팅은 최근 30분·최대 100개를 제공하고 서버 재시작 시
              사라져요. 신고한 대화는 운영 검토를 위해 보관해요.{" "}
              <Link href="/policies/community">이용규칙</Link>
            </p>
          </div>
        </section>
      ) : (
        <>
          <div className={styles.world}>
            {flat ? (
              <div className={styles.flat} aria-label="2D 광장">
                <span className={styles.flatCenter}>
                  sliper
                  <br />
                  town
                </span>
                <span className={styles.flatGames}>게임 라운지</span>
                <span className={styles.flatBoard}>모임 게시판</span>
                {TOWN_SEATS.map((s) => (
                  <span
                    key={s.id}
                    className={styles.flatSeat}
                    style={{ left: `${50 + (s.x / 30) * 100}%`, top: `${50 + (s.z / 30) * 100}%` }}
                  >
                    벤치
                  </span>
                ))}
                {view?.players.map((p) => (
                  <span
                    key={p.id}
                    className={styles.flatAvatar}
                    data-me={p.id === view.me}
                    style={{ left: `${50 + (p.x / 30) * 100}%`, top: `${50 + (p.z / 30) * 100}%` }}
                  >
                    <i />
                    {p.nickname}
                  </span>
                ))}
              </div>
            ) : (
              <div className={styles.canvas}>
                <TownScene
                  read={sceneView}
                  onPlace={setPanel}
                  onFailure={() => {
                    setFlat(true);
                    setNotice("가벼운 2D 광장으로 전환했어요.");
                  }}
                />
              </div>
            )}
            <div className={styles.location}>
              <MapPin size={14} /> 햇살 광장 <span>중앙 조형물에서 만나요</span>
            </div>
            <div className={styles.worldTools}>
              <button type="button" onClick={() => setFlat((v) => !v)}>
                {flat ? "3D로 보기" : "2D로 보기"}
              </button>
              <button
                type="button"
                onClick={() => setPanel("people")}
                aria-label="광장 참가자 보기"
              >
                <UsersRound size={18} />
              </button>
            </div>
            {(!connected || !motionReady) && (
              <div className={styles.connecting} role="status">
                <span />
                {error ||
                  motionError ||
                  (connected ? "이동 기능을 준비하고 있어요." : "광장에 입장하고 있어요.")}
                <button type="button" onClick={() => setAttempt((v) => v + 1)}>
                  다시 연결
                </button>
              </div>
            )}
            <div className={styles.dpad} aria-label="아바타 이동">
              {controls.map(({ label, x, z, Icon, className }) => (
                <button
                  key={label}
                  type="button"
                  className={className}
                  aria-label={label}
                  disabled={!connected || !motionReady}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    direction.current = { x, z };
                    send({ type: "move", x, z });
                  }}
                  onPointerUp={() => {
                    direction.current = { x: 0, z: 0 };
                    send({ type: "move", x: 0, z: 0 });
                  }}
                  onPointerCancel={() => {
                    direction.current = { x: 0, z: 0 };
                    send({ type: "move", x: 0, z: 0 });
                  }}
                  onLostPointerCapture={() => {
                    direction.current = { x: 0, z: 0 };
                    send({ type: "move", x: 0, z: 0 });
                  }}
                  onClick={(e) => {
                    if (e.detail === 0) {
                      send({ type: "move", x, z });
                      setTimeout(() => send({ type: "move", x: 0, z: 0 }), 220);
                    }
                  }}
                >
                  <Icon size={22} />
                </button>
              ))}
            </div>
            <div className={styles.gestures}>
              <button type="button" onClick={() => send({ type: "wave" })} disabled={!connected}>
                <Hand size={20} />
                <span>인사</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (me?.seat) send({ type: "stand" });
                  else if (nearest) send({ type: "sit", seat: nearest.id });
                }}
                disabled={!connected}
              >
                <span aria-hidden="true">♧</span>
                <span>{me?.seat ? "일어서기" : "벤치 앉기"}</span>
              </button>
            </div>
            <span className={styles.keyboard}>방향키 또는 WASD로 이동</span>
          </div>
          <TownVoice
            connected={connected}
            me={me?.id ?? null}
            targets={voiceTargets}
            read={sceneView}
          />
          <nav className={styles.dock} aria-label="타운 메뉴">
            {(
              [
                { id: "chat", Icon: MessageCircle, label: "채팅" },
                { id: "games", Icon: Gamepad2, label: "게임 라운지" },
                { id: "board", Icon: MapPin, label: "모임 게시판" },
                { id: "people", Icon: UsersRound, label: "참가자" },
              ] as const
            ).map(({ id, Icon, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={panel === id}
                onClick={() => setPanel((p) => (p === id ? null : id))}
              >
                <Icon size={19} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          {panel && (
            <section className={styles.panel} aria-labelledby="town-panel-title">
              <header>
                <h2 id="town-panel-title">
                  {panel === "chat"
                    ? "광장 채팅"
                    : panel === "games"
                      ? "게임 라운지"
                      : panel === "board"
                        ? "모임 게시판"
                        : "함께 있는 사람들"}
                </h2>
                <button type="button" aria-label="타운 패널 닫기" onClick={() => setPanel(null)}>
                  <X size={19} />
                </button>
              </header>
              {panel === "chat" && (
                <>
                  <p className={styles.hint}>
                    선택한 범위에 보여요 · 최근 30분 · 개인 연락처는 나누지 마세요
                  </p>
                  <ol className={styles.messages} aria-label="최근 광장 대화">
                    {!view?.messages.length && (
                      <li className={styles.empty}>첫 인사를 건네볼까요? 👋</li>
                    )}
                    {view?.messages.map((m) => (
                      <li key={m.id} data-mine={m.author === view.me}>
                        <div>
                          <strong>
                            {m.author === view.me ? `${m.nickname} · 나` : m.nickname}
                          </strong>
                          <time>
                            {new Date(m.at).toLocaleTimeString("ko-KR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                          {m.author !== view.me && (
                            <button
                              type="button"
                              onClick={() => {
                                setSafety({ target: m.id, kind: "message", name: m.nickname });
                                setSafetyAction("report");
                              }}
                              aria-label={`${m.nickname}의 대화 신고`}
                            >
                              신고
                            </button>
                          )}
                        </div>
                        <p>
                          {m.channel === "nearby" && <small>근처 · </small>}
                          {m.text}
                        </p>
                      </li>
                    ))}
                    <li ref={chatEnd} aria-hidden="true" />
                  </ol>
                  <form onSubmit={chat} className={styles.chatForm}>
                    <select
                      aria-label="대화 범위"
                      value={channel}
                      onChange={(e) => setChannel(e.target.value as "world" | "nearby")}
                    >
                      <option value="world">전체</option>
                      <option value="nearby">근처</option>
                    </select>
                    <input
                      aria-label="광장에 보낼 메시지"
                      placeholder="반가워요!"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      maxLength={240}
                      disabled={!connected}
                    />
                    <button
                      type="submit"
                      aria-label="메시지 보내기"
                      disabled={!connected || !message.trim()}
                    >
                      <Send size={18} />
                    </button>
                  </form>
                </>
              )}
              {panel === "games" && (
                <div className={styles.panelBody}>
                  <p>
                    게임은 기존 게임방에서 진행해요. 호스트는 로그인해 방을 만들고, 참가자는
                    링크·QR로 입장해요.
                  </p>
                  <div className={styles.gameLinks}>
                    {GAME_CATALOG.map((g) => (
                      <Link key={g.id} href={`/games?from=town&game=${g.id}`}>
                        {g.title}
                        <ArrowUpRight size={16} />
                      </Link>
                    ))}
                  </div>
                  <form
                    className={styles.joinForm}
                    onSubmit={(e) => {
                      e.preventDefault();
                      let code = roomCode.trim();
                      try {
                        if (code.includes("://"))
                          code = new URL(code).pathname.split("/").pop() ?? "";
                      } catch {}
                      if (!gameRoomId.safeParse(code).success) {
                        setError("게임방 링크 또는 방 코드를 확인해주세요.");
                        return;
                      }
                      location.assign(`/games/${code}?from=town`);
                    }}
                  >
                    <label htmlFor="town-room-code">초대받은 게임방</label>
                    <input
                      id="town-room-code"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value)}
                      placeholder="게임방 링크 또는 방 코드"
                      maxLength={300}
                    />
                    <button className={styles.primary} type="submit">
                      게임방 입장
                    </button>
                  </form>
                  <small>
                    이동하면 광장 자리는 비워져요. 돌아올 때 만석이면 다시 입장할 수 있어요.
                  </small>
                </div>
              )}
              {panel === "board" && (
                <div className={styles.panelBody}>
                  <p>
                    광장 밖에서도 만남을 이어가요. 모집 조건과 참가 절차는 각 모임에서 확인해주세요.
                  </p>
                  <Link href="/lightning" className={styles.boardLink}>
                    <strong>오늘 가볍게, 번개 모임</strong>
                    <span>
                      취향과 지역으로 모임 찾아보기 <ArrowUpRight size={16} />
                    </span>
                  </Link>
                  <Link href="/?view=board&kind=%EB%AA%A8%EC%A7%91" className={styles.boardLink}>
                    <strong>함께할 이벤트 찾기</strong>
                    <span>
                      모집 중인 이벤트 둘러보기 <ArrowUpRight size={16} />
                    </span>
                  </Link>
                  <small>
                    이 게시판은 기존 모임 탐색으로 연결해요. 타운 입장만으로 행사 참가가 승인되지는
                    않아요.
                  </small>
                </div>
              )}
              {panel === "people" && (
                <div className={styles.panelBody}>
                  <p>
                    전체 {view?.occupancy ?? 0}명 · 나에게 보이는 사람 {view?.players.length ?? 0}명
                    <br />
                    <small>차단한 사람은 서로의 아바타와 대화가 보이지 않아요.</small>
                  </p>
                  <ul className={styles.people}>
                    {view?.players.map((p) => (
                      <li key={p.id}>
                        <span className={styles.personIcon} data-me={p.id === view.me}>
                          <UsersRound size={18} />
                        </span>
                        <div>
                          <strong>
                            {p.nickname}
                            {p.id === view.me ? " · 나" : ""}
                          </strong>
                          <small>
                            {p.online
                              ? p.seat
                                ? "벤치에서 쉬는 중"
                                : "광장에 있어요"
                              : "다시 연결하는 중"}
                          </small>
                        </div>
                        {p.id !== view.me && (
                          <button
                            type="button"
                            onClick={() => {
                              setSafety({ target: p.id, kind: "player", name: p.nickname });
                              setSafetyAction("block");
                            }}
                          >
                            신고·차단
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      )}
      {safety && (
        <section className={styles.safety} aria-labelledby="town-safety-title">
          <header>
            <h2 id="town-safety-title">{safety.name} · 신고·차단</h2>
            <button type="button" onClick={() => setSafety(null)} aria-label="신고·차단 닫기">
              <X size={19} />
            </button>
          </header>
          <form onSubmit={(e) => void saveSafety(e)}>
            <label>
              처리 방법
              <select value={safetyAction} onChange={(e) => setSafetyAction(e.target.value)}>
                <option value="report">운영자에게 신고</option>
                <option value="block">이 사용자 차단</option>
              </select>
            </label>
            {safetyAction === "report" && (
              <>
                <label>
                  신고 사유
                  <select value={reason} onChange={(e) => setReason(e.target.value)}>
                    <option value="harassment">욕설·괴롭힘</option>
                    <option value="spam">광고·도배</option>
                    <option value="hate">혐오·차별</option>
                    <option value="sexual">음란·성적 콘텐츠</option>
                    <option value="privacy">개인정보 노출</option>
                    <option value="other">기타</option>
                  </select>
                </label>
                <label>
                  추가 설명
                  <textarea
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                    maxLength={1000}
                  />
                </label>
                <small>신고 시 선택한 대화가 운영 신고함에 함께 보관돼요.</small>
              </>
            )}
            <button className={styles.primary} disabled={busy}>
              {busy ? "처리 중…" : safetyAction === "block" ? "차단하기" : "신고 접수"}
            </button>
          </form>
        </section>
      )}
      {error && connected && (
        <p className={styles.alert} role="alert">
          {error}
          <button type="button" onClick={() => setError("")} aria-label="오류 안내 닫기">
            <X size={16} />
          </button>
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
          <button type="button" onClick={() => setNotice("")} aria-label="안내 닫기">
            <X size={16} />
          </button>
        </p>
      )}
      <p className={styles.footnote}>
        {entered
          ? "이동은 서버에서 확인해요. 채팅·신고·차단에는 커뮤니티 이용규칙이 적용돼요."
          : "PC 키보드 · 모바일 터치 지원 / 3D 사용이 어려우면 2D 광장으로 전환할 수 있어요."}
      </p>
    </div>
  );
}
