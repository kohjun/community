"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Handshake,
  MapPin,
  Plus,
} from "lucide-react";
import { RecordBacklink } from "./record-discovery";
import { ParticipationShell } from "./participation-shell";
import { SafetyActions } from "./safety-actions";
import { Markdown } from "./markdown";
import { CATEGORIES } from "@/domain/categories";
import { CREW_TOPICS } from "@/domain/boards";
import {
  crewInputSchema,
  crewAnnouncementSchema,
  crewContributionSchema,
  type CrewDetail,
  type CrewInput,
} from "@/domain/crew";
import { postPath } from "@/domain/post-sharing";
import { crewDate } from "@/lib/crew-client";
import { useCrew } from "@/lib/use-crew";
import {
  CREW_ROLE_LABELS,
  CrewJoinPanel,
  CrewMembers,
  CrewRequests,
  CrewActivityFeed,
  CrewContributions,
  CrewStatusStats,
} from "./crew-parts";
type CrewStore = ReturnType<typeof useCrew>;
function baseInput(crew: CrewDetail): CrewInput {
  return {
    name: crew.name,
    description: crew.description,
    category: crew.category,
    region: crew.region,
    capacity: crew.capacity,
    recruiting: crew.recruiting,
  };
}
function CrewSettings({ store }: { store: CrewStore }) {
  const crew = store.data;
  const [draft, setDraft] = useState(() => baseInput(crew)),
    [stamp, setStamp] = useState(crew.updatedAt),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!dirty) {
      setDraft(baseInput(crew));
      setStamp(crew.updatedAt);
    }
  }, [crew.updatedAt, dirty]);
  function change<T extends keyof CrewInput>(key: T, value: CrewInput[T]) {
    setDirty(true);
    setDraft((before) => ({ ...before, [key]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = crewInputSchema.safeParse(draft);
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? "입력 내용을 확인해주세요.");
      return;
    }
    if (
      await store.mutate(
        "",
        { ...input.data, expectedUpdatedAt: stamp },
        "PATCH",
        "크루 정보를 수정했어요.",
      )
    ) {
      setDirty(false);
      setError("");
    }
  }
  return (
    <section className="crew-panel">
      <div className="crew-section-heading">
        <h2>크루 정보</h2>
      </div>
      <form className="crew-form" onSubmit={submit}>
        <label>
          이름
          <input
            value={draft.name}
            minLength={2}
            maxLength={40}
            required
            disabled={store.busy}
            onChange={(e) => change("name", e.target.value)}
          />
        </label>
        <label>
          소개
          <textarea
            value={draft.description}
            minLength={10}
            maxLength={2000}
            rows={4}
            required
            disabled={store.busy}
            onChange={(e) => change("description", e.target.value)}
          />
        </label>
        <div className="crew-form-row">
          <label>
            주제
            <select
              value={draft.category}
              disabled={store.busy}
              onChange={(e) => change("category", e.target.value as CrewInput["category"])}
            >
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            활동 지역
            <input
              value={draft.region}
              maxLength={80}
              disabled={store.busy}
              onChange={(e) => change("region", e.target.value)}
            />
          </label>
          <label>
            최대 인원
            <input
              type="number"
              min={2}
              max={100}
              value={draft.capacity}
              required
              disabled={store.busy}
              onChange={(e) => change("capacity", Number(e.target.value))}
            />
          </label>
        </div>
        <div className="crew-switch-row">
          <div>
            <strong>새 멤버 모집</strong>
            <small>현재 멤버 수보다 정원을 줄일 수 없어요.</small>
          </div>
          <button
            type="button"
            className={"crew-switch " + (draft.recruiting ? "is-on" : "")}
            role="switch"
            aria-checked={draft.recruiting}
            aria-label="새 멤버 모집"
            disabled={store.busy}
            onClick={() => change("recruiting", !draft.recruiting)}
          >
            <span />
          </button>
        </div>
        {dirty && stamp !== crew.updatedAt && (
          <p className="crew-form-note">
            다른 활동으로 크루 정보가 변경됐어요. 현재 정보를 확인한 뒤 다시 저장해주세요.
          </p>
        )}
        {error && (
          <p className="crew-alert" role="alert">
            {error}
          </p>
        )}
        <div className="crew-form-actions">
          {dirty && (
            <button
              className="crew-text-button"
              type="button"
              disabled={store.busy}
              onClick={() => {
                setDraft(baseInput(crew));
                setStamp(crew.updatedAt);
                setDirty(false);
                setError("");
              }}
            >
              현재 정보로 되돌리기
            </button>
          )}
          <button className="participation-primary" disabled={store.busy || !dirty}>
            정보 저장
          </button>
        </div>
      </form>
    </section>
  );
}
function CrewAnnouncement({ store }: { store: CrewStore }) {
  const [body, setBody] = useState(""),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = crewAnnouncementSchema.safeParse({ body });
    if (!input.success) {
      setError("공지 내용을 1~2,000자로 입력해주세요.");
      return;
    }
    if (await store.mutate("/announcements", input.data, "POST", "크루 공지를 올렸어요.")) {
      setBody("");
      setError("");
    }
  }
  return (
    <form className="crew-panel crew-form" onSubmit={submit}>
      <div className="crew-section-heading">
        <h2>크루 공지 올리기</h2>
        <small>리더와 운영진이 작성할 수 있어요.</small>
      </div>
      <textarea
        aria-label="크루 공지 내용"
        placeholder="다음 모임의 준비나 팀 소식을 알려주세요. 공지는 공개 활동 기록에 남아요."
        rows={3}
        maxLength={2000}
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={store.busy}
      />
      <small>마크다운 지원 · 연락처나 비공개 정보를 적지 마세요.</small>
      {body && (
        <div className="crew-announcement-preview">
          <Markdown>{body}</Markdown>
        </div>
      )}
      {error && (
        <p className="crew-alert" role="alert">
          {error}
        </p>
      )}
      <div className="crew-form-actions">
        <button className="participation-primary" disabled={store.busy}>
          공지 등록
        </button>
      </div>
    </form>
  );
}
function CrewEventManagement({ store }: { store: CrewStore }) {
  const [selected, setSelected] = useState("");
  return (
    <section className="crew-panel">
      <div className="crew-section-heading">
        <h2>함께 진행한 행사 연결</h2>
        <button
          className="crew-text-button"
          disabled={store.busy}
          onClick={() => store.loadAvailable()}
        >
          <Plus size={14} />내 행사 찾기
        </button>
      </div>
      <p className="crew-form-note">내가 등록하거나 담당하는 모집글을 연결할 수 있어요.</p>
      {store.available && (
        <form
          className="crew-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              selected &&
              (await store.mutate(
                "/events",
                { postId: selected },
                "POST",
                "행사를 크루에 연결했어요.",
              ))
            )
              setSelected("");
          }}
        >
          <select
            aria-label="연결할 내 행사"
            required
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={store.busy}
          >
            <option value="">
              {store.available.length ? "연결할 행사 선택" : "연결 가능한 행사가 없어요."}
            </option>
            {store.available.map((event) => (
              <option key={event.postId} value={event.postId}>
                {event.title}
              </option>
            ))}
          </select>
          <button className="participation-primary" disabled={store.busy || !selected}>
            연결
          </button>
        </form>
      )}
      <div className="crew-event-list">
        {store.data.events.map((event) => (
          <div key={event.postId} className="crew-event-row">
            <div>
              <Link href={postPath(event.postId)}>
                {event.title}
                <ArrowUpRight size={14} />
              </Link>
              <small>{crewDate(event.startsAt)}</small>
              <RecordBacklink postId={event.postId} />
            </div>
            <button
              className="crew-text-button"
              disabled={store.busy}
              onClick={() => {
                if (
                  window.confirm(
                    "'" + event.title + "' 연결을 해제할까요? 행사 자체는 삭제되지 않아요.",
                  )
                )
                  void store.mutate(
                    "/events/" + event.postId,
                    undefined,
                    "DELETE",
                    "행사 연결을 해제했어요.",
                  );
              }}
            >
              연결 해제
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
function CrewContributionForm({ store }: { store: CrewStore }) {
  const operatorEvents = store.data.events.filter((event) => event.canVerify);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget,
      form = new FormData(formElement);
    const input = crewContributionSchema.safeParse({
      postId: form.get("postId"),
      memberPublicId: form.get("memberPublicId"),
      role: form.get("role"),
      note: form.get("note"),
    });
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? "행사와 구성원, 역할을 선택해주세요.");
      return;
    }
    if (await store.mutate("/contributions", input.data, "POST", "참여 기여를 기록했어요.")) {
      setError("");
      formElement.reset();
    }
  }
  return (
    <section className="crew-panel">
      <div className="crew-section-heading">
        <h2>
          <CheckCircle2 size={17} />
          참여 기여 확인
        </h2>
      </div>
      <p className="crew-form-note">
        행사 주최자나 지정 담당자가 행사 종료 후 QR 참석 기록과 참가 전적을 확인해 등록합니다.
        자신의 기여는 다른 행사 담당자가 확인해야 해요. 크루 운영 권한만으로 참가 기록을 만들 수는
        없어요.
      </p>
      {!operatorEvents.length ? (
        <p className="crew-form-note">직접 담당하는 행사를 연결하면 기여를 확인할 수 있어요.</p>
      ) : (
        <form className="crew-form" onSubmit={submit}>
          <div className="crew-form-row">
            <label>
              담당 행사
              <select name="postId" required defaultValue="" disabled={store.busy}>
                <option value="" disabled>
                  행사 선택
                </option>
                {operatorEvents.map((event) => (
                  <option
                    key={event.postId}
                    value={event.postId}
                    disabled={!event.endsAt || new Date(event.endsAt).getTime() > Date.now()}
                  >
                    {event.title}
                    {!event.endsAt || new Date(event.endsAt).getTime() > Date.now()
                      ? " · 종료 후 확인"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              참여한 구성원
              <select name="memberPublicId" required defaultValue="" disabled={store.busy}>
                <option value="" disabled>
                  구성원 선택
                </option>
                {store.data.members.map((member) => (
                  <option key={member.publicId} value={member.publicId}>
                    {member.nickname}
                  </option>
                ))}
              </select>
            </label>
            <label>
              기여 역할
              <select name="role" required defaultValue="MC" disabled={store.busy}>
                {CREW_TOPICS.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            기여 내용
            <input
              name="note"
              maxLength={500}
              placeholder="예: 현장 진행과 마지막 미션을 담당했어요."
              disabled={store.busy}
            />
          </label>
          <small>
            확인된 기여는 크루 활동 기록에 공개됩니다. 활동점수 5점 · 행사별 1회, 하루 최대 10점.
          </small>
          {error && (
            <p className="crew-alert" role="alert">
              {error}
            </p>
          )}
          <div className="crew-form-actions">
            <button className="participation-primary" disabled={store.busy}>
              기여 확인
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
function CrewOwnerSettings({ store }: { store: CrewStore }) {
  const [target, setTarget] = useState("");
  const members = store.data.members.filter((member) => member.role !== "owner");
  return (
    <section className="crew-panel">
      <div className="crew-section-heading">
        <h2>리더 관리</h2>
      </div>
      <div className="crew-owner-option">
        <div>
          <strong>리더 권한 넘기기</strong>
          <p>새 리더에게 멤버 관리와 크루 보관 권한을 넘깁니다.</p>
        </div>
        <form
          className="crew-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const member = members.find((m) => m.publicId === target);
            if (
              member &&
              window.confirm(
                member.nickname +
                  "님에게 '" +
                  store.data.name +
                  "'의 리더 권한을 넘길까요? 나는 운영진으로 함께하게 됩니다.",
              )
            )
              void store.mutate(
                "/transfer",
                { memberPublicId: target },
                "POST",
                "새 리더에게 권한을 넘겼어요.",
              );
          }}
        >
          <select
            aria-label="새 크루 리더"
            required
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={store.busy || !members.length}
          >
            <option value="">새 리더 선택</option>
            {members.map((member) => (
              <option key={member.publicId} value={member.publicId}>
                {member.nickname}
              </option>
            ))}
          </select>
          <button className="participation-secondary" disabled={store.busy || !target}>
            권한 넘기기
          </button>
        </form>
      </div>
      <div className="crew-owner-option">
        <div>
          <strong>크루 보관하기</strong>
          <p>새 가입과 활동을 마감합니다. 소개와 멤버, 지난 활동 기록은 남아요.</p>
        </div>
        <button
          className="participation-secondary"
          disabled={store.busy}
          onClick={() => {
            if (
              window.confirm(
                "'" +
                  store.data.name +
                  "'을 보관할까요? 새 가입·공지·행사 연결·멤버 변경이 중지됩니다.",
              )
            )
              void store.mutate("/archive", {}, "POST", "크루를 보관했어요.");
          }}
        >
          크루 보관
        </button>
      </div>
    </section>
  );
}
export function CrewDetailView({ initial, canWrite }: { initial: CrewDetail; canWrite: boolean }) {
  const store = useCrew(initial, canWrite),
    crew = store.data;
  const [tab, setTab] = useState<"overview" | "members" | "activity" | "management">("overview"),
    [hidden, setHidden] = useState(false);
  const canManage =
    store.canWrite && !crew.archived && (crew.myRole === "owner" || crew.myRole === "manager");
  const canConfirm =
    store.canWrite &&
    !crew.archived &&
    !!crew.myRole &&
    crew.events.some((event) => event.canVerify);
  const activeTab = tab === "management" && !canManage ? "overview" : tab;
  const tabs = [
    { id: "overview", name: "소개" },
    { id: "members", name: "멤버" },
    { id: "activity", name: "활동" },
    ...(canManage ? [{ id: "management", name: "관리" }] : []),
  ] as const;
  return (
    <ParticipationShell>
      <Link className="crew-back-link" href="/players?tab=crews">
        <ArrowLeft size={15} />
        크루 둘러보기
      </Link>
      {hidden ? (
        <section className="crew-panel crew-empty">
          <h1>이 크루는 숨겨졌어요.</h1>
          <p>다른 팀을 찾아보세요.</p>
          <Link className="participation-primary" href="/players?tab=crews">
            크루 목록
          </Link>
        </section>
      ) : (
        <>
          <section className="crew-detail-hero">
            <div className="crew-hero-line">
              <span className="crew-eyebrow">
                <Handshake size={15} />
                {CATEGORIES.find((c) => c.slug === crew.category)?.name}
              </span>
              <span className="crew-state">
                {crew.archived ? "보관된 크루" : crew.recruiting ? "멤버 모집 중" : "모집 마감"}
              </span>
              {crew.myRole && (
                <span className="crew-state is-outline">{CREW_ROLE_LABELS[crew.myRole]}</span>
              )}
            </div>
            <h1>{crew.name}</h1>
            <p>
              <MapPin size={15} />
              {crew.region || "지역 자유"}
            </p>
            <CrewStatusStats crew={crew} />
          </section>
          <nav className="crew-detail-tabs" aria-label="크루 상세 메뉴">
            {tabs.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={activeTab === item.id}
                className={activeTab === item.id ? "active" : ""}
                onClick={() => setTab(item.id as typeof tab)}
              >
                {item.name}
              </button>
            ))}
          </nav>
          {(store.error || store.notice) && (
            <p className="crew-alert" role={store.error ? "alert" : "status"}>
              {store.error || store.notice}
              {store.error && (
                <button
                  className="crew-text-button"
                  type="button"
                  disabled={store.busy}
                  onClick={() => store.refresh()}
                >
                  현재 정보 확인
                </button>
              )}
            </p>
          )}
          {activeTab === "overview" && (
            <div className="crew-detail-sections">
              <section className="crew-panel">
                <div className="crew-section-heading">
                  <h2>우리 크루는요</h2>
                </div>
                <p className="crew-description">{crew.description}</p>
                <CrewJoinPanel
                  crew={crew}
                  canWrite={store.canWrite}
                  busy={store.busy}
                  onMutate={store.mutate}
                />
              </section>
              <section className="crew-panel">
                <div className="crew-section-heading">
                  <h2>
                    <CalendarDays size={17} />
                    함께하는 행사
                  </h2>
                  <span>{crew.events.length}회</span>
                </div>
                <div className="crew-event-list">
                  {crew.events.map((event) => (
                    <article className="crew-event-row" key={event.postId}>
                      <div>
                        <Link href={postPath(event.postId)}>
                          {event.title}
                          <ArrowUpRight size={14} />
                        </Link>
                        <small>{crewDate(event.startsAt)}</small>
                      </div>
                      <Link className="crew-text-button" href={"/events/" + event.postId}>
                        참가 · 공지방
                      </Link>
                    </article>
                  ))}
                </div>
                {!crew.events.length && (
                  <p className="crew-form-note">아직 연결된 행사가 없어요.</p>
                )}
              </section>
              <CrewContributions
                page={crew.contributions}
                busy={store.busy}
                onMore={() => store.more("contributions")}
              />
            </div>
          )}
          {activeTab === "members" && (
            <CrewMembers
              crew={crew}
              canWrite={store.canWrite}
              busy={store.busy}
              onMutate={store.mutate}
            />
          )}
          {activeTab === "activity" && (
            <div className="crew-detail-sections">
              {canManage && <CrewAnnouncement store={store} />}
              {canConfirm && !canManage && <CrewContributionForm store={store} />}
              <CrewActivityFeed
                page={crew.activity}
                busy={store.busy}
                onMore={() => store.more("activity")}
              />
            </div>
          )}
          {activeTab === "management" && canManage && (
            <div className="crew-detail-sections">
              <CrewRequests
                page={crew.requests}
                busy={store.busy}
                onDecision={(request, approve) =>
                  store.mutate(
                    "/requests/decision",
                    { requestId: request.id, approve },
                    "POST",
                    approve ? "가입을 승인했어요." : "가입 신청을 반려했어요.",
                  )
                }
                onMore={() => store.more("requests")}
              />
              <CrewSettings store={store} />
              <CrewEventManagement store={store} />
              <CrewContributionForm store={store} />
              {crew.myRole === "owner" && <CrewOwnerSettings store={store} />}
            </div>
          )}
          <div className="crew-safety">
            <SafetyActions
              targetType="crew"
              targetId={crew.id}
              isMine={crew.myRole === "owner"}
              canAct={store.canWrite}
              onBlocked={() => setHidden(true)}
            />
          </div>
        </>
      )}
    </ParticipationShell>
  );
}
