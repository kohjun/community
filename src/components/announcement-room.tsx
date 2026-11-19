"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  Megaphone,
  MessageCircle,
  LockKeyhole,
  Send,
  Users,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import type { RoomView, RoomMemberPage } from "@/domain/participation";
import { participationRequest as request } from "@/lib/participation-client";
import { ParticipationShell } from "./participation-shell";
import { Markdown } from "./markdown";
import { RoomAccess } from "@/lib/room-access";
import { RequestError } from "@/lib/api-client";
import { EventPrivateContact } from "./event-private-contact";
import { MemberAvatar } from "./member-avatar";
import { EventWorkspaceNavigation } from "./event-workspace-navigation";
function mergedMessages(previous: RoomView["messages"], next: RoomView["messages"]) {
  const map = new Map(previous.map((m) => [m.id, m]));
  next.forEach((m) => map.set(m.id, m));
  return [...map.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
function RoomMembers({
  room,
  access,
  revision,
  onRefresh,
}: {
  room: RoomView;
  access: RefObject<RoomAccess>;
  revision: RefObject<string>;
  onRefresh: (next: RoomView) => void;
}) {
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState<RoomMemberPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pageRef = useRef<RoomMemberPage | null>(null);
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      controller.current?.abort();
    };
  }, []);
  const load = useCallback(
    async (more = false) => {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const attempt = ++generation.current;
      const ticket = access.current.ticket();
      const current = pageRef.current;
      let append = more && current?.memberRevision === room.memberRevision;
      const suffix =
        append && current?.nextCursor ? `?cursor=${encodeURIComponent(current.nextCursor)}` : "";
      const allowed = () =>
        mounted.current &&
        attempt === generation.current &&
        !abort.signal.aborted &&
        revision.current === room.memberRevision &&
        access.current.allows(ticket);
      setLoading(true);
      setError("");
      try {
        let next: RoomMemberPage;
        try {
          next = await request<RoomMemberPage>(
            `/rooms/${room.postId}/members${suffix}`,
            "GET",
            undefined,
            abort.signal,
          );
        } catch (cause) {
          if (!allowed()) return;
          if (!(append && cause instanceof RequestError && cause.code === "CONFLICT")) throw cause;
          append = false;
          next = await request<RoomMemberPage>(
            `/rooms/${room.postId}/members`,
            "GET",
            undefined,
            abort.signal,
          );
        }
        if (!allowed()) return;
        if (next.memberRevision !== room.memberRevision) {
          // An older page must never restore a member removed by the live snapshot.
          pageRef.current = null;
          setPage(null);
          const fresh = await request<RoomView>(
            `/rooms/${room.postId}`,
            "GET",
            undefined,
            abort.signal,
          );
          if (!allowed()) return;
          refreshRef.current(fresh);
          if (fresh.memberRevision === room.memberRevision)
            setError("멤버 정보가 변경되었어요. 목록을 새로고침해 주세요.");
          return;
        }
        const members =
          append && current
            ? [
                ...new Map(
                  [...current.members, ...next.members].map((member) => [member.publicId, member]),
                ).values(),
              ]
            : next.members;
        const updated = { ...next, members };
        pageRef.current = updated;
        setPage(updated);
      } catch (cause) {
        if (allowed())
          setError(cause instanceof Error ? cause.message : "멤버 목록을 다시 불러와주세요.");
      } finally {
        if (mounted.current && attempt === generation.current) {
          setLoading(false);
          if (controller.current === abort) controller.current = null;
        }
      }
    },
    [access, revision, room.postId, room.memberRevision],
  );
  useEffect(() => {
    generation.current++;
    controller.current?.abort();
    pageRef.current = null;
    setPage(null);
    setError("");
    setLoading(false);
    if (open && room.memberCount > room.memberPreview.length) void load();
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [open, load, room.memberCount, room.memberPreview.length, room.canManage, room.isOwner]);
  const visiblePage = page?.memberRevision === room.memberRevision ? page : null;
  const visibleMembers = visiblePage?.members ?? room.memberPreview;
  return (
    <section className={`room-members${open ? " is-open" : ""}`} aria-label="모임방 멤버">
      <button
        type="button"
        className="room-members-summary"
        aria-expanded={open}
        aria-controls={`room-members-${room.postId}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="room-members-label">
          <Users size={17} aria-hidden="true" />
          <strong>
            멤버 <span aria-live="polite">{room.memberCount}명</span>
          </strong>
        </span>
        <span className="room-members-summary-end">
          <span className="room-member-preview" aria-hidden="true">
            {room.memberPreview.slice(0, 4).map((member) => (
              <MemberAvatar
                key={member.publicId}
                {...member}
                className="room-member-preview-avatar"
              />
            ))}
          </span>
          <span className="room-members-toggle-label">{open ? "접기" : "멤버 보기"}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div id={`room-members-${room.postId}`} className="room-members-panel">
          <div className="room-members-panel-heading">
            <p>주최자·담당자·참가자 포함 · 프로필 사진과 닉네임만 공유돼요.</p>
            <button
              type="button"
              className="room-members-refresh"
              disabled={loading}
              onClick={() => void load()}
              aria-label="멤버 목록 새로고침"
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>
          <ul className="room-member-list">
            {visibleMembers.map((member) => (
              <li key={member.publicId}>
                <MemberAvatar {...member} className="room-member-list-avatar" />
                <div className="room-member-info">
                  <span className="room-member-name">
                    <strong>{member.nickname}</strong>
                    {member.isMe && <small className="room-member-self">나</small>}
                  </span>
                  {member.role !== "participant" && (
                    <small className="room-member-role">
                      {member.role === "owner" ? "주최자" : "담당자"}
                    </small>
                  )}
                </div>
                {member.role !== "participant" && !member.isMe && (
                  <EventPrivateContact postId={room.postId} compact />
                )}
              </li>
            ))}
          </ul>
          {loading && (
            <p className="room-members-status" role="status">
              멤버 목록을 불러오는 중…
            </p>
          )}
          {error && (
            <p className="room-members-error" role="alert">
              {error}
            </p>
          )}
          {visiblePage && (
            <footer className="room-members-footer">
              <span>
                {visiblePage.members.length} / {visiblePage.memberCount}명 표시
              </span>
              {visiblePage.nextCursor && (
                <button type="button" disabled={loading} onClick={() => void load(true)}>
                  멤버 더 보기
                </button>
              )}
            </footer>
          )}
        </div>
      )}
    </section>
  );
}

export function AnnouncementRoom({ initial }: { initial: RoomView }) {
  const [room, setRoom] = useState<RoomView | null>(initial),
    [connection, setConnection] = useState("연결 중"),
    [drafts, setDrafts] = useState({ announcement: "", chat: "" }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const access = useRef(new RoomAccess(initial.canManage, initial.isOwner));
  const memberRevision = useRef(initial.memberRevision);
  const gate = useRef(false),
    mounted = useRef(true),
    historyLoaded = useRef(false),
    scroller = useRef<HTMLDivElement>(null),
    stickToLatest = useRef(true),
    liveRevision = useRef(0),
    postId = initial.postId;
  useEffect(() => {
    mounted.current = true;
    access.current = new RoomAccess(initial.canManage, initial.isOwner);
    memberRevision.current = initial.memberRevision;
    const source = new EventSource(`/api/participation/rooms/${postId}/stream`);
    source.onopen = () => setConnection("자동 갱신 중");
    source.onerror = () => setConnection("다시 연결 중");
    source.addEventListener("room", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as RoomView;
      liveRevision.current++;
      memberRevision.current = next.memberRevision;
      access.current.update(next.canManage, next.isOwner);
      setRoom((prev) => ({
        ...next,
        messages: mergedMessages(prev?.messages || [], next.messages),
        nextCursor: historyLoaded.current ? (prev?.nextCursor ?? null) : next.nextCursor,
      }));
      setConnection("자동 갱신 중");
    });
    source.addEventListener("revoked", () => {
      source.close();
      access.current.revoke();
      setRoom(null);
      setConnection("참여 종료");
      setError("이 방에 대한 참여 권한이 종료되었어요.");
    });
    return () => {
      mounted.current = false;
      access.current.revoke();
      source.close();
    };
  }, [postId]);
  function refreshMemberPreview(next: RoomView) {
    memberRevision.current = next.memberRevision;
    setRoom((prev) =>
      prev
        ? {
            ...prev,
            memberCount: next.memberCount,
            memberRevision: next.memberRevision,
            memberPreview: next.memberPreview,
          }
        : null,
    );
  }
  function refreshRoom(next: RoomView) {
    memberRevision.current = next.memberRevision;
    access.current.update(next.canManage, next.isOwner);
    setRoom((prev) =>
      prev
        ? {
            ...next,
            messages: mergedMessages(prev.messages, next.messages),
            nextCursor: historyLoaded.current ? prev.nextCursor : next.nextCursor,
          }
        : null,
    );
  }
  const chatEnabled = room?.chatEnabled ?? false;
  const draftKey = chatEnabled ? "chat" : "announcement";
  const body = drafts[draftKey];
  const latestId = room?.messages.at(-1)?.id;
  useEffect(() => {
    if (chatEnabled && stickToLatest.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [chatEnabled, latestId]);

  async function work(fn: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "다시 시도해주세요.");
    } finally {
      gate.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function send(e: FormEvent) {
    e.preventDefault();
    void work(async () => {
      const ticket = access.current.ticket();
      const next = await request<RoomView>(`/rooms/${postId}/messages`, "POST", {
        body,
        isAnnouncement: !chatEnabled,
      });
      if (!mounted.current || !access.current.allows(ticket)) return;
      stickToLatest.current = true;
      setRoom((prev) =>
        prev ? { ...prev, messages: mergedMessages(prev.messages, next.messages) } : null,
      );
      setDrafts((prev) => ({ ...prev, [draftKey]: "" }));
    });
  }
  function changeMode(enabled: boolean) {
    void work(async () => {
      const ticket = access.current.ticket();
      const revision = liveRevision.current;
      const next = await request<RoomView>(`/rooms/${postId}/mode`, "PUT", {
        chatEnabled: enabled,
      });
      if (
        mounted.current &&
        access.current.allows(ticket, "manage") &&
        revision === liveRevision.current
      )
        refreshRoom(next);
    });
  }
  async function older() {
    if (!room?.nextCursor) return;
    await work(async () => {
      const ticket = access.current.ticket();
      const next = await request<RoomView>(
        `/rooms/${postId}?cursor=${encodeURIComponent(room.nextCursor!)}`,
      );
      if (!mounted.current || !access.current.allows(ticket)) return;
      historyLoaded.current = true;
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              messages: mergedMessages(prev.messages, next.messages),
              nextCursor: next.nextCursor,
            }
          : null,
      );
    });
  }
  return (
    <ParticipationShell>
      <div className="participation-workspace participation-room">
        <header className="participation-heading room-heading">
          <h1>{initial.title}</h1>
          <p aria-live="polite">
            <LockKeyhole size={15} aria-hidden="true" />
            {chatEnabled
              ? "참가자 전용 채팅방 · 승인된 참가자끼리 대화할 수 있어요."
              : "참가자 전용 공지방 · 담당자만 메시지를 보낼 수 있어요."}
          </p>
          {room && (
            <Link
              className="participation-secondary room-participation-link"
              href={`/events/${postId}`}
            >
              참가 정보 확인
            </Link>
          )}
        </header>
        {error && (
          <p className="participation-error" role="alert">
            {error}
          </p>
        )}
        {!room ? (
          <section className="participation-card participation-empty">
            <h2>모임방 참여가 종료되었어요</h2>
            <Link href="/mypage?tab=events" className="participation-primary">
              내 신청 내역 확인
            </Link>
          </section>
        ) : (
          <>
            {room.canManage && <EventWorkspaceNavigation postId={postId} active="room" />}
            {room.supportsChat && room.canManage && (
              <label className="room-chat-control">
                <span>
                  <strong>참가자 채팅 허용</strong>
                  <small id="room-chat-help">
                    {chatEnabled
                      ? "대화 모드 · 끄면 담당자만 공지를 보낼 수 있어요."
                      : "공지 모드 · 켜면 승인된 참가자가 메시지를 보낼 수 있어요."}
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="참가자 채팅 허용"
                  aria-describedby="room-chat-help"
                  checked={chatEnabled}
                  aria-disabled={busy}
                  onChange={(event) => {
                    if (!busy) changeMode(event.currentTarget.checked);
                  }}
                  {...{ switch: "" }}
                />
                <span className="room-chat-track" aria-hidden="true" />
              </label>
            )}
            <RoomMembers
              room={room}
              access={access}
              revision={memberRevision}
              onRefresh={refreshMemberPreview}
            />
            <section className="participation-card announcement-channel">
              <header>
                <div>
                  {chatEnabled ? (
                    <MessageCircle size={20} aria-hidden="true" />
                  ) : (
                    <Megaphone size={20} aria-hidden="true" />
                  )}
                  <strong>{chatEnabled ? "참가자 채팅" : "행사 공지"}</strong>
                </div>
                <span className="room-connection">
                  <i />
                  {connection}
                </span>
              </header>
              <div
                className="announcement-messages"
                ref={scroller}
                onScroll={(event) => {
                  const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
                  stickToLatest.current = scrollHeight - clientHeight - scrollTop < 60;
                }}
              >
                {room.nextCursor && (
                  <button
                    className="participation-secondary"
                    disabled={busy}
                    onClick={() => {
                      void older();
                    }}
                  >
                    이전 메시지 더 보기
                  </button>
                )}
                {!room.messages.length && (
                  <div className="participation-empty">
                    {chatEnabled ? (
                      <MessageCircle size={30} aria-hidden="true" />
                    ) : (
                      <Megaphone size={30} aria-hidden="true" />
                    )}
                    <h2>{chatEnabled ? "첫 메시지를 보내보세요" : "첫 공지를 기다리고 있어요"}</h2>
                    {!chatEnabled && (
                      <p>
                        {room.canManage
                          ? "준비물, 만나는 장소, 일정 안내를 첫 공지로 보내보세요."
                          : "담당자가 올리는 행사 안내가 여기에 표시됩니다."}
                      </p>
                    )}
                  </div>
                )}
                {room.messages.map((message) => (
                  <article
                    className={
                      message.isAnnouncement
                        ? "announcement-bubble"
                        : `announcement-bubble room-chat-message${message.isMine ? " is-mine" : ""}`
                    }
                    key={message.id}
                  >
                    <div className="announcement-author">
                      <span>
                        {message.isMine ? "나" : message.author}
                        {message.isAnnouncement && <small>공지</small>}
                      </span>
                      <time dateTime={message.createdAt}>
                        {new Date(message.createdAt).toLocaleString("ko-KR")}
                      </time>
                    </div>
                    {message.isAnnouncement ? (
                      <Markdown>{message.body}</Markdown>
                    ) : (
                      <p className="room-chat-text">{message.body}</p>
                    )}
                  </article>
                ))}
              </div>
              {room.canWrite ? (
                <form className="announcement-compose" onSubmit={send}>
                  <label htmlFor="announcement-body">
                    {chatEnabled ? "메시지 작성" : "새 공지 작성"}
                    {!chatEnabled && <small>마크다운 지원 · 참가자 모두에게 표시됩니다.</small>}
                  </label>
                  <textarea
                    id="announcement-body"
                    required
                    maxLength={10000}
                    rows={3}
                    value={body}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDrafts((prev) => ({ ...prev, [draftKey]: value }));
                    }}
                    onKeyDown={
                      chatEnabled
                        ? (event) => {
                            const { isComposing, keyCode } = event.nativeEvent;
                            if (
                              event.key !== "Enter" ||
                              event.shiftKey ||
                              isComposing ||
                              keyCode === 229
                            )
                              return;
                            event.preventDefault();
                            if (!event.repeat && !busy && body.trim())
                              event.currentTarget.form?.requestSubmit();
                          }
                        : undefined
                    }
                    enterKeyHint={chatEnabled ? "send" : undefined}
                    readOnly={busy}
                    placeholder={
                      chatEnabled
                        ? "참가자에게 메시지를 보내보세요"
                        : "참가자에게 전달할 준비물과 행사 안내를 적어주세요"
                    }
                  />
                  <button
                    type="submit"
                    className="participation-primary"
                    disabled={busy || !body.trim()}
                  >
                    <Send size={16} />
                    {chatEnabled ? "메시지 보내기" : "공지 보내기"}
                  </button>
                </form>
              ) : (
                <footer className="announcement-readonly">
                  <LockKeyhole size={16} aria-hidden="true" />이 방은 읽기 전용입니다. 행사 문의는
                  멤버 목록에서 할 수 있어요.
                </footer>
              )}
            </section>
          </>
        )}
      </div>
    </ParticipationShell>
  );
}
