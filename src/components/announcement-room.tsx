"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  Megaphone,
  LockKeyhole,
  Send,
  Users,
  ShieldCheck,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import type { RoomView, ApplicationView, RoomMemberPage } from "@/domain/participation";
import { STATUS_LABELS } from "@/domain/participation";
import { participationRequest as request } from "@/lib/participation-client";
import { ParticipationShell } from "./participation-shell";
import { Markdown } from "./markdown";
import { RoomAccess } from "@/lib/room-access";
import { RequestError } from "@/lib/api-client";
import { MemberAvatar } from "./member-avatar";
type Manager = { publicId: string; nickname: string };
type Attendees = { items: ApplicationView[]; nextCursor: string | null };
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
  const [open, setOpen] = useState(false);
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
    if (open) void load();
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [open, load, room.canWrite, room.isOwner]);
  const visiblePage = page?.memberRevision === room.memberRevision ? page : null;
  const visibleMembers = visiblePage?.members ?? room.memberPreview;
  return (
    <section className={`room-members${open ? " is-open" : ""}`} aria-label="공지방 멤버">
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
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [attendees, setAttendees] = useState<Attendees | null>(null),
    [managers, setManagers] = useState<Manager[]>([]),
    [publicId, setPublicId] = useState("");
  const access = useRef(new RoomAccess(initial.canWrite, initial.isOwner));
  const memberRevision = useRef(initial.memberRevision);
  const gate = useRef(false),
    mounted = useRef(true),
    historyLoaded = useRef(false),
    postId = initial.postId;
  useEffect(() => {
    mounted.current = true;
    access.current = new RoomAccess(initial.canWrite, initial.isOwner);
    memberRevision.current = initial.memberRevision;
    const source = new EventSource(`/api/participation/rooms/${postId}/stream`);
    source.onopen = () => setConnection("자동 갱신 중");
    source.onerror = () => setConnection("다시 연결 중");
    source.addEventListener("room", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as RoomView;
      memberRevision.current = next.memberRevision;
      access.current.update(next.canWrite, next.isOwner);
      if (!next.canWrite) setAttendees(null);
      if (!next.isOwner) setManagers([]);
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
      setAttendees(null);
      setManagers([]);
      setConnection("참여 종료");
      setError("이 공지방에 대한 참여 권한이 종료되었어요.");
    });
    return () => {
      mounted.current = false;
      access.current.revoke();
      source.close();
    };
  }, [postId]);
  function refreshRoom(next: RoomView) {
    memberRevision.current = next.memberRevision;
    access.current.update(next.canWrite, next.isOwner);
    if (!next.canWrite) setAttendees(null);
    if (!next.isOwner) setManagers([]);
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
      const next = await request<RoomView>(`/rooms/${postId}/messages`, "POST", { body });
      if (mounted.current && access.current.allows(ticket, "write")) {
        setRoom((prev) => ({
          ...next,
          messages: mergedMessages(prev?.messages || [], next.messages),
          nextCursor: prev?.nextCursor ?? next.nextCursor,
          memberCount: prev?.memberCount ?? next.memberCount,
          memberPreview: prev?.memberPreview ?? next.memberPreview,
          memberRevision: prev?.memberRevision ?? next.memberRevision,
        }));
        setBody("");
      }
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
              ...next,
              messages: mergedMessages(prev.messages, next.messages),
              memberCount: prev.memberCount,
              memberPreview: prev.memberPreview,
              memberRevision: prev.memberRevision,
            }
          : null,
      );
    });
  }
  async function loadAttendees(more = false) {
    await work(async () => {
      const ticket = access.current.ticket();
      const suffix =
        more && attendees?.nextCursor ? `?cursor=${encodeURIComponent(attendees.nextCursor)}` : "";
      const next = await request<Attendees>(`/events/${postId}/attendees${suffix}`);
      if (!mounted.current || !access.current.allows(ticket, "write")) return;
      setAttendees((prev) =>
        more && prev ? { ...next, items: [...prev.items, ...next.items] } : next,
      );
    });
  }
  async function loadManagers() {
    await work(async () => {
      const ticket = access.current.ticket(),
        next = await request<Manager[]>(`/events/${postId}/managers`);
      if (mounted.current && access.current.allows(ticket, "owner")) setManagers(next);
    });
  }
  async function managerChange(id: string, enabled: boolean) {
    await work(async () => {
      const ticket = access.current.ticket(),
        next = await request<Manager[]>(`/events/${postId}/managers`, "PUT", {
          publicId: id,
          enabled,
        });
      if (!mounted.current || !access.current.allows(ticket, "owner")) return;
      setManagers(next);
      setPublicId("");
    });
  }
  return (
    <ParticipationShell>
      <div className="participation-workspace participation-room">
        <header className="participation-heading room-heading">
          <span>PRIVATE ANNOUNCEMENTS</span>
          <h1>{initial.title}</h1>
          <p>
            <LockKeyhole size={15} />
            참가자 전용 공지방 · 담당자만 메시지를 보낼 수 있어요.
          </p>
        </header>
        {error && (
          <p className="participation-error" role="alert">
            {error}
          </p>
        )}
        {!room ? (
          <section className="participation-card participation-empty">
            <h2>공지방 참여가 종료되었어요</h2>
            <Link href="/participation" className="participation-primary">
              내 신청 내역 확인
            </Link>
          </section>
        ) : (
          <>
            <RoomMembers
              room={room}
              access={access}
              revision={memberRevision}
              onRefresh={refreshRoom}
            />
            <div className="room-layout">
              <section className="participation-card announcement-channel">
                <header>
                  <div>
                    <Megaphone size={20} />
                    <strong>행사 공지</strong>
                  </div>
                  <span className="room-connection">
                    <i />
                    {connection}
                  </span>
                </header>
                <div className="announcement-messages">
                  {room.nextCursor && (
                    <button
                      className="participation-secondary"
                      disabled={busy}
                      onClick={() => {
                        void older();
                      }}
                    >
                      이전 공지 더 보기
                    </button>
                  )}
                  {!room.messages.length && (
                    <div className="participation-empty">
                      <Megaphone size={30} />
                      <h2>첫 공지를 기다리고 있어요</h2>
                      <p>
                        {room.canWrite
                          ? "준비물, 만나는 장소, 일정 안내를 첫 공지로 보내보세요."
                          : "담당자가 올리는 행사 안내가 여기에 표시됩니다."}
                      </p>
                    </div>
                  )}
                  {room.messages.map((message) => (
                    <article className="announcement-bubble" key={message.id}>
                      <div className="announcement-author">
                        <span>
                          <ShieldCheck size={14} />
                          {message.author}
                          <small>담당자</small>
                        </span>
                        <time dateTime={message.createdAt}>
                          {new Date(message.createdAt).toLocaleString("ko-KR")}
                        </time>
                      </div>
                      <Markdown>{message.body}</Markdown>
                    </article>
                  ))}
                </div>
                {room.canWrite ? (
                  <form className="announcement-compose" onSubmit={send}>
                    <label htmlFor="announcement-body">
                      새 공지 작성 <small>마크다운 지원 · 참가자 모두에게 표시됩니다.</small>
                    </label>
                    <textarea
                      id="announcement-body"
                      required
                      maxLength={10000}
                      rows={3}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="참가자에게 전달할 준비물과 행사 안내를 적어주세요"
                    />
                    <button className="participation-primary" disabled={busy || !body.trim()}>
                      <Send size={16} />
                      {busy ? "전송 중…" : "공지 보내기"}
                    </button>
                  </form>
                ) : (
                  <footer className="announcement-readonly">
                    <LockKeyhole size={16} />이 방은 읽기 전용입니다. 문의는 모집글의 댓글이나
                    담당자 연락처를 이용해주세요.
                  </footer>
                )}
              </section>
              <aside>
                {room.canWrite && (
                  <Link className="participation-primary" href={`/management/events/${postId}`}>
                    참가 현황 · 승인 대시보드
                  </Link>
                )}
                <section className="participation-card">
                  <h2>우리의 에피소드</h2>
                  <p className="participation-muted">
                    결제·참가가 확인된 사람만 공지방에 자동 참여합니다. 외부 플랫폼에서 환불이
                    확인되면 접근이 해제됩니다.
                  </p>
                  <Link className="participation-text-link" href={`/events/${postId}`}>
                    참가 정보 확인 →
                  </Link>
                </section>
                {room.canWrite && (
                  <details className="participation-card room-management workspace-disclosure">
                    <summary>
                      <Users size={18} />
                      <span>신청자 관리</span>
                    </summary>
                    <p>이름과 연락처는 행사 운영 목적으로만 사용해주세요.</p>
                    <button
                      className="participation-secondary"
                      disabled={busy}
                      onClick={() => {
                        void loadAttendees();
                      }}
                    >
                      신청자 목록 확인 · 새로고침
                    </button>
                    {attendees && (
                      <>
                        <div className="attendee-list">
                          {attendees.items.map((app) => (
                            <article key={app.id}>
                              <strong>{app.attendeeName}</strong>
                              <span className={`participation-status ${app.status}`}>
                                {STATUS_LABELS[app.status]}
                              </span>
                              <p>{app.contact}</p>
                              {app.note && <small>{app.note}</small>}
                            </article>
                          ))}
                          {!attendees.items.length && <p>아직 신청자가 없어요.</p>}
                        </div>
                        {attendees.nextCursor && (
                          <button
                            className="participation-secondary"
                            disabled={busy}
                            onClick={() => {
                              void loadAttendees(true);
                            }}
                          >
                            신청자 더 보기
                          </button>
                        )}
                      </>
                    )}
                  </details>
                )}
                {room.isOwner && (
                  <details className="participation-card room-management workspace-disclosure">
                    <summary>
                      <ShieldCheck size={18} />
                      <span>담당자 지정</span>
                    </summary>
                    <p>
                      담당자는 공지를 작성하고 신청자 정보를 볼 수 있어요. 해당 회원의 마이페이지에
                      표시된 공개 프로필 ID를 입력하세요.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void managerChange(publicId, true);
                      }}
                    >
                      <label>
                        회원 공개 프로필 ID
                        <input
                          required
                          value={publicId}
                          maxLength={36}
                          onChange={(e) => setPublicId(e.target.value)}
                          placeholder="회원이 공유한 프로필 ID"
                        />
                      </label>
                      <button className="participation-primary" disabled={busy}>
                        담당자 추가
                      </button>
                    </form>
                    <button
                      className="participation-text-link"
                      disabled={busy}
                      onClick={() => {
                        void loadManagers();
                      }}
                    >
                      현재 담당자 목록 확인
                    </button>
                    <ul className="manager-list">
                      {managers.map((manager) => (
                        <li key={manager.publicId}>
                          <span>{manager.nickname}</span>
                          <button
                            disabled={busy}
                            onClick={() => {
                              void managerChange(manager.publicId, false);
                            }}
                          >
                            해제
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </ParticipationShell>
  );
}
