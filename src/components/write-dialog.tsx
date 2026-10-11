"use client";
import { DISCUSSION_TYPES, DISCUSSION_LABELS, type DiscussionType } from "@/domain/discussions";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Pencil, X, Plus, Check, CalendarDays, Vote, MapPin, Link2, FileText } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { PostBody } from "./post-body";
import { RichPostEditor, type RichPostEditorHandle } from "./rich-post-editor";
import { EventLocationField } from "./event-location-field";
import type { VenuePoint } from "@/domain/discovery";
import { meetupVenueLabel } from "@/domain/venue-meetup";
import { postDocumentToMarkdown, type PostDocument } from "@/domain/post-document";
import { CATEGORIES, type CategorySlug } from "@/domain/categories";
import { BOARD_TOPICS } from "@/domain/boards";
import { createPostSchema, type CreatePostInput } from "@/domain/validation";
import type { CommunityPost } from "@/domain/community";
import type { PublicImage, PublicVideo } from "@/domain/contracts";
import { cn } from "@/lib/utils";
import { prepareImageForUpload } from "@/lib/image-precompression";
export function WriteDialog({
  open,
  onOpenChange,
  initialCategory,
  post,
  onPublish,
  upload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCategory: CategorySlug;
  post: CommunityPost | null;
  onPublish: (input: CreatePostInput) => Promise<boolean>;
  upload: (file: File) => Promise<PublicImage>;
}) {
  const [category, setCategory] = useState<CategorySlug>(post?.category ?? initialCategory);
  const [kind, setKind] = useState<"이야기" | "모집" | "투표">(
    post?.kind === "후기" ? "이야기" : (post?.kind ?? "이야기"),
  );
  const [discussionType, setDiscussionType] = useState<DiscussionType>(
    post?.discussionType ?? "free",
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
  const [mode, setMode] = useState<"external" | "direct">(
    post?.applicationUrl ? "external" : "direct",
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
  const [topic, setTopic] = useState(post?.topic ?? ""),
    [tags, setTags] = useState(post?.tags.join(", ") ?? "");
  const [question, setQuestion] = useState(post?.poll?.question ?? ""),
    [options, setOptions] = useState(
      post?.poll?.options.map((option) => option.label) ?? ["찬성", "반대"],
    );
  const [images, setImages] = useState<PublicImage[]>(post?.images ?? []),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const topics =
    category in BOARD_TOPICS ? BOARD_TOPICS[category as keyof typeof BOARD_TOPICS] : [];
  const lockedPoll = !!post?.poll?.total;
  const lightning = post?.meetupType === "lightning";
  const verified = !!post?.verifiedParticipation;
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
    const parsed = createPostSchema.safeParse({
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
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      if (!(await onPublish(parsed.data))) setError("저장하지 못했어요. 입력한 내용은 유지됩니다.");
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
        ? "## 어떤 모임인가요?\n함께할 콘텐츠와 진행 방식을 소개해주세요.\n\n## 이런 분을 기다려요\n- 참가 대상과 인원\n\n## 미리 알아주세요\n- 준비물, 진행 규칙, 환불·취소 안내"
        : category === "lab"
          ? "## 참고한 작품과 장면\n\n## 어떤 기법이 흥미로운가요?\n\n## 이벤트로 각색한다면?\n\n## 함께 토론할 질문"
          : category === "crew"
            ? "## 함께 만들 콘텐츠\n\n## 찾는 역할과 업무\n\n## 일정과 활동 조건\n\n## 보상과 지원 방법"
            : "## 나누고 싶은 이야기\n\n## 함께 생각해볼 질문",
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pendingRef.current && !uploadPendingRef.current) onOpenChange(value);
      }}
    >
      <DialogContent className="write-dialog organized-editor">
        <DialogTitle className="utility-title">
          {post ? (lightning ? "번개 수정하기" : "이야기 수정하기") : "우리의 다음 에피소드"}
        </DialogTitle>
        <DialogDescription className="utility-description">
          이야기를 나누고, 함께할 사람을 만나고, 새로운 아이디어에 투표해요.
        </DialogDescription>
        <form onSubmit={publish}>
          <fieldset disabled={pending} className="write-fields">
            <div className="write-type-cards" aria-label="글 유형 선택">
              {(
                [
                  { value: "이야기", icon: FileText, description: "아이디어와 일상" },
                  { value: "모집", icon: CalendarDays, description: "함께할 사람 찾기" },
                  { value: "투표", icon: Vote, description: "의견을 모아보기" },
                ] as const
              ).map((item) => (
                <button
                  type="button"
                  key={item.value}
                  aria-pressed={kind === item.value}
                  disabled={
                    verified ||
                    (lightning && item.value !== "모집") ||
                    (lockedPoll && item.value !== "투표")
                  }
                  className={cn(kind === item.value && "selected")}
                  onClick={() => setKind(item.value)}
                >
                  <item.icon size={20} />
                  <strong>{item.value}</strong>
                  <small>{item.description}</small>
                </button>
              ))}
            </div>
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
                      onChange={(event) => setDiscussionType(event.target.value as DiscussionType)}
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
                {topics.length > 0 && (
                  <label className="field-label">
                    세부 주제 <span className="required-label">필수</span>
                    <select
                      value={topic}
                      onChange={(event) => setTopic(event.target.value)}
                      required
                    >
                      <option value="">주제를 선택해주세요</option>
                      {topics.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <label className="field-label">
                제목 <span className="required-label">필수</span>
                <input
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  placeholder="첫 문장부터 궁금해지는 제목"
                />
                <small className="field-count">{title.length}/120</small>
              </label>
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
                <small>쉼표로 구분해주세요. 작품명·기법·준비물을 태그로 모을 수 있어요.</small>
              </label>
            </section>
            {kind !== "모집" && (
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
                      위 미리보기에는 정답이나 반전을 적지 마세요. 본문 제목·사진·영상·댓글은 독자가
                      펼친 뒤 보여요.
                    </small>
                  </>
                )}
              </section>
            )}
            {kind === "모집" && (
              <section className="editor-section tinted">
                <h3>
                  <span>02</span>모집 정보를 알려주세요
                </h3>
                <p className="participation-muted">
                  {lightning
                    ? "번개는 2–12명, 개설 후 7일 이내 일정이에요. 참가비·정확한 일정·정원은 내 행사 관리에서 변경해주세요."
                    : "등록 후 내 행사 관리에서 행사장 위치·정확한 일정·참가비를 설정하면 거리와 취향 검색에 표시돼요. 간단한 모임은 번개에서 빠르게 열 수 있어요."}
                </p>
                <div className="segmented-control">
                  <button
                    type="button"
                    aria-pressed={mode === "direct"}
                    className={cn(mode === "direct" && "active")}
                    onClick={() => setMode("direct")}
                  >
                    <MapPin size={16} />
                    직접 정보 등록
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "external"}
                    className={cn(mode === "external" && "active")}
                    onClick={() => setMode("external")}
                  >
                    <Link2 size={16} />
                    외부 플랫폼에서 신청
                  </button>
                </div>
                {mode === "external" && (
                  <label className="field-label">
                    외부 신청 페이지 주소 <span className="required-label">필수</span>
                    <input
                      required
                      type="url"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      maxLength={2048}
                      placeholder="https://…"
                    />
                    <small>
                      신청·결제는 외부 플랫폼에서 진행해요. 신청 번호·결제 내역 확인과 참가 승인 후
                      슬리퍼 공지방에 초대돼요.
                    </small>
                  </label>
                )}
                <div className="form-grid">
                  <label className="field-label">
                    장소 {mode === "direct" && <span className="required-label">필수</span>}
                    <input
                      required={mode === "direct"}
                      value={location}
                      onChange={(event) => {
                        setLocation(event.target.value);
                        setVenueChanged(true);
                        setVenue((before) =>
                          before
                            ? { latitude: before.latitude, longitude: before.longitude }
                            : null,
                        );
                      }}
                      maxLength={120}
                      placeholder="서울 성수 · 상세 장소"
                    />
                  </label>
                  <label className="field-label">
                    일정과 시간 {mode === "direct" && <span className="required-label">필수</span>}
                    <input
                      required={mode === "direct"}
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                      maxLength={120}
                      placeholder="10월 10일 토요일 14:00~17:00"
                    />
                  </label>
                  <label className="field-label">
                    참가 비용 {mode === "direct" && <span className="required-label">필수</span>}
                    <input
                      required={mode === "direct"}
                      value={fee}
                      readOnly={lightning}
                      onChange={(event) => setFee(event.target.value)}
                      maxLength={120}
                      placeholder="무료 / 1인 30,000원 · 포함 내역"
                    />
                  </label>
                  <label className="field-label">
                    참여·문의 안내 <span className="optional-label">선택</span>
                    <input
                      value={contact}
                      onChange={(event) => setContact(event.target.value)}
                      maxLength={300}
                      placeholder="댓글에 참여 의사를 남겨주세요"
                    />
                  </label>
                </div>
                <EventLocationField
                  value={venue}
                  onChange={(next) => {
                    setVenueChanged(true);
                    setVenue(next);
                  }}
                  onPlaceSelected={(place) => setLocation(meetupVenueLabel(place))}
                  disabled={pending || uploadPending}
                  purpose="venue"
                  idPrefix="post-venue"
                />
                <p className="form-note">
                  {lightning
                    ? "직접 참가는 무료예요. 외부 신청으로 변경한 뒤 내 행사 관리에서 실제 외부 참가비를 설정할 수 있어요. 참가 내역이 있으면 신청 방식을 바꿀 수 없어요."
                    : mode === "external"
                      ? "등록 후 내 행사 관리에서 금액·정원·승인 방식을 설정하세요. 외부 플랫폼에서 신청과 결제를 완료한 참가자를 확인하고 공지방에 초대할 수 있어요."
                      : "등록 후 내 행사 관리에서 참가 금액과 정원을 설정하면 사이트 내 신청을 받을 수 있어요."}{" "}
                  모임 내용과 규칙은 아래 본문에 적어주세요.
                </p>
              </section>
            )}
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
                              current.map((item, i) => (i === index ? event.target.value : item)),
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
                  한 사람당 한 가지를 선택하며, 선택은 바꿀 수 있어요. 이유는 댓글에서 나눠주세요.
                </p>
              </section>
            )}
            <section className="editor-section">
              <h3>
                <span>{kind === "이야기" ? "02" : "03"}</span>이야기에 사진과 영상을 담아주세요
              </h3>
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
                  양식 넣기
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
                    setBodyDocument(document);
                    setBody(postDocumentToMarkdown(document));
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
            </section>
            <div className="publish-check">
              <Check size={16} />
              <p>개인정보를 공개하지 않고 서로의 취향을 존중해주세요.</p>
            </div>
            <div className="write-form-footer">
              <label>
                <input
                  type="checkbox"
                  disabled={verified}
                  checked={verified ? false : anonymous}
                  onChange={(event) => setAnonymous(event.target.checked)}
                />
                {verified ? "참가 인증 후기는 닉네임으로 공개돼요" : "익명으로 작성"}
              </label>
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
