"use client";
import { DISCUSSION_TYPES, DISCUSSION_LABELS, type DiscussionType } from "@/domain/discussions";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Pencil, X, Plus, Check, Link2 } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { PostBody } from "./post-body";
import { RichPostEditor, type RichPostEditorHandle } from "./rich-post-editor";
import { EventLocationField } from "./event-location-field";
import type { VenuePoint } from "@/domain/discovery";
import { postDocumentToMarkdown, type PostDocument } from "@/domain/post-document";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import { BOARD_TOPICS } from "@/domain/boards";
import { createPostSchema, publishPostSchema, type CreatePostInput } from "@/domain/validation";
import { evaluateContentPolicy } from "@/domain/content-policy";
import { contentPolicyFields, ContentPolicyInputError } from "@/domain/content-policy-fields";
import type { CommunityPost } from "@/domain/community";
import type { PublicImage, PublicVideo } from "@/domain/contracts";
import { cn } from "@/lib/utils";
import { prepareImageForUpload } from "@/lib/image-precompression";
import { topicForSlug, topicsForTags, type TopicSlug } from "@/domain/topics";
import { TopicTagPicker } from "./topic-connections";
import { mayCloseWriteDialog } from "@/domain/write-close";
import { MEETUP_TYPE_LABELS } from "@/domain/meetup-types";
import { scheduleText } from "@/domain/recruit-schedule";
import rf from "./recruit-form.module.css";

