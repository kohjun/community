"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, LockKeyhole, Mail, Phone, Link2, Pencil, RefreshCw } from "lucide-react";
import type { EventPrivateContactView } from "@/domain/event-contact";
import { eventPrivateContactPutSchema } from "@/domain/event-contact";
import { participationRequest as request } from "@/lib/participation-client";
import { RequestError } from "@/lib/api-client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

type Contact = NonNullable<EventPrivateContactView["contact"]>;
const emptyDraft: Contact = { channel: "phone", value: "", note: "" };
const labels = { phone: "전화번호", email: "이메일", link: "문의 링크" } as const;

/** A server-authorized value still gets an explicit scheme check before becoming a link. */
function contactHref(contact: Contact) {
  if (contact.channel === "phone" && /^\+?[\d\s()-]+$/.test(contact.value))
    return "tel:" + contact.value.replace(/[\s()-]/g, "");
  if (contact.channel === "email" && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact.value))
    return "mailto:" + encodeURIComponent(contact.value).replace(/%40/g, "@");
  if (contact.channel === "link") {
    try {
      const url = new URL(contact.value);
      if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch {
      /* Show invalid values as text, never a navigable scheme. */
    }
  }
  return null;
}

export function EventPrivateContact({
  postId,
  manage = false,
}: {
  postId: string;
  manage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="event-private-contact-entry">
      <button type="button" className="participation-secondary" onClick={() => setOpen(true)}>
        <LockKeyhole size={15} aria-hidden="true" />
        {manage ? "담당자 연락처 설정" : "담당자에게 문의하기"}
      </button>
      {manage && <small>확정 참가자와 지정 담당자에게만 보여요.</small>}
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <ContactDialog key={postId} postId={postId} />}
      </Dialog>
    </div>
  );
}

