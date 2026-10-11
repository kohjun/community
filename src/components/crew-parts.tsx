"use client";
import Link from "next/link";
import { RecordBacklink } from "./record-discovery";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Users } from "lucide-react";
import { AVATAR_SYMBOLS } from "@/domain/boards";
import type {
  CrewDetail,
  CrewMember,
  CrewJoinRequest,
  CrewActivity,
  CrewContribution,
  CrewPage,
} from "@/domain/crew";
import { crewJoinSchema } from "@/domain/crew";
import { crewDate } from "@/lib/crew-client";
import { postPath } from "@/domain/post-sharing";
import { Markdown } from "./markdown";
export const CREW_ROLE_LABELS = { owner: "리더", manager: "운영진", member: "멤버" };
type Mutate = (path: string, body?: unknown, method?: string, message?: string) => Promise<boolean>;
export function CrewAvatar({ nickname, avatar }: { nickname: string; avatar: string }) {
  return (
    <span className="crew-avatar" role="img" aria-label={nickname + "의 프로필 아이콘"}>
      {AVATAR_SYMBOLS[avatar as keyof typeof AVATAR_SYMBOLS] ?? "✦"}
    </span>
  );
}
export function CrewJoinPanel({
  crew,
  canWrite,
  busy,
  onMutate,
}: {
  crew: CrewDetail;
  canWrite: boolean;
  busy: boolean;
  onMutate: Mutate;
}) {
  const [message, setMessage] = useState(""),
    [consent, setConsent] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = crewJoinSchema.safeParse({ message, publicNameConsent: consent });
    if (!input.success) {
      setError("가입 인사와 닉네임 공개 동의를 확인해주세요.");
      return;
    }
    if (await onMutate("/join", input.data, "POST", "가입 신청을 보냈어요.")) {
      setMessage("");
      setConsent(false);
      setError("");
    }
  }
  if (crew.myRole)
    return (
      <p className="crew-membership-note">
        <CheckCircle2 size={16} />
        {CREW_ROLE_LABELS[crew.myRole]}
        {crew.myRole === "manager" ? "으로" : "로"} 함께하고 있어요.
      </p>
    );
  if (crew.archived)
    return (
      <p className="crew-form-note">보관된 크루입니다. 소개와 지난 활동은 계속 볼 수 있어요.</p>
    );
  if (crew.myRequest?.status === "pending")
    return (
      <div className="crew-join-pending">
        <div>
          <strong>가입 신청을 확인하고 있어요.</strong>
          <p>운영진이 승인하면 크루 멤버로 함께할 수 있어요.</p>
        </div>
        <button
          className="participation-secondary"
          disabled={busy || !canWrite}
          onClick={() => onMutate("/withdraw", {}, "POST", "가입 신청을 취소했어요.")}
        >
          신청 취소
        </button>
      </div>
    );
  if (!crew.recruiting || crew.memberCount >= crew.capacity)
    return (
      <p className="crew-form-note">
        {crew.memberCount >= crew.capacity
          ? "현재 정원이 가득 찼어요."
          : "지금은 새로운 멤버를 모집하지 않아요."}
      </p>
    );
  if (!canWrite)
    return (
      <p className="crew-form-note">
        <Link href={"/login?next=/crews/" + crew.id}>로그인하고 이 크루에 참여해보세요.</Link>
      </p>
    );
  return (
    <form className="crew-join-form" onSubmit={submit}>
      <h3>우리 크루에 함께할래요?</h3>
      {crew.myRequest?.status === "rejected" && (
        <p className="crew-form-note">
          이전 신청이 승인되지 않았어요. 새로운 인사로 다시 신청할 수 있어요.
        </p>
      )}
      <textarea
        aria-label="크루 가입 인사"
        placeholder="함께하고 싶은 이유나 내가 잘하는 역할을 소개해주세요."
        minLength={2}
        maxLength={500}
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={busy}
        required
      />
      <label className="crew-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          required
          disabled={busy}
        />
        <span>가입하면 내 닉네임과 프로필 아이콘이 크루 구성원 목록에 공개되는 데 동의합니다.</span>
      </label>
      <div className="crew-form-actions">
        <small>연락처는 가입 신청에 포함되지 않아요.</small>
        <button className="participation-primary" disabled={busy || !consent}>
          가입 신청
        </button>
      </div>
      {error && (
        <p className="crew-alert" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
function MemberRow({
  member,
  crew,
  busy,
  onMutate,
}: {
  member: CrewMember;
  crew: CrewDetail;
  busy: boolean;
  onMutate: Mutate;
}) {
  const canManage = crew.myRole === "owner" && !crew.archived && member.role !== "owner";
  return (
    <div className="crew-member-row">
      <CrewAvatar nickname={member.nickname} avatar={member.avatar} />
      <div className="crew-member-copy">
        <Link href={"/players/" + member.publicId}>{member.nickname}</Link>
        <small>
          {CREW_ROLE_LABELS[member.role]} · {crewDate(member.joinedAt)} 합류
        </small>
      </div>
      {canManage && (
        <div className="crew-member-controls">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void onMutate(
                "/members/role",
                { memberPublicId: member.publicId, role: form.get("role") },
                "POST",
                "멤버 역할을 변경했어요.",
              );
            }}
          >
            <select
              aria-label={member.nickname + " 역할"}
              name="role"
              defaultValue={member.role}
              disabled={busy}
            >
              <option value="member">멤버</option>
              <option value="manager">운영진</option>
            </select>
            <button className="crew-text-button" disabled={busy}>
              변경
            </button>
          </form>
          <button
            className="crew-text-button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  member.nickname + "님을 크루에서 내보낼까요? 기존 활동 기록은 유지됩니다.",
                )
              )
                void onMutate(
                  "/members/remove",
                  { memberPublicId: member.publicId },
                  "POST",
                  "구성원에서 제외했어요.",
                );
            }}
          >
            내보내기
          </button>
        </div>
      )}
    </div>
  );
}
export function CrewMembers({
  crew,
  busy,
  canWrite,
  onMutate,
}: {
  crew: CrewDetail;
  busy: boolean;
  canWrite: boolean;
  onMutate: Mutate;
}) {
  return (
    <section className="crew-panel">
      <div className="crew-section-heading">
        <h2>
          함께 만드는 사람들 <span>{crew.memberCount}명</span>
        </h2>
        <small>공개에 동의한 닉네임과 아이콘</small>
      </div>
      <div className="crew-member-list">
        {crew.members.map((member) => (
          <MemberRow
            key={member.publicId + "-" + member.role}
            member={member}
            crew={crew}
            busy={busy || !canWrite}
            onMutate={onMutate}
          />
        ))}
      </div>
      {crew.myRole && canWrite && !crew.archived && (
        <div className="crew-membership-actions">
          {crew.myRole === "owner" ? (
            <p>리더는 운영 권한을 다른 멤버에게 넘긴 후 탈퇴할 수 있어요.</p>
          ) : (
            <button
              className="crew-text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("'" + crew.name + "' 크루에서 탈퇴할까요?"))
                  void onMutate("/leave", {}, "POST", "크루에서 탈퇴했어요.");
              }}
            >
              이 크루에서 탈퇴하기
            </button>
          )}
        </div>
      )}
    </section>
  );
}
export function CrewRequests({
  page,
  busy,
  onDecision,
  onMore,
}: {
  page: CrewPage<CrewJoinRequest> | null;
  busy: boolean;
  onDecision: (request: CrewJoinRequest, approve: boolean) => void;
  onMore: () => void;
}) {
  if (!page) return null;
  return (
    <section className="crew-panel">
      <div className="crew-section-heading">
        <h2>
          가입 신청 <span>{page.total}건</span>
        </h2>
        <small>운영진만 확인할 수 있어요.</small>
      </div>
      {!page.items.length && <p className="crew-form-note">새로운 가입 신청이 없어요.</p>}
      {page.items.map((request) => (
        <div className="crew-request-row" key={request.id}>
          <CrewAvatar nickname={request.nickname} avatar={request.avatar} />
          <div className="crew-request-copy">
            <strong>{request.nickname}</strong>
            <small>{crewDate(request.createdAt)}</small>
            <p>{request.message}</p>
          </div>
          {request.status === "pending" ? (
            <div className="crew-request-actions">
              <button
                className="participation-primary"
                disabled={busy}
                onClick={() => onDecision(request, true)}
              >
                승인
              </button>
              <button
                className="participation-secondary"
                disabled={busy}
                onClick={() => onDecision(request, false)}
              >
                반려
              </button>
            </div>
          ) : (
            <span className="crew-state">
              {request.status === "approved"
                ? "승인됨"
                : request.status === "withdrawn"
                  ? "신청 취소"
                  : "반려됨"}
            </span>
          )}
        </div>
      ))}
      {page.nextPage && (
        <button className="crew-more" disabled={busy} onClick={onMore}>
          신청 더 보기
        </button>
      )}
    </section>
  );
}
export function CrewActivityFeed({
  page,
  busy,
  onMore,
}: {
  page: CrewPage<CrewActivity>;
  busy: boolean;
  onMore: () => void;
}) {
  return (
    <section className="crew-panel">
      <div className="crew-section-heading">
        <h2>크루의 기록</h2>
        <small>{page.total}개 활동</small>
      </div>
      {!page.items.length && <p className="crew-form-note">첫 번째 에피소드를 기다리고 있어요.</p>}
      <div className="crew-timeline">
        {page.items.map((item) => (
          <article className="crew-activity" key={item.id}>
            <span className="crew-timeline-dot" />
            <div>
              <div className="crew-activity-byline">
                <strong>{item.nickname || "크루"}</strong>
                <time dateTime={item.createdAt}>{crewDate(item.createdAt)}</time>
                {item.kind === "announcement" && <span className="crew-state">크루 공지</span>}
              </div>
              {item.kind === "announcement" ? (
                <Markdown>{item.message}</Markdown>
              ) : (
                <p>{item.message}</p>
              )}
            </div>
          </article>
        ))}
      </div>
      {page.nextPage && (
        <button className="crew-more" disabled={busy} onClick={onMore}>
          활동 더 보기
        </button>
      )}
    </section>
  );
}
export function CrewContributions({
  page,
  busy,
  onMore,
}: {
  page: CrewPage<CrewContribution>;
  busy: boolean;
  onMore: () => void;
}) {
  return (
    <section className="crew-panel">
      <div className="crew-section-heading">
        <h2>
          <CheckCircle2 size={17} />
          확인된 기여
        </h2>
        <small>{page.total}건</small>
      </div>
      {!page.items.length && (
        <p className="crew-form-note">
          행사가 끝난 후 담당자가 구성원의 참여를 확인하면 이곳에 기록됩니다.
        </p>
      )}
      {page.items.map((item) => (
        <article className="crew-contribution" key={item.id}>
          <div>
            <strong>{item.nickname}</strong>
            <span className="crew-state">{item.role}</span>
            <small>{crewDate(item.createdAt)}</small>
          </div>
          <Link href={postPath(item.postId)}>{item.eventTitle}</Link>
          <RecordBacklink postId={item.postId} />
          {item.note && <p>{item.note}</p>}
        </article>
      ))}
      {page.nextPage && (
        <button className="crew-more" disabled={busy} onClick={onMore}>
          기여 더 보기
        </button>
      )}
    </section>
  );
}
export function CrewStatusStats({ crew }: { crew: CrewDetail }) {
  return (
    <div className="crew-stats">
      <span>
        <Users size={15} />
        <strong>{crew.memberCount}</strong>/{crew.capacity}명
      </span>
      <span>
        함께한 행사 <strong>{crew.eventCount}</strong>회
      </span>
      <span>
        확인된 기여 <strong>{crew.contributionCount}</strong>건
      </span>
    </div>
  );
}
