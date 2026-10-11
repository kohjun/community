"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BadgeCheck, Check, Search, Users } from "lucide-react";
import { z } from "zod";
import {
  CREDIT_ROLES,
  creditCreateSchema,
  type CreditPage,
  type CreditRole,
  type CreditStatus,
  type CreditView,
} from "@/domain/records";
import type { PlayerProfileView } from "@/domain/player";
import { appRequest, RequestError } from "@/lib/api-client";
export const CREDIT_STATUS_LABELS: Record<CreditStatus, string> = {
  pending: "수락 대기",
  accepted: "본인 수락",
  rejected: "수락 거절",
  withdrawn: "노출 철회",
  correction_requested: "정정 요청",
};
function playerId(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    const id = url.pathname.match(/^\/players\/([^/]+)\/?$/)?.[1];
    return id && z.uuid().safeParse(id).success ? id : null;
  } catch {
    return null;
  }
}
function CreditRow({
  credit,
  busy,
  onDecision,
  onUpdate,
}: {
  credit: CreditView;
  busy: boolean;
  onDecision?: (
    credit: CreditView,
    decision: "accept" | "reject" | "withdraw" | "correction",
    note: string,
  ) => Promise<boolean>;
  onUpdate?: (
    credit: CreditView,
    role: CreditRole,
    note: string,
    revoked: boolean,
  ) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"correction" | "withdraw" | "edit" | null>(null),
    [note, setNote] = useState(""),
    [role, setRole] = useState(credit.role);
  return (
    <article className="record-credit-row">
      <div>
        <Link href={"/players/" + credit.publicId}>
          <strong>
            {credit.nickname} · {credit.role}
          </strong>
        </Link>
        <p>{credit.note || "기여 내용 미등록"}</p>
        <small>
          {CREDIT_STATUS_LABELS[credit.status]} ·{" "}
          {credit.confirmedByName ? credit.confirmedByName + " 확인" : "담당자 확인"}
        </small>
        {credit.correctionNote && (
          <p className="record-notice">정정 요청: {credit.correctionNote}</p>
        )}
      </div>
      <div className="record-actions">
        {onDecision && credit.canDecide && credit.status === "pending" && (
          <>
            <button
              className="participation-primary"
              disabled={busy}
              onClick={() => void onDecision(credit, "accept", "")}
            >
              <Check size={13} />
              표시 동의하고 수락
            </button>
            <button
              className="participation-secondary"
              disabled={busy}
              onClick={() => void onDecision(credit, "reject", "")}
            >
              거절
            </button>
          </>
        )}
        {onDecision && credit.canDecide && ["pending", "accepted"].includes(credit.status) && (
          <>
            <button
              className="participation-secondary"
              disabled={busy}
              onClick={() => {
                setMode("correction");
                setNote("");
              }}
            >
              정정 요청
            </button>
            {credit.status === "accepted" && (
              <button
                className="participation-secondary"
                disabled={busy}
                onClick={() => {
                  setMode("withdraw");
                  setNote("");
                }}
              >
                노출 철회
              </button>
            )}
          </>
        )}
        {onUpdate && credit.canManage && (
          <button
            className="participation-secondary"
            disabled={busy}
            onClick={() => {
              setMode("edit");
              setNote(credit.note);
              setRole(credit.role);
            }}
          >
            기여 수정
          </button>
        )}
      </div>
      {mode && (
        <div className="record-inline-request" style={{ flexBasis: "100%" }}>
          {mode === "edit" && (
            <label className="record-field">
              역할
              <select value={role} onChange={(event) => setRole(event.target.value as CreditRole)}>
                {CREDIT_ROLES.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="record-field">
            {mode === "edit"
              ? "기여 내용"
              : mode === "withdraw"
                ? "노출 철회 사유"
                : "정정이 필요한 내용"}
            <textarea
              maxLength={500}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                mode === "correction"
                  ? "역할 또는 기여 내용에서 수정할 부분을 알려주세요."
                  : "담당자에게 전달할 내용을 적어주세요."
              }
            />
          </label>
          <div className="record-actions">
            <button
              className="participation-primary"
              disabled={busy || (mode !== "edit" && !note.trim())}
              onClick={() => {
                const work =
                  mode === "edit"
                    ? onUpdate?.(credit, role, note, false)
                    : onDecision?.(credit, mode, note);
                void work?.then((success) => {
                  if (success) setMode(null);
                });
              }}
            >
              {mode === "edit" ? "수정 확인 요청 보내기" : "요청 보내기"}
            </button>
            {mode === "edit" && (
              <button
                className="participation-secondary"
                disabled={busy || !note.trim()}
                onClick={() =>
                  void onUpdate?.(credit, role, note, true).then((success) => {
                    if (success) setMode(null);
                  })
                }
              >
                기여 확인 철회
              </button>
            )}
            <button
              className="participation-secondary"
              disabled={busy}
              onClick={() => setMode(null)}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
export function EventCreditManager({ postId }: { postId: string }) {
  const [data, setData] = useState<CreditPage | null>(null),
    [profileLink, setProfileLink] = useState(""),
    [member, setMember] = useState<PlayerProfileView | null>(null),
    [role, setRole] = useState<CreditRole>("기획자"),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const gate = useRef(false),
    sequence = useRef(0),
    base = "/api/event-credits/events/" + postId;
  useEffect(() => {
    const controller = new AbortController();
    appRequest<CreditPage>(base, "GET", undefined, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "제작진을 불러오지 못했어요.");
      });
    return () => controller.abort();
  }, [base]);
  async function identify() {
    const publicId = playerId(profileLink);
    if (!publicId) {
      setError("플레이어 프로필 화면의 주소를 붙여넣어주세요.");
      return;
    }
    const token = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const value = await appRequest<PlayerProfileView>("/api/players/" + publicId);
      if (token === sequence.current) {
        setMember(value);
        if (value.isMe) setError("자신의 제작 역할은 다른 담당자가 확인해야 해요.");
      }
    } catch (cause) {
      if (token === sequence.current) {
        setMember(null);
        setError(cause instanceof Error ? cause.message : "플레이어를 확인하지 못했어요.");
      }
    } finally {
      if (token === sequence.current) setBusy(false);
    }
  }
  async function mutation(work: () => Promise<unknown>, message: string): Promise<boolean> {
    if (gate.current) return false;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setData(await appRequest<CreditPage>(base));
      setNotice(message);
      return true;
    } catch (cause) {
      if (
        cause instanceof RequestError &&
        ["FORBIDDEN", "UNAUTHENTICATED", "NOT_FOUND"].includes(cause.code ?? "")
      )
        setData(null);
      setError(cause instanceof Error ? cause.message : "제작진을 저장하지 못했어요.");
      return false;
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!member) {
      setError("먼저 플레이어를 확인해주세요.");
      return;
    }
    const input = creditCreateSchema.safeParse({ memberPublicId: member.publicId, role, note });
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? "기여 내용을 확인해주세요.");
      return;
    }
    await mutation(
      () => appRequest(base, "POST", input.data),
      "담당자 확인을 등록하고 당사자에게 수락 요청을 보냈어요.",
    );
  }
  return (
    <section className="record-panel">
      <h2>
        <Users size={17} />
        제작진 확인
      </h2>
      <p className="record-note">
        참가 신청 여부와 관계없이 함께 제작한 회원을 등록할 수 있어요. 당사자가 수락한 완료 행사만
        제작 경력에 반영됩니다.
      </p>
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="record-notice" role="status">
          {notice}
        </p>
      )}
      <form onSubmit={submit}>
        <div className="record-filters">
          <label>
            플레이어 프로필 링크
            <input
              type="url"
              value={profileLink}
              onChange={(event) => {
                setProfileLink(event.target.value);
                setMember(null);
                sequence.current++;
              }}
              maxLength={500}
              placeholder="플레이어의 프로필 주소를 붙여넣기"
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="participation-secondary"
            disabled={busy || !profileLink.trim()}
            onClick={() => void identify()}
          >
            <Search size={14} />
            플레이어 확인
          </button>
        </div>
        {member && <p className="record-notice">{member.nickname}님의 제작 기여를 확인합니다.</p>}
        <div className="record-form-grid">
          <label className="record-field">
            맡은 역할
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as CreditRole)}
              disabled={busy}
            >
              {CREDIT_ROLES.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="record-field">
            기여 내용
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
              maxLength={500}
              rows={3}
              placeholder="어떤 부분을 함께 만들었는지 적어주세요."
            />
          </label>
        </div>
        <button className="participation-primary" disabled={busy || !member || member.isMe}>
          <BadgeCheck size={14} />
          확인하고 수락 요청
        </button>
      </form>
      <div style={{ marginTop: 16 }}>
        {data?.items.map((credit) => (
          <CreditRow
            key={credit.id + credit.updatedAt}
            credit={credit}
            busy={busy}
            onUpdate={(item, nextRole, nextNote, revoked) =>
              mutation(
                () =>
                  appRequest("/api/event-credits/" + item.id, "PATCH", {
                    expectedUpdatedAt: item.updatedAt,
                    role: nextRole,
                    note: nextNote,
                    revoked,
                  }),
                revoked
                  ? "기여 확인을 철회했어요."
                  : "수정한 기여 내용에 대한 수락 요청을 보냈어요.",
              )
            }
          />
        ))}
      </div>
    </section>
  );
}
export function MyEventCredits({
  defaultOpen = false,
  onChanged,
}: {
  defaultOpen?: boolean;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<CreditPage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const gate = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    appRequest<CreditPage>("/api/event-credits/me", "GET", undefined, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "제작진 요청을 불러오지 못했어요.");
      });
    return () => controller.abort();
  }, []);
  async function decide(
    credit: CreditView,
    decision: "accept" | "reject" | "withdraw" | "correction",
    note: string,
  ): Promise<boolean> {
    if (gate.current) return false;
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await appRequest("/api/event-credits/" + credit.id + "/decision", "POST", {
        expectedUpdatedAt: credit.updatedAt,
        decision,
        note,
      });
      setData(await appRequest<CreditPage>("/api/event-credits/me"));
      setNotice(
        decision === "accept"
          ? "기여 확인을 수락했어요. 완료된 행사는 내 제작 경력에 반영됩니다."
          : decision === "withdraw"
            ? "해당 기여의 노출을 철회했어요."
            : decision === "correction"
              ? "담당자에게 정정 요청을 보냈어요."
              : "수락 요청을 거절했어요.",
      );
      onChanged?.();
      return true;
    } catch (cause) {
      if (
        cause instanceof RequestError &&
        ["UNAUTHENTICATED", "FORBIDDEN"].includes(cause.code ?? "")
      )
        setData(null);
      setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했어요.");
      return false;
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="record-panel record-profile-settings" open={defaultOpen || undefined}>
      <summary>
        나에게 온 제작진 확인 요청{" "}
        {data?.items.filter(
          (item) => item.status === "pending" || item.status === "correction_requested",
        ).length
          ? "· " +
            data.items.filter(
              (item) => item.status === "pending" || item.status === "correction_requested",
            ).length
          : ""}
      </summary>
      <div>
        <p className="record-note">
          내가 맡은 역할과 기여 내용이 맞는지 확인해주세요. 수락하면 이 행사의 제작진으로 로그인
          회원에게 닉네임과 역할이 표시됩니다. 전체 포트폴리오의 공개는 별도로 직접 선택합니다.
        </p>
        {error && (
          <p className="participation-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="record-notice" role="status">
            {notice}
          </p>
        )}
        {data?.items.map((credit) => (
          <div key={credit.id + credit.updatedAt}>
            <Link className="record-backlink" href={"/events/" + credit.postId}>
              {credit.eventTitle}
            </Link>
            <CreditRow credit={credit} busy={busy} onDecision={decide} />
          </div>
        ))}
        {data && !data.items.length && (
          <p className="record-note">아직 받은 제작진 확인 요청이 없어요.</p>
        )}
      </div>
    </details>
  );
}