const CONTACT_PRESETS = ["댓글로 문의해주세요", "신청 페이지에서 문의해주세요"] as const;
export function WriteDialog({
  open,
  onOpenChange,
  initialCategory,
  initialTopic,
  initialKind,
  initialDiscussionType,
  post,
  onPublish,
  upload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCategory: CategorySlug;
  initialTopic?: TopicSlug | undefined;
  initialKind?: "이야기" | "모집" | "투표" | undefined;
  initialDiscussionType?: DiscussionType | undefined;
  post: CommunityPost | null;
  onPublish: (input: CreatePostInput) => Promise<boolean>;
  upload: (file: File) => Promise<PublicImage>;
}) {
  const connectedTopic = initialTopic ? topicForSlug(initialTopic) : null;
  const [category, setCategory] = useState<CategorySlug>(post?.category ?? initialCategory);
  // Fixed for the dialog's lifetime; the caller picks 이야기 or 모집 before opening it.
  const [kind] = useState<"이야기" | "모집" | "투표">(
    post?.kind === "후기" ? "이야기" : (post?.kind ?? initialKind ?? "이야기"),
  );
  const [discussionType, setDiscussionType] = useState<DiscussionType>(
    post?.discussionType ?? initialDiscussionType ?? "free",
  );
  const [spoiler, setSpoiler] = useState(post?.spoiler ?? false);
  const [spoilerTitle, setSpoilerTitle] = useState(post?.spoilerTitle ?? "");
  const [spoilerSummary, setSpoilerSummary] = useState(post?.spoilerSummary ?? "");
  const [title, setTitle] = useState(post?.title ?? ""),
    [body, setBody] = useState(post?.body ?? "");
  const [bodyDocument, setBodyDocument] = useState<PostDocument | null>(post?.bodyDocument ?? null);
  const [videos, setVideos] = useState<PublicVideo[]>(post?.videos ?? []);
  const [uploadPending, setUploadPending] = useState(false);
  const uploadPendingRef = useRef(false);
  const [imagePreparing, setImagePreparing] = useState(false);
  const imagePreparation = useRef<AbortController | null>(null);
  useEffect(() => () => imagePreparation.current?.abort(), []);
  const editorRef = useRef<RichPostEditorHandle>(null);
  const [anonymous, setAnonymous] = useState(post?.anonymous ?? false),
    [preview, setPreview] = useState(false);
  const [mode, setMode] = useState<"direct" | "external">(
    post?.kind === "모집" && !post.applicationUrl ? "direct" : "external",
  );
  const [url, setUrl] = useState(post?.applicationUrl ?? ""),
    [location, setLocation] = useState(post?.location ?? ""),
    [date, setDate] = useState(post?.eventDate ?? ""),
    [fee, setFee] = useState(post?.eventFee ?? ""),
    [contact, setContact] = useState(post?.contactInfo ?? "");
  const [venue, setVenue] = useState<VenuePoint | null>(
    post?.venueLatitude != null && post?.venueLongitude != null
      ? {
          latitude: post.venueLatitude,
          longitude: post.venueLongitude,
          ...(post.communityVenueId
            ? {
                communityVenueId: post.communityVenueId,
                ...(post.communityVenueVersion
                  ? { communityVenueVersion: post.communityVenueVersion }
                  : {}),
              }
            : {}),
        }
      : null,
  );
  const [venueChanged, setVenueChanged] = useState(false);
  // Date/time pickers that write a readable schedule into `date`; not part of the saved draft.
  const [schedule, setSchedule] = useState({ date: "", start: "", end: "" });
  const [feePaid, setFeePaid] = useState(!!post?.eventFee && post.eventFee.trim() !== "무료");
  const [topic, setTopic] = useState(post?.topic ?? ""),
    [tags, setTags] = useState(post ? post.tags.join(", ") : (connectedTopic?.aliases[0] ?? ""));
  const [question, setQuestion] = useState(post?.poll?.question ?? ""),
    [options, setOptions] = useState(
      post?.poll?.options.map((option) => option.label) ?? ["찬성", "반대"],
    );
  const [images, setImages] = useState<PublicImage[]>(post?.images ?? []),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const editableDraft = {
    category,
    kind,
    discussionType,
    spoiler,
    spoilerTitle,
    spoilerSummary,
    title,
    body,
    bodyDocument,
    anonymous,
    mode,
    url,
    location,
    date,
    fee,
    contact,
    venue,
    topic,
    tags,
    question,
    options,
    imageIds: images.map((image) => image.id),
    videoIds: videos.map((video) => video.id),
  };
  const initialDraft = useRef(editableDraft),
    editorInitialized = useRef(false);
  const dirty = JSON.stringify(editableDraft) !== JSON.stringify(initialDraft.current);
  useEffect(() => {
    if (!open || (!dirty && !pending && !uploadPending)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty, pending, uploadPending]);
  const topics =
    category in BOARD_TOPICS ? BOARD_TOPICS[category as keyof typeof BOARD_TOPICS] : [];
  const lockedPoll = !!post?.poll?.total;
  const lightning = post?.meetupType === "lightning";
  const directLightning = lightning && !post?.applicationUrl;
  const verified = !!post?.verifiedParticipation;
  const selectedTags = tags
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  function addTopicTag(value: string) {
    const linked = topicsForTags([value])[0];
    if (!linked) return;
    setTags((previous) => {
      const current = previous
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (current.length >= 5 || topicsForTags(current).some((topic) => topic.slug === linked.slug))
        return previous;
      if (!previous.trim()) return value;
      return previous + (previous.trimEnd().endsWith(",") ? " " : ", ") + value;
    });
  }
  async function uploadPreparedImage(file: File) {
    const controller = new AbortController();
    imagePreparation.current = controller;
    setImagePreparing(true);
    try {
      const prepared = await prepareImageForUpload(file, "post", { signal: controller.signal });
      setImagePreparing(false);
      return await upload(prepared);
    } finally {
      if (imagePreparation.current === controller) {
        imagePreparation.current = null;
        if (!controller.signal.aborted) setImagePreparing(false);
      }
    }
  }
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (pendingRef.current || uploadPendingRef.current) return;
    const parsed = (post ? createPostSchema : publishPostSchema).safeParse({
      categorySlug: category,
      kind: verified ? "후기" : kind,
      discussionType: kind === "이야기" && !verified ? discussionType : null,
      spoiler: kind !== "모집" && spoiler,
      spoilerTitle: spoiler ? spoilerTitle : null,
      spoilerSummary: spoiler ? spoilerSummary : null,
      title,
      bodyMarkdown: body,
      bodyDocument,
      isAnonymous: verified ? false : anonymous,
      imageAssetIds: images.map((image) => image.id),
      applicationUrl: kind === "모집" && mode === "external" ? url.trim() || null : null,
      location: kind === "모집" ? location.trim() || null : null,
      venue: kind === "모집" ? (post && !venueChanged ? undefined : venue) : null,
      eventDate: kind === "모집" ? date.trim() || null : null,
      eventFee: kind === "모집" ? fee.trim() || null : null,
      contactInfo: kind === "모집" ? contact.trim() || null : null,
      topic: topics.length ? topic || null : null,
      tags: tags
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean),
      poll: kind === "투표" ? { question, options } : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "필수 정보를 확인해주세요.");
      return;
    }
    try {
      const policy = evaluateContentPolicy(contentPolicyFields(parsed.data));
      if (!policy.allowed) {
        setError(policy.message);
        return;
      }
    } catch (cause) {
      setError(
        cause instanceof ContentPolicyInputError
          ? cause.message
          : "내용을 확인하지 못했어요. 입력한 내용은 유지됩니다. 잠시 후 다시 시도해주세요.",
      );
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const saved = await onPublish(parsed.data);
      if (!saved) setError("저장하지 못했어요. 입력한 내용은 유지됩니다.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "저장하지 못했어요. 입력한 내용은 유지됩니다.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  function template() {
    if (body.trim()) return;
    editorRef.current?.insertTemplate(
      kind === "모집"
        ? "## 어떤 행사인가요?\n분위기와 진행 방식을 소개해주세요.\n\n## 이런 분을 기다려요\n- 참가 대상과 모집 인원\n\n## 이렇게 진행돼요\n- 시간대별 진행 순서\n\n## 미리 알아주세요\n- 준비물, 진행 규칙, 환불·취소 안내"
        : category === "lab"
          ? "## 참고한 작품과 장면\n\n## 어떤 기법이 흥미로운가요?\n\n## 이벤트로 각색한다면?\n\n## 함께 토론할 질문"
          : category === "crew"
            ? "## 함께 만들 콘텐츠\n\n## 찾는 역할과 업무\n\n## 일정과 활동 조건\n\n## 보상과 지원 방법"
            : "## 나누고 싶은 이야기\n\n## 함께 생각해볼 질문",
    );
  }
  const recruit = kind === "모집";
  const paid = feePaid || (fee.trim() !== "" && fee.trim() !== "무료");
  function updateSchedule(patch: Partial<typeof schedule>) {
    const next = { ...schedule, ...patch };
    setSchedule(next);
    if (next.date) setDate(scheduleText(next.date, next.start, next.end));
  }
  const checklist = [
    { label: "제목", done: !!title.trim(), required: true },
    ...(mode === "external" && !directLightning
      ? [{ label: "신청 링크", done: /^https?:\/\/\S+\.\S+/.test(url.trim()), required: true }]
      : []),
    { label: "일정", done: !!date.trim(), required: mode === "direct" },
    { label: "장소", done: !!location.trim() || !!venue, required: mode === "direct" },
    { label: "소개", done: !!body.trim(), required: true },
  ];
  const titleField = (placeholder: string) => (
    <label className="field-label">
      {recruit ? "모집글 제목" : "제목"} <span className="required-label">필수</span>
      <input
        required
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={120}
        placeholder={placeholder}
      />
      <small className="field-count">{title.length}/120</small>
    </label>
  );
  const topicField = topics.length > 0 && (
    <label className="field-label">
      세부 주제 <span className="required-label">필수</span>
      <select value={topic} onChange={(event) => setTopic(event.target.value)} required>
        <option value="">주제를 선택해주세요</option>
        {topics.map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
    </label>
  );
  const tagsField = (
    <>
      <label className="field-label">
        태그 <span className="optional-label">선택 · 최대 5개</span>
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          maxLength={140}
          placeholder={
            category === "lab"
              ? "솔로지옥, 블라인드 소개팅, 미션 설계"
              : "런닝맨, 팀 미션, 초보 환영"
          }
        />
        <small>
          {recruit
            ? "쉼표로 구분해주세요. 태그가 있으면 취향 검색에서 더 잘 보여요."
            : "쉼표로 구분해주세요. 작품명·기법·준비물을 태그로 모을 수 있어요."}
        </small>
      </label>
      {recruit || !spoiler ? (
        <TopicTagPicker tags={selectedTags} onAddTag={addTopicTag} disabled={pending} maxTags={5} />
      ) : (
        <small className="field-count">스포일러가 있는 글은 주제 탐색에 연결되지 않아요.</small>
      )}
    </>
  );
  const editorBlock = (
    <>
      <div className="editor-toolbar rich-mode-switch">
        <div>
          <button
            type="button"
            className={cn(!preview && "active")}
            onClick={() => setPreview(false)}
          >
            작성
          </button>
          <button
            type="button"
            className={cn(preview && "active")}
            onClick={() => setPreview(true)}
          >
            미리보기
          </button>
        </div>
        <button type="button" disabled={!!body.trim()} onClick={template}>
          {recruit ? "소개 양식 넣기" : "양식 넣기"}
        </button>
      </div>
      {preview && (
        <div className="rich-editor-preview">
          {body.trim() ? (
            <PostBody document={bodyDocument} body={body} images={images} videos={videos} />
          ) : (
            <p className="participation-muted">내용을 작성하면 여기에 표시돼요.</p>
          )}
        </div>
      )}
      <div hidden={preview}>
        <RichPostEditor
          ref={editorRef}
          document={bodyDocument}
          body={body}
          images={images}
          videos={videos}
          disabled={pending || uploadPending}
          upload={uploadPreparedImage}
          onChange={(document, nextImages, nextVideos) => {
            const markdown = postDocumentToMarkdown(document);
            // The editor canonicalizes legacy content on creation; this is the clean baseline.
            if (!editorInitialized.current) {
              editorInitialized.current = true;
              initialDraft.current = {
                ...initialDraft.current,
                body: markdown,
                bodyDocument: document,
                imageIds: nextImages.map((image) => image.id),
                videoIds: nextVideos.map((video) => video.id),
              };
            }
            setBodyDocument(document);
            setBody(markdown);
            setImages(nextImages);
            setVideos(nextVideos);
          }}
          onBusyChange={(busy) => {
            uploadPendingRef.current = busy;
            setUploadPending(busy);
          }}
          onError={setError}
        />
      </div>
    </>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (pendingRef.current || uploadPendingRef.current) return;
        if (
          !value &&
          !mayCloseWriteDialog(dirty, false, () =>
            window.confirm(
              "저장하지 않은 내용이 있어요. 닫으면 입력한 내용과 첨부 선택이 사라져요. 내용을 버리고 닫을까요?",
            ),
          )
        )
          return;
        onOpenChange(value);
      }}
    >
      <DialogContent className="write-dialog organized-editor">
        <DialogTitle className="utility-title">
          {kind === "모집"
            ? (lightning ? MEETUP_TYPE_LABELS.lightning : MEETUP_TYPE_LABELS.event) +
              (post ? " 수정하기" : " 모집글 쓰기")
            : kind === "투표"
              ? post
                ? "투표 수정하기"
                : "투표 쓰기"
              : post
                ? "이야기 수정하기"
                : "이야기 쓰기"}
        </DialogTitle>
        <DialogDescription className="utility-description">
          {kind === "모집"
            ? "4단계만 채우면 모집글이 완성돼요. 꼭 필요한 건 제목·신청 링크·행사 소개예요."
            : "후기와 질문, 새로운 아이디어를 편하게 나눠요."}
        </DialogDescription>
        <form onSubmit={publish}>
          <fieldset disabled={pending} className="write-fields">
            {recruit ? (
              <div className={rf.fields}>
                <section className={rf.step} aria-labelledby="recruit-about-heading">
                  <h3 id="recruit-about-heading" className={rf.stepHead}>
                    <b>1</b>어떤 행사인가요?
                  </h3>
                  {titleField("예: 크라임씬 스타일 추리 파티 참가자 모집")}
                  <div className={rf.group}>
                    <span className={rf.groupLabel} id="recruit-category-label">
                      행사 분위기 <small>이 분류의 목록에 올라가요</small>
                    </span>
                    <div className={rf.chips} role="group" aria-labelledby="recruit-category-label">
                      {CATEGORIES.map((item) => (
                        <button
                          key={item.slug}
                          type="button"
                          className={rf.chip}
                          aria-pressed={category === item.slug}
                          disabled={verified}
                          onClick={() => {
                            setCategory(item.slug);
                            setTopic("");
                          }}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  {topicField}
                </section>

                <section className={rf.step} aria-labelledby="recruit-when-heading">
                  <h3 id="recruit-when-heading" className={rf.stepHead}>
                    <b>2</b>언제, 어디서 열리나요?
                  </h3>
                  <div className={rf.group}>
                    <span className={rf.groupLabel}>
                      날짜와 시간 <small>고르면 아래 일정에 자동으로 채워져요</small>
                    </span>
                    <div className={rf.dateTime}>
                      <label className={rf.mini}>
                        <small>날짜</small>
                        <input
                          type="date"
                          className={rf.input}
                          aria-label="행사 날짜"
                          value={schedule.date}
                          onChange={(event) => updateSchedule({ date: event.target.value })}
                        />
                      </label>
                      <label className={rf.mini}>
                        <small>시작</small>
                        <input
                          type="time"
                          step={600}
                          className={rf.input}
                          aria-label="시작 시간"
                          value={schedule.start}
                          onChange={(event) => updateSchedule({ start: event.target.value })}
                        />
                      </label>
                      <span aria-hidden="true">~</span>
                      <label className={rf.mini}>
                        <small>끝 (선택)</small>
                        <input
                          type="time"
                          step={600}
                          className={rf.input}
                          aria-label="끝나는 시간"
                          value={schedule.end}
                          onChange={(event) => updateSchedule({ end: event.target.value })}
                        />
                      </label>
                    </div>
                  </div>
                  <label className="field-label">
                    목록에 보일 일정{" "}
                    {mode === "direct" ? (
                      <span className="required-label">필수</span>
                    ) : (
                      <span className="optional-label">직접 고쳐 써도 돼요</span>
                    )}
                    <input
                      required={mode === "direct"}
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      maxLength={120}
                      placeholder="예: 10월 10일 (토) 14:00~17:00 · 매주 토요일"
                    />
                  </label>
                  <EventLocationField
                    value={venue}
                    address={location}
                    onAddressSelected={setLocation}
                    onChange={(next) => {
                      setVenueChanged(true);
                      setVenue(next);
                    }}
                    disabled={pending || uploadPending}
                    purpose="venue"
                    idPrefix="post-venue"
                  />
                </section>

                <section className={rf.step} aria-labelledby="recruit-apply-heading">
                  <h3 id="recruit-apply-heading" className={rf.stepHead}>
                    <b>3</b>어떻게 신청받을까요?
                  </h3>
                  {directLightning ? (
                    <div className={rf.info}>
                      <strong>번개는 슬리퍼에서 바로 신청받아요</strong>
                      참가 요청을 확인하고 승인하면 참가가 확정돼요. 사전 결제는 없어요.
                    </div>
                  ) : mode === "direct" ? (
                    <div className={rf.info}>
                      <strong>예전 방식(직접 모집)으로 올린 글이에요</strong>
                      내용은 그대로 수정할 수 있어요. 신청 방식 변경은 참가 내역에 따라 제한될 수
                      있어요.
                      {!lightning && (
                        <button
                          type="button"
                          className={rf.inlineAction}
                          onClick={() => setMode("external")}
                        >
                          <Link2 size={13} aria-hidden="true" /> 외부 신청 링크로 바꾸기
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <label className="field-label">
                        신청 페이지 링크 <span className="required-label">필수</span>
                        <input
                          required
                          type="url"
                          inputMode="url"
                          value={url}
                          onChange={(event) => setUrl(event.target.value)}
                          maxLength={2048}
                          placeholder="https://…"
                        />
                        <small>
                          구글폼·네이버폼·티켓 판매 페이지처럼 신청(과 결제)을 받는 주소를
                          넣어주세요.
                        </small>
                      </label>
                      <div className={rf.info}>
                        <strong>참가는 이렇게 확정돼요</strong>
                        <ol className={rf.flow}>
                          <li>링크에서 신청</li>
                          <li>내 행사 관리에서 승인</li>
                          <li>슬리퍼 공지방 초대</li>
                        </ol>
                      </div>
                    </>
                  )}
                  <div className={rf.group}>
                    <span className={rf.groupLabel} id="recruit-fee-label">
                      참가비{" "}
                      {mode === "direct" && !lightning ? (
                        <span className={rf.required}>필수</span>
                      ) : (
                        <small>선택</small>
                      )}
                    </span>
                    {lightning ? (
                      <p className={rf.info}>
                        {directLightning ? "현장 정산 · 사전 결제 없음" : fee || "현장 정산"}
                      </p>
                    ) : (
                      <>
                        <div className={rf.chips} role="group" aria-labelledby="recruit-fee-label">
                          <button
                            type="button"
                            className={rf.chip}
                            aria-pressed={fee.trim() === "무료"}
                            onClick={() => {
                              setFeePaid(false);
                              setFee("무료");
                            }}
                          >
                            무료
                          </button>
                          <button
                            type="button"
                            className={rf.chip}
                            aria-pressed={paid}
                            onClick={() => {
                              setFeePaid(true);
                              if (fee.trim() === "무료") setFee("");
                            }}
                          >
                            유료
                          </button>
                        </div>
                        {paid && (
                          <input
                            className={rf.input}
                            aria-label="참가비 안내"
                            required={mode === "direct"}
                            value={fee}
                            onChange={(event) => setFee(event.target.value)}
                            maxLength={120}
                            placeholder="예: 1인 30,000원 · 음료 포함"
                          />
                        )}
                      </>
                    )}
                  </div>
                  <div className={rf.group}>
                    <span className={rf.groupLabel} id="recruit-contact-label">
                      문의 방법 <small>선택 · 모두에게 보여요</small>
                    </span>
                    <div className={rf.chips} role="group" aria-labelledby="recruit-contact-label">
                      {CONTACT_PRESETS.map((text) => (
                        <button
                          key={text}
                          type="button"
                          className={rf.chip}
                          aria-pressed={contact.trim() === text}
                          onClick={() => setContact(contact.trim() === text ? "" : text)}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                    <input
                      className={rf.input}
                      aria-label="문의 방법 직접 입력"
                      value={contact}
                      onChange={(event) => setContact(event.target.value)}
                      maxLength={300}
                      placeholder="직접 입력해도 돼요"
                    />
                    <small className="form-note">
                      확정 참가자에게만 알려줄 연락처는 등록 후 내 행사 관리에서 따로 적을 수
                      있어요.
                    </small>
                  </div>
                </section>

                <section className={rf.step} aria-labelledby="recruit-body-heading">
                  <h3 id="recruit-body-heading" className={rf.stepHead}>
                    <b>4</b>행사를 소개해주세요
                    <small>필수</small>
                  </h3>
                  <p className={rf.stepHint}>
                    어떤 행사인지, 누구를 기다리는지, 미리 알아둘 점을 적어주세요. 사진도 넣을 수
                    있어요.
                  </p>
                  {editorBlock}
                </section>

                <details className={rf.more}>
                  <summary>
                    더 많은 사람에게 보여주기 <small>선택 · 태그</small>
                  </summary>
                  <div className={rf.moreBody}>{tagsField}</div>
                </details>
              </div>
            ) : (
              <>
                <section className="editor-section">
                  <h3>
                    <span>01</span>어디에 남길까요?
                  </h3>
                  <div className="form-grid">
                    <label className="field-label">
                      게시판 <span className="required-label">필수</span>
                      <select
                        disabled={verified}
                        value={category}
                        onChange={(event) => {
                          setCategory(event.target.value as CategorySlug);
                          setTopic("");
                        }}
                      >
                        {CATEGORIES.map((item) => (
                          <option key={item.slug} value={item.slug}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {kind === "이야기" && !verified && (
                      <label className="field-label">
                        이야기 말머리
                        <select
                          value={discussionType}
                          onChange={(event) =>
                            setDiscussionType(event.target.value as DiscussionType)
                          }
                        >
                          {DISCUSSION_TYPES.map((value) => (
                            <option key={value} value={value}>
                              {DISCUSSION_LABELS[value]}
                            </option>
                          ))}
                        </select>
                        <small>
                          {discussionType === "question"
                            ? "다른 회원의 답변을 채택해 해결된 질문으로 남길 수 있어요."
                            : "이야기 성격에 맞는 말머리를 골라주세요."}
                        </small>
                      </label>
                    )}
                    {topicField}
                  </div>
                  {titleField("첫 문장부터 궁금해지는 제목")}
                  {tagsField}
                </section>
                <section className="editor-section spoiler-editor">
                  <label className="spoiler-toggle">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={spoiler}
                      onChange={(event) => setSpoiler(event.target.checked)}
                    />
                    스포일러가 있는 글이에요
                  </label>
                  <p>
                    결말·정답·미션 해설은 본문에만 담아주세요. 목록과 알림에는 안전한 미리보기가
                    표시돼요.
                  </p>
                  {spoiler && (
                    <>
                      <label className="field-label">
                        미리보기 제목 <span className="required-label">필수</span>
                        <input
                          required
                          value={spoilerTitle}
                          onChange={(event) => setSpoilerTitle(event.target.value)}
                          maxLength={120}
                          placeholder="예: 크라임씬 마지막 회를 보고 든 생각"
                        />
                      </label>
                      <label className="field-label">
                        스포일러 없는 소개{" "}
                        <input
                          value={spoilerSummary}
                          onChange={(event) => setSpoilerSummary(event.target.value)}
                          maxLength={200}
                          placeholder="어떤 회차·주제를 다루는지 알려주세요"
                        />
                      </label>
                      <small>
                        위 미리보기에는 정답이나 반전을 적지 마세요. 본문 제목·사진·영상·댓글은
                        독자가 펼친 뒤 보여요.
                      </small>
                    </>
                  )}
                </section>
                {kind === "투표" && (
                  <section className="editor-section tinted">
                    <h3>
                      <span>02</span>어떤 의견이 궁금한가요?
                    </h3>
                    {lockedPoll && (
                      <p className="form-note">
                        이미 참여한 사람이 있어 주제와 선택지는 유지돼요. 제목과 본문은 수정할 수
                        있어요.
                      </p>
                    )}
                    <fieldset disabled={lockedPoll} className="write-fields">
                      <label className="field-label">
                        투표 주제 <span className="required-label">필수</span>
                        <input
                          value={question}
                          onChange={(event) => setQuestion(event.target.value)}
                          maxLength={200}
                          minLength={2}
                          required
                          placeholder="우리 모임에서 가장 해보고 싶은 미션은?"
                        />
                      </label>
                      <div className="poll-presets">
                        <button type="button" onClick={() => setOptions(["찬성", "반대"])}>
                          찬성 / 반대
                        </button>
                        <button
                          type="button"
                          onClick={() => setOptions(["선택지 1", "선택지 2", "선택지 3"])}
                        >
                          여러 의견 중 선택
                        </button>
                      </div>
                      <div className="poll-option-inputs">
                        {options.map((option, index) => (
                          <div key={index}>
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <input
                              aria-label={`투표 선택지 ${index + 1}`}
                              required
                              value={option}
                              onChange={(event) =>
                                setOptions((current) =>
                                  current.map((item, i) =>
                                    i === index ? event.target.value : item,
                                  ),
                                )
                              }
                              maxLength={80}
                              placeholder="선택지 내용"
                            />
                            <button
                              type="button"
                              aria-label={`선택지 ${index + 1} 삭제`}
                              disabled={options.length <= 2}
                              onClick={() =>
                                setOptions((current) => current.filter((_, i) => i !== index))
                              }
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="add-option"
                        disabled={options.length >= 8}
                        onClick={() => setOptions((current) => [...current, ""])}
                      >
                        <Plus size={15} />
                        선택지 추가 ({options.length}/8)
                      </button>
                    </fieldset>
                    <p className="form-note">
                      한 사람당 한 가지를 선택하며, 선택은 바꿀 수 있어요. 이유는 댓글에서
                      나눠주세요.
                    </p>
                  </section>
                )}
                <section className="editor-section">
                  <h3>
                    <span>{kind === "이야기" ? "02" : "03"}</span>이야기에 사진과 영상을 담아주세요
                  </h3>
                  {editorBlock}
                </section>
              </>
            )}
            <div className="publish-check">
              <Check size={16} />
              <p>
                욕설·차별·음란 콘텐츠와 개인정보 노출을 금지해요.{" "}
                <Link href="/policies/community" target="_blank" rel="noopener noreferrer">
                  이용규칙
                </Link>
              </p>
            </div>
            <div className="write-form-footer">
              {recruit ? (
                <ul className={rf.checklist} aria-label="모집글 준비 상태">
                  {checklist.map((item) => (
                    <li key={item.label} data-done={item.done} data-optional={!item.required}>
                      {item.done ? "✓ " : item.required ? "○ " : ""}
                      {item.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <label>
                  <input
                    type="checkbox"
                    disabled={verified}
                    checked={verified ? false : anonymous}
                    onChange={(event) => setAnonymous(event.target.checked)}
                  />
                  {verified ? "참가 인증 후기는 닉네임으로 공개돼요" : "익명으로 작성"}
                </label>
              )}
              <Button type="submit">
                <Pencil size={16} />
                {imagePreparing
                  ? "사진 준비 중…"
                  : uploadPending
                    ? "첨부파일 업로드 중…"
                    : pending
                      ? "저장 중…"
                      : post
                        ? "수정 저장"
                        : recruit
                          ? "모집글 올리기"
                          : "글 등록"}
              </Button>
            </div>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
