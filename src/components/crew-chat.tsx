"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { LockKeyhole, Send, Trash2, Users, RefreshCw, ArrowDown } from "lucide-react";
import { appRequest, RequestError } from "@/lib/api-client";
import type { CrewChatRoom } from "@/domain/crew-chat";
import { CrewAvatar } from "./crew-parts";
import styles from "./crew-chat.module.css";
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
  });
const denied = (error: unknown) =>
  error instanceof RequestError &&
  ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(error.code ?? "");
export function CrewChat({ crewId, onRevoked }: { crewId: string; onRevoked: () => void }) {
  const [room, setRoom] = useState<CrewChatRoom | null>(null);
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [revoked, setRevoked] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const generation = useRef(0);
  const sendGate = useRef(false);
  const pendingMessage = useRef<{ clientId: string; body: string } | null>(null);
  const revokeCallback = useRef(onRevoked);
  revokeCallback.current = onRevoked;
  const base = `/api/crews/${crewId}/chat`;
  const lastId = room?.messages.at(-1)?.id;
  useEffect(() => {
    const current = ++generation.current;
    let active = true,
      stream: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let delay = 1000;
    let connectionVersion = 0;
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const allowed = () => active && current === generation.current;
    function stop() {
      connectionVersion++;
      stream?.close();
      stream = null;
      controller?.abort();
      if (retry) clearTimeout(retry);
      setConnected(false);
    }
    function revoke() {
      if (!allowed()) return;
      stop();
      setRoom(null);
      setDraft("");
      setRevoked(true);
      pendingMessage.current = null;
      setError("크루원 권한을 확인할 수 없어요. 크루 정보를 다시 확인해주세요.");
      revokeCallback.current();
    }
    function receive(next: CrewChatRoom) {
      if (!allowed()) return;
      setRoom(next);
      setError("");
      setRevoked(false);
    }
    function schedule() {
      if (!allowed() || document.hidden) return;
      retry = setTimeout(() => {
        void connect();
      }, delay);
      delay = Math.min(delay * 2, 15000);
    }
    async function connect() {
      if (!allowed() || document.hidden) return;
      stream?.close();
      controller?.abort();
      if (retry) clearTimeout(retry);
      const attempt = new AbortController();
      controller = attempt;
      const version = ++connectionVersion;
      const connectionAllowed = () =>
        allowed() && version === connectionVersion && !attempt.signal.aborted;
      try {
        const next = await appRequest<CrewChatRoom>(
          base + suffix,
          "GET",
          undefined,
          attempt.signal,
        );
        if (!connectionAllowed() || document.hidden) return;
        receive(next);
        const source = new EventSource(base + "/stream" + suffix);
        stream = source;
        source.addEventListener("room", (event) => {
          if (!connectionAllowed() || document.hidden) return;
          try {
            receive(JSON.parse((event as MessageEvent).data));
            setConnected(true);
            delay = 1000;
          } catch {
            source.close();
            schedule();
          }
        });
        source.addEventListener("revoked", () => {
          if (connectionAllowed()) revoke();
        });
        source.onerror = () => {
          source.close();
          if (connectionAllowed()) {
            stream = null;
            setConnected(false);
            schedule();
          }
        };
      } catch (cause) {
        if (!connectionAllowed()) return;
        if (denied(cause)) {
          revoke();
          return;
        }
        setError(cause instanceof Error ? cause.message : "대화를 불러오지 못했어요.");
        schedule();
      }
    }
    function visibility() {
      stop();
      if (!document.hidden) void connect();
    }
    document.addEventListener("visibilitychange", visibility);
    void connect();
    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [base, cursor, refresh]);
  useEffect(() => {
    if (!lastId) return;
    const list = viewport.current;
    if (list && nearBottom.current) {
      list.scrollTop = cursor ? 0 : list.scrollHeight;
      setUnseen(false);
    } else if (!cursor) setUnseen(true);
  }, [lastId, cursor]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sendGate.current || !room?.canSend || revoked) return;
    sendGate.current = true;
    setSending(true);
    setError("");
    const current = generation.current;
    const value =
      pendingMessage.current?.body === body
        ? pendingMessage.current
        : { clientId: crypto.randomUUID(), body };
    pendingMessage.current = value;
    try {
      const next = await appRequest<CrewChatRoom>(base, "POST", value);
      if (current !== generation.current) return;
      pendingMessage.current = null;
      setDraft("");
      nearBottom.current = true;
      setRoom(next);
      setCursor(undefined);
      setRefresh((value) => value + 1);
    } catch (cause) {
      if (current !== generation.current) return;
      if (denied(cause)) {
        setRoom(null);
        setDraft("");
        setRevoked(true);
        revokeCallback.current();
      }
      setError(cause instanceof Error ? cause.message : "전송하지 못했어요. 다시 보내주세요.");
    } finally {
      sendGate.current = false;
      setSending(false);
    }
  }
  async function remove(id: string) {
    if (deleting || !window.confirm("이 메시지를 삭제할까요?")) return;
    const current = generation.current;
    setDeleting(id);
    setError("");
    try {
      await appRequest<CrewChatRoom>(base + "/" + id, "DELETE");
      if (current === generation.current) setRefresh((value) => value + 1);
    } catch (cause) {
      if (current !== generation.current) return;
      if (denied(cause)) {
        setRoom(null);
        setRevoked(true);
        revokeCallback.current();
      }
      setError(cause instanceof Error ? cause.message : "삭제하지 못했어요.");
    } finally {
      setDeleting(null);
    }
  }
  return (
    <section className={styles.chat} aria-label="크루원 전용 톡방">
      <header className={styles.header}>
        <div>
          <span className={styles.privacy}>
            <LockKeyhole size={13} />
            크루원 전용
          </span>
          <h2>크루 톡방</h2>
        </div>
        <div className={styles.connection}>
          <span className={connected ? styles.online : styles.offline} />
          {connected ? "연결됨" : "연결 중"}
          {room && (
            <span className={styles.count}>
              <Users size={14} />
              {room.memberCount}
            </span>
          )}
        </div>
      </header>
      {cursor && (
        <div className={styles.history}>
          이전 대화를 보고 있어요.
          <button
            onClick={() => {
              nearBottom.current = true;
              setCursor(undefined);
            }}
          >
            최근 대화로
          </button>
        </div>
      )}
      <div
        className={styles.messages}
        ref={viewport}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={!room && !error}
        onScroll={(event) => {
          const node = event.currentTarget;
          nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 90;
          if (nearBottom.current) setUnseen(false);
        }}
      >
        {room?.nextCursor && (
          <button
            className={styles.older}
            onClick={() => {
              nearBottom.current = true;
              setCursor(room.nextCursor!);
            }}
          >
            이전 대화 보기
          </button>
        )}
        {!room && !error && <p className={styles.empty}>대화를 불러오고 있어요.</p>}
        {room && !room.messages.length && (
          <div className={styles.empty}>
            <strong>첫 인사를 나눠보세요</strong>
            <p>함께하고 싶은 활동이나 다음 모임 이야기를 꺼내보세요.</p>
          </div>
        )}
        {room?.messages.map((message, index) => (
          <div key={message.id}>
            {(index === 0 ||
              dateLabel(message.createdAt) !== dateLabel(room.messages[index - 1]!.createdAt)) && (
              <div className={styles.date}>{dateLabel(message.createdAt)}</div>
            )}
            <article className={`${styles.message} ${message.mine ? styles.mine : ""}`}>
              {!message.mine && message.author && (
                <CrewAvatar nickname={message.author.nickname} avatar={message.author.avatar} />
              )}
              <div className={styles.content}>
                {!message.mine && message.author && (
                  <Link className={styles.author} href={`/players/${message.author.publicId}`}>
                    {message.author.nickname}
                  </Link>
                )}
                <p className={`${styles.bubble} ${message.removed ? styles.removed : ""}`}>
                  {message.removed ? "표시할 수 없는 메시지예요." : message.body}
                </p>
                <div className={styles.meta}>
                  <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
                  {message.canDelete && (
                    <button
                      aria-label="메시지 삭제"
                      disabled={!!deleting}
                      onClick={() => void remove(message.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            </article>
          </div>
        ))}
      </div>
      {unseen && !cursor && (
        <button
          className={styles.newMessage}
          onClick={() => {
            if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
            nearBottom.current = true;
            setUnseen(false);
          }}
        >
          <ArrowDown size={14} />새 메시지 보기
        </button>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
          {!revoked && (
            <button onClick={() => setRefresh((value) => value + 1)}>
              <RefreshCw size={13} />
              다시 연결
            </button>
          )}
        </div>
      )}
      {room && !room.canSend && (
        <p className={styles.history}>보관된 크루의 대화는 읽을 수 있어요.</p>
      )}
      <form className={styles.composer} onSubmit={submit}>
        <textarea
          aria-label="크루 메시지"
          placeholder="크루원에게 메시지를 보내세요"
          value={draft}
          rows={2}
          maxLength={2000}
          disabled={sending || revoked || !room?.canSend}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          aria-label="메시지 보내기"
          disabled={!draft.trim() || sending || revoked || !room?.canSend}
        >
          <Send size={18} />
          <span>{sending ? "전송 중" : "전송"}</span>
        </button>
      </form>
    </section>
  );
}