function ContactDialog({ postId }: { postId: string }) {
  const [view, setView] = useState<EventPrivateContactView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Contact>(emptyDraft);
  const [editRevision, setEditRevision] = useState(0);
  const sequence = useRef(0),
    lock = useRef(false),
    mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const formId = useId();
  const path = `/events/${postId}/private-contact`;

  function edit(next: EventPrivateContactView) {
    setEditRevision(next.revision);
    setDraft(next.contact ?? emptyDraft);
    setEditing(true);
    setError("");
    setMessage("");
  }
  async function load(initial = false) {
    if (lock.current || document.hidden) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const attempt = ++sequence.current;
    try {
      const next = await request<EventPrivateContactView>(path, "GET", undefined, abort.signal);
      if (!mounted.current || attempt !== sequence.current) return;
      setView(next);
      setError("");
      if (initial && next.canManage && !next.contact) edit(next);
    } catch (cause) {
      if (!mounted.current || abort.signal.aborted || attempt !== sequence.current) return;
      // Revalidation failure removes previously displayed personal data immediately.
      setView(null);
      setDraft(emptyDraft);
      setEditing(false);
      setError(cause instanceof Error ? cause.message : "연락 방법을 확인하지 못했어요.");
    } finally {
      if (mounted.current && attempt === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load(true);
    const refresh = () => {
      if (!document.hidden) void load();
    };
    const visibility = () => {
      if (document.hidden) {
        ++sequence.current;
        controller.current?.abort();
        setView(null);
        setDraft(emptyDraft);
        setEditing(false);
      } else void load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(refresh, 15000);
    return () => {
      mounted.current = false;
      ++sequence.current;
      controller.current?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [path]);

  async function change(method: "PUT" | "DELETE") {
    if (!view?.canManage || lock.current) return;
    const revision = editing ? editRevision : view.revision;
    const parsed =
      method === "PUT"
        ? eventPrivateContactPutSchema.safeParse({ expectedRevision: revision, ...draft })
        : null;
    if (parsed && !parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "연락 방법을 확인해주세요.");
      return;
    }
    let reloadConflict = false;
    lock.current = true;
    controller.current?.abort();
    const attempt = ++sequence.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await request<EventPrivateContactView>(
        path,
        method,
        parsed?.success ? parsed.data : { expectedRevision: revision },
      );
      if (!mounted.current || attempt !== sequence.current) return;
      if (document.hidden) {
        setView(null);
        setDraft(emptyDraft);
        setEditing(false);
        return;
      }
      setView(next);
      setDraft(emptyDraft);
      setEditing(false);
      setMessage(
        method === "PUT" ? "참가자 전용 연락 방법을 저장했어요." : "연락처 공개를 중단했어요.",
      );
    } catch (cause) {
      if (!mounted.current || attempt !== sequence.current) return;
      setError(cause instanceof Error ? cause.message : "저장하지 못했어요.");
      reloadConflict = cause instanceof RequestError && cause.code === "CONFLICT";
      if (
        cause instanceof RequestError &&
        ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(cause.code ?? "")
      ) {
        setView(null);
        setDraft(emptyDraft);
        setEditing(false);
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        if (reloadConflict) await load();
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void change("PUT");
  }
  const contact = view?.contact;
  const href = contact ? contactHref(contact) : null;
  const stale = editing && view && editRevision !== view.revision;
  const Icon = contact?.channel === "phone" ? Phone : contact?.channel === "email" ? Mail : Link2;
  return (
    <DialogContent className="event-private-contact-dialog">
      <div className="event-private-contact-heading">
        <LockKeyhole size={20} aria-hidden="true" />
        <span>참가자 전용</span>
      </div>
      <DialogTitle className="utility-title">행사 담당자 연락처</DialogTitle>
      <DialogDescription className="utility-description">
        행사 문의에만 이용해주세요. 참가자와 지정 담당자에게만 제공돼요.
      </DialogDescription>
      {loading && <p role="status">연락 방법을 확인하고 있어요.</p>}
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="event-private-contact-status" role="status">
          {message}
        </p>
      )}
      {view &&
        !editing &&
        (contact ? (
          <div className="event-private-contact-value">
            <span>
              <Icon size={16} aria-hidden="true" />
              {labels[contact.channel]}
            </span>
            {href ? (
              <a
                href={href}
                target={contact.channel === "link" ? "_blank" : undefined}
                rel="noopener noreferrer"
              >
                {contact.value}
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            ) : (
              <strong>{contact.value}</strong>
            )}
            {contact.note && <p>{contact.note}</p>}
          </div>
        ) : (
          <p className="participation-muted">
            담당자가 연락 방법을 아직 등록하지 않았어요. 모집글의 댓글로 문의해주세요.
          </p>
        ))}
      {view?.canManage && !editing && (
        <div className="event-private-contact-actions">
          <button
            type="button"
            className="participation-secondary"
            disabled={busy}
            onClick={() => edit(view)}
          >
            <Pencil size={14} />
            {contact ? "연락처 수정" : "연락처 등록"}
          </button>
          {contact && (
            <button
              type="button"
              className="event-private-contact-withdraw"
              disabled={busy}
              onClick={() => void change("DELETE")}
            >
              공개 중단
            </button>
          )}
        </div>
      )}
      {view?.canManage && editing && (
        <form className="event-private-contact-form" onSubmit={submit}>
          <fieldset disabled={busy}>
            <label htmlFor={formId + "-channel"}>연락 방법</label>
            <select
              id={formId + "-channel"}
              value={draft.channel}
              onChange={(event) =>
                setDraft({ ...draft, channel: event.target.value as Contact["channel"], value: "" })
              }
            >
              <option value="phone">전화번호</option>
              <option value="email">이메일</option>
              <option value="link">문의 링크</option>
            </select>
            <label htmlFor={formId + "-value"}>{labels[draft.channel]}</label>
            <input
              id={formId + "-value"}
              type={draft.channel === "phone" ? "tel" : draft.channel === "email" ? "email" : "url"}
              inputMode={
                draft.channel === "phone" ? "tel" : draft.channel === "email" ? "email" : "url"
              }
              value={draft.value}
              maxLength={2048}
              required
              autoComplete="off"
              placeholder={
                draft.channel === "phone"
                  ? "직접 제공할 담당자 전화번호"
                  : draft.channel === "email"
                    ? "event@example.com"
                    : "https://…"
              }
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
            />
            <label htmlFor={formId + "-note"}>
              문의 안내 <span>(선택)</span>
            </label>
            <textarea
              id={formId + "-note"}
              rows={3}
              maxLength={300}
              value={draft.note}
              placeholder="연락 가능한 시간이나 문의 시 필요한 내용을 적어주세요."
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
            <small>
              직접 제공할 연락처를 입력해주세요. 내 정보의 전화번호는 자동으로 공유되지 않아요.
            </small>
            {stale && (
              <p className="participation-error" role="alert">
                다른 화면에서 연락처가 변경됐어요. 최신 내용을 확인한 뒤 다시 수정해주세요.
              </p>
            )}
            <div className="event-private-contact-actions">
              <button type="submit" className="participation-primary" disabled={!!stale}>
                {busy ? "저장 중…" : "참가자에게 제공하기"}
              </button>
              {stale ? (
                <button
                  type="button"
                  className="participation-secondary"
                  onClick={() => edit(view)}
                >
                  최신 내용 불러오기
                </button>
              ) : (
                <button
                  type="button"
                  className="participation-secondary"
                  onClick={() => {
                    setEditing(false);
                    setDraft(emptyDraft);
                    setError("");
                  }}
                >
                  취소
                </button>
              )}
            </div>
          </fieldset>
        </form>
      )}
      {!view && !loading && (
        <button
          type="button"
          className="participation-secondary"
          disabled={busy}
          onClick={() => void load(true)}
        >
          <RefreshCw size={14} />
          다시 확인
        </button>
      )}
    </DialogContent>
  );
}
