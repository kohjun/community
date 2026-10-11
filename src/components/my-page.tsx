"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Pencil,
  Bookmark,
  MessageCircle,
  Vote,
  Sparkles,
  Trophy,
  X,
  Check,
  MapPin,
  Camera,
  Trash2,
} from "lucide-react";
import { CATEGORIES } from "@/domain/categories";
import { AVATARS, AVATAR_SYMBOLS, activityLevel } from "@/domain/boards";
import { profileInputSchema } from "@/domain/validation";
import {
  isProfileReadyForApplication,
  type MyProfile,
  type ProfileAgeBand,
  type ProfileGender,
} from "@/domain/profile";
import { communityRequest } from "@/lib/api-client";
import { prepareImageForUpload } from "@/lib/image-precompression";
import { RequestSequence } from "@/lib/request-sequence";
import { ACTIVITY_REWARDS } from "@/domain/activity";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { ParticipationShell } from "./participation-shell";
import { TestAccountControls } from "./test-account-controls";
import { PushSettings } from "./push-settings";
import { MemberAvatar } from "./member-avatar";
import { useReadPosts } from "@/lib/use-read-posts";
const profileRequest = (
  method: string,
  body: unknown = undefined,
  path = "",
  signal?: AbortSignal,
) => communityRequest<MyProfile>(`/me${path}`, method, body, signal);
export function MyPage({ initial }: { initial: MyProfile }) {
  const readPosts = useReadPosts();
  const [profile, setProfile] = useState(initial),
    [tab, setTab] = useState("posts"),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [photoBusy, setPhotoBusy] = useState<"prepare" | "upload" | "remove" | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoPreparation = useRef<AbortController | null>(null);
  const sequence = useRef(new RequestSequence()),
    saving = useRef(false);
  const [draft, setDraft] = useState({
    nickname: initial.nickname,
    phoneNumber: initial.phoneNumber ?? "",
    ageBand: initial.ageBand,
    gender: initial.gender,
    bio: initial.bio,
    region: initial.region,
    avatar: initial.avatar,
    interests: initial.interests,
  });
  useEffect(() => {
    const requests = sequence.current;
    void requests.run(() => profileRequest("POST", {}, "/visit"), setProfile).catch(() => {});
    return () => {
      requests.invalidate();
      photoPreparation.current?.abort();
    };
  }, []);
  const level = activityLevel(profile.points),
    progress = level.next
      ? Math.min(
          100,
          Math.max(
            0,
            ((profile.points - level.threshold) / (level.next.threshold - level.threshold)) * 100,
          ),
        )
      : 100;
  const achievements = [
    { name: "첫 이야기", description: "글 1개 작성", done: profile.earned.posts > 0, icon: Pencil },
    {
      name: "대화의 시작",
      description: "댓글 1개 작성",
      done: profile.earned.comments > 0,
      icon: MessageCircle,
    },
    {
      name: "의견 한 스푼",
      description: "투표 1회 참여",
      done: profile.earned.votes > 0,
      icon: Vote,
    },
    {
      name: "꾸준한 플레이어",
      description: "7일 방문",
      done: profile.counts.visits >= 7,
      icon: Trophy,
    },
  ];
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    const parsed = profileInputSchema.safeParse(draft);
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "입력한 프로필 정보를 확인해주세요.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setMessage("");
    const token = sequence.current.begin();
    try {
      const next = await profileRequest("PATCH", parsed.data);
      if (sequence.current.isCurrent(token)) {
        setProfile(next);
        setEditing(false);
        setMessage("프로필을 저장했어요.");
      }
    } catch (e) {
      if (sequence.current.isCurrent(token))
        setMessage(e instanceof Error ? e.message : "저장 실패");
    } finally {
      saving.current = false;
      if (sequence.current.isCurrent(token)) setBusy(false);
    }
  }
  async function updatePhoto(file?: File) {
    if (saving.current) return;
    if (file && file.size > 5 * 1024 * 1024) {
      setMessage("프로필 사진은 5MB 이하로 올려주세요.");
      return;
    }
    if (file?.type && !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setMessage("JPG, PNG, WebP, GIF 사진을 선택해주세요.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setPhotoBusy(file ? "prepare" : "remove");
    setMessage("");
    const token = sequence.current.begin();
    const controller = new AbortController();
    photoPreparation.current = controller;
    try {
      const prepared = file
        ? await prepareImageForUpload(file, "profile", { signal: controller.signal })
        : undefined;
      if (!sequence.current.isCurrent(token)) return;
      const formData = prepared ? new FormData() : undefined;
      if (prepared) {
        formData!.set("file", prepared);
        setPhotoBusy("upload");
      }
      const updated = await profileRequest(
        file ? "POST" : "DELETE",
        formData,
        "/photo",
        controller.signal,
      );
      if (sequence.current.isCurrent(token)) {
        setProfile(updated);
        setMessage(file ? "프로필 사진을 저장했어요." : "프로필 사진을 삭제했어요.");
      }
    } catch (error) {
      if (sequence.current.isCurrent(token))
        setMessage(error instanceof Error ? error.message : "사진을 저장하지 못했어요.");
    } finally {
      if (photoPreparation.current === controller) photoPreparation.current = null;
      saving.current = false;
      if (sequence.current.isCurrent(token)) {
        setBusy(false);
        setPhotoBusy(null);
      }
    }
  }
  return (
    <ParticipationShell>
      <div className="account-page my-page">
        <header className="my-heading">
          <div className="flex items-center justify-between gap-3">
            <span>내 활동과 기록</span>
            <TestAccountControls />
          </div>
          <h1>나의 슬리퍼</h1>
          <Link href="/settings/account" className="safety-links">
            계정·신고·차단 관리 →
          </Link>
          <p>작은 참여가 쌓여, 나만의 예능이 됩니다.</p>
        </header>
        <div className="my-layout">
          <section className="my-profile-card">
            <div className="profile-cover">
              <span>나의 플레이 프로필</span>
              <Sparkles size={26} />
            </div>
            <div className="profile-body">
              <MemberAvatar
                nickname={profile.nickname}
                avatar={profile.avatar}
                photoSrc={profile.photoSrc}
                className="profile-avatar-large"
              />
              <div className="profile-level">
                Lv.{level.level} {level.name}
              </div>
              <h2>{profile.nickname}</h2>
              <Link className="player-profile-link" href={`/players/${profile.publicId}`}>
                참가 전적 · 매너 프로필 보기 →
              </Link>
              <details className="profile-public-id">
                <summary>담당자 지정용 프로필 ID</summary>
                <span>행사 담당자에게 이 ID를 전달해주세요.</span>
                <code>{profile.publicId}</code>
              </details>
              <p>{profile.bio || "나를 소개하는 한 줄을 남겨보세요."}</p>
              {profile.region && (
                <span className="profile-region">
                  <MapPin size={13} />
                  {profile.region}
                </span>
              )}
              <div className="profile-interests">
                {profile.interests.map((slug) => (
                  <span key={slug}>{CATEGORIES.find((item) => item.slug === slug)?.name}</span>
                ))}
              </div>
              <div className="profile-member-details">
                <div>
                  <span>연락처</span>
                  <strong>{profile.phoneNumber || "입력 필요"}</strong>
                </div>
                <div>
                  <span>번호 확인</span>
                  <strong>{profile.phoneVerifiedAt ? "문자 인증 완료" : "문자 미인증"}</strong>
                </div>
                <div>
                  <span>기본정보</span>
                  {isProfileReadyForApplication(profile) ? (
                    <strong className="profile-member-status">입력 완료</strong>
                  ) : (
                    <Link href="/signup?returnTo=%2Fmypage">입력하고 모임 참여하기 →</Link>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft({
                    nickname: profile.nickname,
                    phoneNumber: profile.phoneNumber ?? "",
                    ageBand: profile.ageBand,
                    gender: profile.gender,
                    bio: profile.bio,
                    region: profile.region,
                    avatar: profile.avatar,
                    interests: profile.interests,
                  });
                  setEditing((value) => !value);
                }}
              >
                <Pencil size={15} />
                {editing ? "편집 닫기" : "프로필 편집"}
              </Button>
              <small className="joined-date">
                {new Date(profile.joinedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
                부터 함께했어요
              </small>
            </div>
          </section>
          <div className="my-main">
            <section className="activity-card">
              <div className="activity-heading">
                <div>
                  <span>꾸준한 참여의 기록</span>
                  <h2>쌓이는 즐거움, 활동점수</h2>
                </div>
                <strong>
                  {profile.points}
                  <small>P</small>
                </strong>
              </div>
              <div
                className="level-progress"
                role="progressbar"
                aria-label="다음 활동 레벨까지 진행률"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="level-progress-label">
                <span>
                  Lv.{level.level} {level.name}
                </span>
                <span>
                  {level.next
                    ? `${level.next.name}까지 ${level.next.threshold - profile.points}P`
                    : "최고 레벨 달성!"}
                </span>
              </div>
              <div className="activity-stats">
                {[
                  { label: "작성한 글", value: profile.counts.posts },
                  { label: "남긴 댓글", value: profile.counts.comments },
                  { label: "참여 투표", value: profile.counts.votes },
                  { label: "방문한 날", value: profile.counts.visits },
                ].map((item) => (
                  <div key={item.label}>
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
              <p className="points-guide">
                글 +{ACTIVITY_REWARDS.post.points}P · 댓글 +{ACTIVITY_REWARDS.comment.points}P ·
                투표 +{ACTIVITY_REWARDS.vote.points}P · 하루 방문 +{ACTIVITY_REWARDS.visit.points}P
                <br />
                일별 한도: 글 {ACTIVITY_REWARDS.post.dailyCap}P, 댓글{" "}
                {ACTIVITY_REWARDS.comment.dailyCap}P, 투표 {ACTIVITY_REWARDS.vote.dailyCap}P.
                재투표·같은 날 방문은 중복 적립되지 않아요.
              </p>
            </section>
            {editing && (
              <section className="profile-edit-panel">
                <div className="section-heading">
                  <h2>프로필과 기본 정보</h2>
                  <button aria-label="프로필 편집 닫기" onClick={() => setEditing(false)}>
                    <X size={18} />
                  </button>
                </div>
                <form onSubmit={save}>
                  <fieldset disabled={busy} className="write-fields">
                    <div className="profile-photo-editor" aria-busy={photoBusy !== null}>
                      <MemberAvatar
                        nickname={profile.nickname}
                        avatar={draft.avatar}
                        photoSrc={profile.photoSrc}
                        className="profile-photo-preview"
                      />
                      <div className="profile-photo-editor-body">
                        <span className="field-label">프로필 사진</span>
                        <div className="profile-photo-actions">
                          <button type="button" onClick={() => photoInput.current?.click()}>
                            <Camera size={14} />
                            {photoBusy === "prepare"
                              ? "사진 준비 중…"
                              : photoBusy === "upload"
                                ? "사진 저장 중…"
                                : profile.photoSrc
                                  ? "사진 변경"
                                  : "사진 추가"}
                          </button>
                          {profile.photoSrc && (
                            <button
                              type="button"
                              onClick={() => void updatePhoto()}
                              aria-label="프로필 사진 삭제"
                            >
                              <Trash2 size={14} />
                              {photoBusy === "remove" ? "삭제 중…" : "삭제"}
                            </button>
                          )}
                        </div>
                        <small>
                          최대 5MB · 용량을 줄여 자동 저장해요. 움직이는 사진은 첫 장면만 저장돼요.
                        </small>
                      </div>
                      <input
                        ref={photoInput}
                        type="file"
                        hidden
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        aria-label="프로필 사진 선택"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          if (file) void updatePhoto(file);
                        }}
                      />
                    </div>
                    <label className="field-label">
                      프로필 아이콘
                      <small>사진이 없을 때 표시돼요.</small>
                    </label>
                    <div className="avatar-picker">
                      {AVATARS.map((avatar) => (
                        <button
                          key={avatar}
                          type="button"
                          aria-label={`${avatar} 아이콘`}
                          aria-pressed={draft.avatar === avatar}
                          className={draft.avatar === avatar ? "selected" : ""}
                          onClick={() => setDraft((current) => ({ ...current, avatar }))}
                        >
                          {AVATAR_SYMBOLS[avatar]}
                        </button>
                      ))}
                    </div>
                    <div className="form-grid">
                      <label className="field-label">
                        닉네임{" "}
                        <input
                          required
                          minLength={2}
                          maxLength={24}
                          value={draft.nickname}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, nickname: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        활동 지역{" "}
                        <input
                          maxLength={80}
                          placeholder="서울 · 성수"
                          value={draft.region}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, region: event.target.value }))
                          }
                        />
                      </label>
                    </div>
                    <div className="form-grid">
                      <label className="field-label">
                        휴대폰 번호
                        <input
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          maxLength={40}
                          placeholder="010-1234-5678"
                          value={draft.phoneNumber}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, phoneNumber: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        연령대 <small>선택 · 비공개</small>
                        <select
                          value={draft.ageBand ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              ageBand: (event.target.value || null) as ProfileAgeBand | null,
                            }))
                          }
                        >
                          <option value="">선택 안 함</option>
                          <option value="20s">20대</option>
                          <option value="30s">30대</option>
                          <option value="40s">40대</option>
                          <option value="50plus">50대 이상</option>
                        </select>
                      </label>
                    </div>
                    <p className="profile-contact-note">
                      모임 신청 때 내 연락처가 자동으로 사용돼요. 번호를 바꾸면 기존 문자 인증은
                      해제돼요. 현재 문자 인증은 준비 중이며, 번호 형식만 확인해요.
                    </p>
                    <label className="field-label">
                      성별 <small>선택 · 비공개</small>
                      <select
                        value={draft.gender ?? ""}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            gender: (event.target.value || null) as ProfileGender | null,
                          }))
                        }
                      >
                        <option value="">선택 안 함</option>
                        <option value="female">여성</option>
                        <option value="male">남성</option>
                        <option value="other">그 외</option>
                      </select>
                    </label>
                    <label className="field-label">
                      자기소개
                      <textarea
                        maxLength={300}
                        rows={3}
                        value={draft.bio}
                        placeholder="어떤 즐거움을 좋아하나요?"
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, bio: event.target.value }))
                        }
                      />
                    </label>
                    <label className="field-label">관심사</label>
                    <div className="interest-picker">
                      {CATEGORIES.map((category) => (
                        <button
                          key={category.slug}
                          type="button"
                          className={draft.interests.includes(category.slug) ? "selected" : ""}
                          aria-pressed={draft.interests.includes(category.slug)}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              interests: current.interests.includes(category.slug)
                                ? current.interests.filter((item) => item !== category.slug)
                                : [...current.interests, category.slug],
                            }))
                          }
                        >
                          {category.name}
                        </button>
                      ))}
                    </div>
                    <Button type="submit">
                      <Check size={16} />
                      {busy && !photoBusy ? "저장 중…" : "프로필 저장"}
                    </Button>
                  </fieldset>
                </form>
              </section>
            )}
            <PushSettings />
            <section className="achievement-section">
              <div className="section-heading">
                <h2>
                  <Trophy size={19} />
                  나의 작은 성취
                </h2>
              </div>
              <div className="achievement-grid">
                {achievements.map((item) => (
                  <div key={item.name} className={cn("achievement", item.done && "earned")}>
                    <item.icon size={21} />
                    <strong>{item.name}</strong>
                    <small>{item.done ? "달성했어요" : item.description}</small>
                  </div>
                ))}
              </div>
            </section>
            <section className="my-activity">
              <div className="my-tabs">
                {[
                  { value: "posts", label: "내 글", icon: Pencil },
                  { value: "comments", label: "내 댓글", icon: MessageCircle },
                  { value: "saved", label: "북마크", icon: Bookmark },
                  { value: "points", label: "점수 기록", icon: Sparkles },
                ].map((item) => (
                  <button
                    key={item.value}
                    className={tab === item.value ? "active" : ""}
                    aria-pressed={tab === item.value}
                    onClick={() => setTab(item.value)}
                  >
                    <item.icon size={15} />
                    {item.label}
                  </button>
                ))}
              </div>
              {(tab === "posts" || tab === "saved") && (
                <div className="my-post-list">
                  {(tab === "posts" ? profile.recentPosts : profile.savedPosts).map((post) => (
                    <Link key={post.id} href={`/?post=${post.id}`}>
                      <span>{post.kind === "후기" ? "이야기" : post.kind}</span>
                      <strong
                        className={cn(readPosts.includes(post.id.toLowerCase()) && "title-is-read")}
                      >
                        {post.title}
                        {readPosts.includes(post.id.toLowerCase()) && (
                          <span className="sr-only"> (읽은 글)</span>
                        )}
                      </strong>
                      <small>
                        {post.time} · 댓글 {post.comments}
                      </small>
                    </Link>
                  ))}
                  {!(tab === "posts" ? profile.recentPosts : profile.savedPosts).length && (
                    <p className="account-list-empty">
                      {tab === "posts"
                        ? "첫 이야기를 커뮤니티에 남겨보세요."
                        : "좋아하는 이야기를 북마크에 담아보세요."}
                    </p>
                  )}
                  {tab === "posts" && profile.counts.posts > 20 && (
                    <Link href="/?view=mine" className="my-more">
                      내 글 모두 보기 →
                    </Link>
                  )}
                  {tab === "saved" && profile.counts.bookmarks > 20 && (
                    <Link href="/?view=bookmarks" className="my-more">
                      북마크 모두 보기 →
                    </Link>
                  )}
                </div>
              )}
              {tab === "comments" && (
                <div className="my-post-list">
                  {profile.recentComments.map((comment) => (
                    <Link key={comment.id} href={`/?post=${comment.postId}`}>
                      <small
                        className={cn(
                          readPosts.includes(comment.postId.toLowerCase()) && "title-is-read",
                        )}
                      >
                        {comment.postTitle}
                        {readPosts.includes(comment.postId.toLowerCase()) && (
                          <span className="sr-only"> (읽은 글)</span>
                        )}
                      </small>
                      <strong>{comment.body.slice(0, 140)}</strong>
                      <small>
                        {new Date(comment.createdAt).toLocaleDateString("ko-KR", {
                          timeZone: "Asia/Seoul",
                        })}
                      </small>
                    </Link>
                  ))}
                  {!profile.recentComments.length && (
                    <p className="account-list-empty">다른 사람의 이야기에 한마디를 보태보세요.</p>
                  )}
                </div>
              )}
              {tab === "points" && (
                <div className="point-history">
                  {profile.history.map((item, index) => (
                    <div key={index}>
                      <span>
                        {ACTIVITY_REWARDS[item.reason as keyof typeof ACTIVITY_REWARDS]?.label ??
                          item.reason}
                      </span>
                      <small>
                        {new Date(item.createdAt).toLocaleDateString("ko-KR", {
                          timeZone: "Asia/Seoul",
                        })}
                      </small>
                      <strong>+{item.points}P</strong>
                    </div>
                  ))}
                  {!profile.history.length && (
                    <p className="account-list-empty">다음 참여부터 활동점수가 쌓여요.</p>
                  )}
                </div>
              )}
              <p className="my-list-caption">
                최근 활동 20개를 표시해요. 점수와 활동 수는 전체 기록 기준입니다.
              </p>
            </section>
          </div>
        </div>
        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
      </div>
    </ParticipationShell>
  );
}
