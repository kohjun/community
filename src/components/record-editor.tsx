"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, FileText, Link2, Plus, Save, Search, X } from "lucide-react";
import type { RecordDetail, RecordLink } from "@/domain/records";
import { recordSaveSchema } from "@/domain/records";
import type { PublicImage, PublicVideo } from "@/domain/contracts";
import type { SearchPage, SearchResult } from "@/domain/search";
import { postDocumentToMarkdown, type PostDocument } from "@/domain/post-document";
import { appRequest, RequestError } from "@/lib/api-client";
import { prepareImageForUpload } from "@/lib/image-precompression";
import { ParticipationShell } from "./participation-shell";
import { RichPostEditor } from "./rich-post-editor";
import { PostBody } from "./post-body";

type RelatedItem = Pick<RecordLink, "id" | "title" | "kind" | "href">;
function RelatedContentPicker({
  items,
  onChange,
  disabled,
}: {
  items: RelatedItem[];
  onChange: (items: RelatedItem[]) => void;
  disabled: boolean;
}) {
  const [q, setQ] = useState(""),
    [results, setResults] = useState<SearchResult[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function search() {
    controller.current?.abort();
    const signal = new AbortController();
    controller.current = signal;
    setBusy(true);
    setError("");
    try {
      const next = await appRequest<SearchPage>(
        "/api/search?q=" + encodeURIComponent(q.trim()),
        "GET",
        undefined,
        signal.signal,
      );
      if (!signal.signal.aborted)
        setResults(
          next.items.filter((item) =>
            ["story", "recruitment", "rulebook", "template"].includes(item.type),
          ),
        );
    } catch (cause) {
      if (!signal.signal.aborted)
        setError(cause instanceof Error ? cause.message : "관련 콘텐츠를 찾지 못했어요.");
    } finally {
      if (!signal.signal.aborted) setBusy(false);
    }
  }
  function add(item: SearchResult) {
    const kind = item.type === "rulebook" || item.type === "template" ? item.type : "post";
    if (items.some((row) => row.id === item.id && row.kind === kind)) return;
    const count = items.filter((row) =>
      kind === "post" ? row.kind === "post" : row.kind !== "post",
    ).length;
    if (count >= 10) {
      setError("이야기와 자료는 각각 10개까지 연결할 수 있어요.");
      return;
    }
    onChange([...items, { id: item.id, title: item.title, href: item.href, kind }]);
  }
  return (
    <section className="record-editor-section">
      <h3>
        <Link2 size={15} />
        관련 이야기·룰북·템플릿
      </h3>
      <p className="record-note">연결해도 원본의 유료·비공개 열람 권한은 변경되지 않아요.</p>
      <div className="record-filters">
        <label>
          제목으로 찾기
          <input
            type="search"
            value={q}
            maxLength={100}
            disabled={disabled}
            onChange={(event) => setQ(event.target.value)}
            placeholder="연결할 이야기나 자료의 이름"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (q.trim()) void search();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="participation-secondary"
          disabled={disabled || busy || !q.trim()}
          onClick={() => void search()}
        >
          <Search size={14} />
          찾기
        </button>
      </div>
      {error && (
        <p className="participation-error" role="alert">
          {error}
        </p>
      )}
      <div className="record-linked-list">
        {results.map((item) => (
          <div className="record-credit-row" key={item.type + item.id}>
            <div>
              <strong>{item.title}</strong>
              <small>
                {item.type === "rulebook" ? "룰북" : item.type === "template" ? "템플릿" : "이야기"}
              </small>
            </div>
            <button
              type="button"
              className="participation-secondary"
              disabled={disabled || items.some((row) => row.id === item.id)}
              onClick={() => add(item)}
            >
              <Plus size={13} />
              연결
            </button>
          </div>
        ))}
      </div>
      {items.length > 0 && (
        <div className="record-tags" style={{ marginTop: 12 }}>
          {items.map((item) => (
            <span className="record-status" key={item.kind + item.id}>
              {item.title}
              <button
                type="button"
                disabled={disabled}
                aria-label={item.title + " 연결 해제"}
                onClick={() =>
                  onChange(items.filter((row) => !(row.id === item.id && row.kind === item.kind)))
                }
                style={{
                  border: 0,
                  padding: 2,
                  background: "transparent",
                  color: "inherit",
                  display: "inline-flex",
                }}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
export function RecordEditor({
  initial,
  onSaved,
}: {
  initial: RecordDetail;
  onSaved?: (value: RecordDetail) => void;
}) {
  const router = useRouter(),
    [data, setData] = useState(initial),
    [purpose, setPurpose] = useState(initial.purpose),
    [execution, setExecution] = useState(initial.execution),
    [highlights, setHighlights] = useState(initial.highlights),
    [improvements, setImprovements] = useState(initial.improvements),
    [venueTips, setVenueTips] = useState(initial.venueTips ?? ""),
    [document, setDocument] = useState<PostDocument | null>(initial.bodyDocument),
    [images, setImages] = useState<PublicImage[]>(initial.images),
    [videos, setVideos] = useState<PublicVideo[]>(initial.videos),
    [preview, setPreview] = useState(false),
    [uploading, setUploading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const initialLinks = initial.links.filter(
    (link) => initial.relatedPostIds.includes(link.id) || initial.libraryIds.includes(link.id),
  );
  const [related, setRelated] = useState<RelatedItem[]>(initialLinks);
  const gate = useRef(false),
    uploadGate = useRef(false),
    preparation = useRef<AbortController | null>(null);
  useEffect(() => () => preparation.current?.abort(), []);
  async function upload(file: File) {
    const controller = new AbortController();
    preparation.current = controller;
    try {
      const prepared = await prepareImageForUpload(file, "post", { signal: controller.signal });
      const form = new FormData();
      form.append("file", prepared);
      return await appRequest<PublicImage>(
        "/api/community/uploads",
        "POST",
        form,
        controller.signal,
      );
    } finally {
      if (preparation.current === controller) preparation.current = null;
    }
  }
  async function save(publish = false) {
    if (gate.current || uploadGate.current) return;
    const parsed = recordSaveSchema.safeParse({
      expectedUpdatedAt: data.updatedAt,
      purpose,
      execution,
      highlights,
      improvements,
      venueTips: data.canEditVenueTips ? venueTips : undefined,
      bodyDocument: document,
      relatedPostIds: related.filter((item) => item.kind === "post").map((item) => item.id),
      libraryIds: related
        .filter((item) => item.kind === "rulebook" || item.kind === "template")
        .map((item) => item.id),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "회고 내용을 확인해주세요.");
      return;
    }
    if (
      publish &&
      (purpose.trim().length < 10 ||
        execution.trim().length < 10 ||
        !document ||
        postDocumentToMarkdown(document).trim().length === 0)
    ) {
      setError(
        "회원에게 공개하려면 기획 의도와 실제 진행을 각각 10자 이상 적고, 사진·영상 또는 글이 담긴 운영 회고를 작성해주세요.",
      );
      return;
    }
    gate.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await appRequest<RecordDetail>(
        "/api/records/" + data.postId,
        "PATCH",
        parsed.data,
      );
      setData(saved);
      onSaved?.(saved);
      if (publish) {
        const published = await appRequest<RecordDetail>(
          "/api/records/" + data.postId + "/publish",
          "POST",
          { expectedUpdatedAt: saved.updatedAt, published: true },
        );
        setData(published);
        onSaved?.(published);
        router.push("/records/" + data.postId);
        router.refresh();
      } else setNotice("회고 초안을 저장했어요.");
    } catch (cause) {
      setError(
        cause instanceof RequestError && cause.code === "CONFLICT"
          ? "다른 화면에서 기록이 바뀌었어요. 작성한 내용은 유지됩니다. 새로고침해 최신 기록을 확인한 뒤 다시 작성해주세요."
          : cause instanceof Error
            ? cause.message
            : "기록을 저장하지 못했어요.",
      );
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save(false);
  }
  return (
    <ParticipationShell>
      <div className="record-page">
        <header className="record-heading">
          <div>
            <span className="record-kicker">EVENT RETROSPECTIVE</span>
            <h1>{data.title}</h1>
            <p>이번 경험을 다음 기획자가 활용할 수 있는 기록으로 남겨주세요.</p>
          </div>
          <Link className="participation-secondary" href={"/records/" + data.postId}>
            기록으로 돌아가기
          </Link>
        </header>
        <form onSubmit={submit}>
          <section className="record-panel">
            <h2>
              <FileText size={18} />
              운영 회고
            </h2>
            <div className="record-form-grid">
              {[
                {
                  title: "기획 의도",
                  value: purpose,
                  set: setPurpose,
                  placeholder: "누구에게 어떤 경험을 만들어주고 싶었나요?",
                },
                {
                  title: "실제 진행",
                  value: execution,
                  set: setExecution,
                  placeholder: "계획과 실제 운영은 어떻게 달랐나요?",
                },
                {
                  title: "잘된 점",
                  value: highlights,
                  set: setHighlights,
                  placeholder: "참가자의 반응이 좋았던 장면과 운영 방법을 남겨주세요.",
                },
                {
                  title: "다음에 개선할 점",
                  value: improvements,
                  set: setImprovements,
                  placeholder: "다음 행사에서 보완할 내용을 기록해주세요.",
                },
              ].map((field) => (
                <label className="record-field" key={field.title}>
                  {field.title}
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={field.value}
                    onChange={(event) => field.set(event.target.value)}
                    disabled={busy}
                    placeholder={field.placeholder}
                  />
                  <small>{field.value.length.toLocaleString()} / 2,000자</small>
                </label>
              ))}
            </div>
            <label className="record-field place-tip-field">
              장소 운영 팁
              <textarea
                rows={4}
                maxLength={2000}
                value={venueTips}
                onChange={(event) => setVenueTips(event.target.value)}
                disabled={busy || !data.canEditVenueTips}
                placeholder="동선, 공간 배치, 장비 사용 등 다음 주최자에게 도움이 될 경험을 남겨주세요."
              />
              {!data.canEditVenueTips && (
                <p className="record-note">
                  현재 공유 장소를 볼 수 없어 장소 운영 팁은 수정할 수 없어요. 저장된 내용은
                  유지됩니다.
                </p>
              )}
              <small>
                {venueTips.length.toLocaleString()} / 2,000자 · 공유 장소를 사용한 회원 공개 회고는
                장소의 운영 팁에 연결돼요.
              </small>
            </label>
            <div className="record-heading">
              <div>
                <h3>현장 이야기 · 사진 · 영상</h3>
                <p className="record-note">
                  내용 사이에 사진과 영상을 삽입할 수 있어요. 식별 가능한 참가자의 동의를 받은
                  자료를 올려주세요.
                </p>
              </div>
              <button
                type="button"
                className="participation-secondary"
                disabled={busy || uploading}
                onClick={() => setPreview((value) => !value)}
              >
                <Eye size={14} />
                {preview ? "편집하기" : "미리보기"}
              </button>
            </div>
            {preview ? (
              <PostBody
                document={document}
                body={document ? postDocumentToMarkdown(document) : ""}
                images={images}
                videos={videos}
              />
            ) : (
              <RichPostEditor
                document={document}
                body={data.bodyMarkdown}
                images={images}
                videos={videos}
                disabled={busy}
                upload={upload}
                onChange={(next, nextImages, nextVideos) => {
                  setDocument(next);
                  setImages(nextImages);
                  setVideos(nextVideos);
                }}
                onBusyChange={(value) => {
                  uploadGate.current = value;
                  setUploading(value);
                }}
                onError={setError}
              />
            )}
          </section>
          <section className="record-panel">
            <RelatedContentPicker
              items={related}
              onChange={setRelated}
              disabled={busy || uploading}
            />
          </section>
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
          <div className="record-editor-sticky">
            <p>
              {data.status === "published"
                ? "공개 중인 기록을 저장하면 회원에게 수정 내용이 반영됩니다."
                : "초안은 주최자와 담당자에게만 보여요."}
              {uploading ? " 첨부 파일 처리 중…" : ""}
            </p>
            <div className="record-actions">
              <button className="participation-secondary" disabled={busy || uploading}>
                <Save size={14} />
                {busy ? "저장 중…" : "초안 저장"}
              </button>
              <button
                type="button"
                className="participation-primary"
                disabled={busy || uploading}
                onClick={() => void save(true)}
              >
                {data.status === "published" ? "공개 기록 저장" : "회원에게 공개"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </ParticipationShell>
  );
}
