"use client";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import type { SelectionBookmark } from "@tiptap/pm/state";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Quote,
  Link2,
  ImagePlus,
  Video,
  Undo2,
  Redo2,
  X,
  GripVertical,
  Play,
} from "lucide-react";
import type { PublicImage, PublicVideo } from "@/domain/contracts";
import {
  parseVideoUrl,
  postDocumentImageIds,
  postDocumentVideoIds,
  safeExternalLink,
  type PostDocument,
} from "@/domain/post-document";
import { Markdown as LegacyMarkdown } from "./markdown";
import { cn } from "@/lib/utils";
import { canonicalDocument, appendImages, legacyDocument } from "@/lib/rich-post-editor-document";

import { IMAGE_UPLOAD_CONTENT_TYPES, IMAGE_COMPRESSION_POLICY } from "@/domain/image-compression";
import { acceptsVideoUpload, VIDEO_MAX_ATTACHMENTS } from "@/domain/video-compression";
import { uploadVideoFile, type VideoUploadStage } from "@/lib/video-upload";

const EMPTY: PostDocument = { version: 1, type: "doc", content: [{ type: "paragraph" }] };
const IMAGE_TYPES = new Set<string>(IMAGE_UPLOAD_CONTENT_TYPES);

function ImageView({
  node,
  extension,
  selected,
  deleteNode,
  updateAttributes,
  editor,
}: NodeViewProps) {
  const image = extension.options.asset(node.attrs.assetId) as PublicImage | undefined;
  return (
    <NodeViewWrapper
      as="figure"
      contentEditable={false}
      className={cn("rich-image-node", selected && "is-selected")}
    >
      <div className="rich-node-label">
        <span data-drag-handle>
          <GripVertical size={14} />
          사진
        </span>
        <button
          type="button"
          aria-label="사진 삭제"
          disabled={!editor.isEditable}
          onClick={deleteNode}
        >
          <X size={16} />
        </button>
      </div>
      {image ? (
        <img src={image.src} alt={node.attrs.alt || "본문 사진"} draggable={false} />
      ) : (
        <p>사진을 불러올 수 없어요.</p>
      )}
      <input
        aria-label="사진 설명"
        placeholder="사진 설명 (선택)"
        value={node.attrs.alt}
        maxLength={300}
        disabled={!editor.isEditable}
        onChange={(event) => updateAttributes({ alt: event.target.value })}
      />
    </NodeViewWrapper>
  );
}
function VideoView({ node, selected, deleteNode, editor }: NodeViewProps) {
  const video = parseVideoUrl(node.attrs.url),
    safe = safeExternalLink(node.attrs.url);
  const provider =
    video?.provider === "youtube"
      ? "YouTube"
      : video?.provider === "vimeo"
        ? "Vimeo"
        : video?.provider === "file"
          ? "영상 파일"
          : "영상 링크";
  return (
    <NodeViewWrapper
      as="figure"
      contentEditable={false}
      className={cn("rich-video-node", selected && "is-selected")}
    >
      <div className="rich-node-label">
        <span data-drag-handle>
          <GripVertical size={14} />
          {provider}
        </span>
        <button
          type="button"
          aria-label="영상 삭제"
          disabled={!editor.isEditable}
          onClick={deleteNode}
        >
          <X size={16} />
        </button>
      </div>
      <div className="rich-video-placeholder">
        <span>
          <Play size={24} />
        </span>
        <strong>
          {video ? "글을 등록하면 여기서 재생할 수 있어요" : "영상 페이지 링크가 여기에 표시돼요"}
        </strong>
        <small>{safe ? new URL(safe).hostname : "영상 주소를 확인해주세요"}</small>
      </div>
    </NodeViewWrapper>
  );
}
function UploadedVideoView({ node, extension, selected, deleteNode, editor }: NodeViewProps) {
  const video = extension.options.asset(node.attrs.assetId) as PublicVideo | undefined;
  return (
    <NodeViewWrapper
      as="figure"
      contentEditable={false}
      className={cn("rich-video-node", selected && "is-selected")}
    >
      <div className="rich-node-label">
        <span data-drag-handle>
          <GripVertical size={14} />
          첨부 영상
        </span>
        <button
          type="button"
          aria-label="영상 삭제"
          disabled={!editor.isEditable}
          onClick={deleteNode}
        >
          <X size={16} />
        </button>
      </div>
      {video ? (
        <video
          src={"/api/videos/" + video.id}
          controls
          playsInline
          preload="metadata"
          width={video.width}
          height={video.height}
        />
      ) : (
        <p>영상을 불러올 수 없어요.</p>
      )}
      {video && (
        <small className="rich-uploaded-video-info">
          {Math.ceil(video.durationSeconds)}초 · {(video.byteSize / 1024 / 1024).toFixed(1)}MB
        </small>
      )}
    </NodeViewWrapper>
  );
}
function LegacyView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  return (
    <NodeViewWrapper
      contentEditable={false}
      className={cn("rich-legacy-node", selected && "is-selected")}
    >
      <div className="rich-node-label">
        <span>기존 내용</span>
        <button type="button" disabled={!editor.isEditable} onClick={() => setEditing(!editing)}>
          {editing ? "내용 확인" : "기존 내용 수정"}
        </button>
      </div>
      {editing ? (
        <textarea
          aria-label="기존 글 내용 수정"
          value={node.attrs.markdown}
          maxLength={30000}
          disabled={!editor.isEditable}
          onChange={(event) => updateAttributes({ markdown: event.target.value })}
        />
      ) : (
        <LegacyMarkdown>{node.attrs.markdown}</LegacyMarkdown>
      )}
      <small>
        기존 표와 코드 형식은 그대로 보존돼요. 사진과 영상은 이 내용 앞뒤에 추가할 수 있어요.
      </small>
    </NodeViewWrapper>
  );
}
const RichImage = Node.create<{ asset: (id: string) => PublicImage | undefined }>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { asset: () => undefined };
  },
  addAttributes() {
    return { assetId: { default: "" }, alt: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-sliper-image]",
        getAttrs: (element) => {
          const assetId = element.getAttribute("data-sliper-image") ?? "";
          return this.options.asset(assetId)
            ? { assetId, alt: element.getAttribute("data-alt") ?? "" }
            : false;
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes(HTMLAttributes, {
        "data-sliper-image": node.attrs.assetId,
        "data-alt": node.attrs.alt,
      }),
      "첨부 사진",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
const RichVideo = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-sliper-video]",
        getAttrs: (element) => {
          const safe = safeExternalLink(element.getAttribute("data-sliper-video"));
          return safe?.startsWith("https://") ? { url: parseVideoUrl(safe)?.url ?? safe } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    return ["figure", { "data-sliper-video": node.attrs.url }, "첨부 영상"];
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoView);
  },
});
const UploadedVideo = Node.create<{ asset: (id: string) => PublicVideo | undefined }>({
  name: "uploadedVideo",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { asset: () => undefined };
  },
  addAttributes() {
    return { assetId: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-sliper-uploaded-video]",
        getAttrs: (element) => {
          const assetId = element.getAttribute("data-sliper-uploaded-video") ?? "";
          return this.options.asset(assetId) ? { assetId } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    return ["figure", { "data-sliper-uploaded-video": node.attrs.assetId }, "첨부 영상"];
  },
  addNodeView() {
    return ReactNodeViewRenderer(UploadedVideoView);
  },
});
const LegacyContent = Node.create({
  name: "legacyMarkdown",
  group: "block",
  atom: true,
  addAttributes() {
    return { markdown: { default: "" } };
  },
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ["div", {}, "기존 내용"];
  },
  addNodeView() {
    return ReactNodeViewRenderer(LegacyView);
  },
});
export function createRichPostEditorExtensions(
  asset: (id: string) => PublicImage | undefined = () => undefined,
  videoAsset: (id: string) => PublicVideo | undefined = () => undefined,
) {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [2, 3] },
      link: {
        openOnClick: false,
        defaultProtocol: "https",
        isAllowedUri: (url) => !!safeExternalLink(url),
        shouldAutoLink: (url) => !!safeExternalLink(url),
      },
    }),
    Markdown,
    RichImage.configure({ asset }),
    RichVideo,
    UploadedVideo.configure({ asset: videoAsset }),
    LegacyContent,
  ];
}

export interface RichPostEditorHandle {
  insertTemplate: (markdown: string) => void;
}
interface Props {
  document: PostDocument | null;
  body: string;
  images: PublicImage[];
  videos?: PublicVideo[];
  disabled: boolean;
  upload: (file: File) => Promise<PublicImage>;
  onChange: (document: PostDocument, images: PublicImage[], videos: PublicVideo[]) => void;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string) => void;
}
export const RichPostEditor = forwardRef<RichPostEditorHandle, Props>(function RichPostEditor(
  { document, body, images, videos = [], disabled, upload, onChange, onBusyChange, onError },
  ref,
) {
  const assets = useRef(new Map(images.map((image) => [image.id, image])));
  const videoAssets = useRef(new Map(videos.map((video) => [video.id, video])));
  const callbacks = useRef({ onChange, onBusyChange, onError, upload });
  callbacks.current = { onChange, onBusyChange, onError, upload };
  const editorRef = useRef<Editor | null>(null),
    bookmark = useRef<SelectionBookmark | null>(null);
  const uploadingRef = useRef(false),
    inputRef = useRef<HTMLInputElement>(null),
    videoInputRef = useRef<HTMLInputElement>(null);
  const videoRequest = useRef<AbortController | null>(null);
  const [videoStage, setVideoStage] = useState<VideoUploadStage>("uploading");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploading, setUploading] = useState(false),
    [panel, setPanel] = useState<"link" | "video" | null>(null);
  const [address, setAddress] = useState(""),
    [panelError, setPanelError] = useState("");
  const [currentDocument, setCurrentDocument] = useState(document ?? EMPTY);
  const extensions = useMemo(
    () =>
      createRichPostEditorExtensions(
        (id) => assets.current.get(id),
        (id) => videoAssets.current.get(id),
      ),
    [],
  );
  const manager = useMemo(() => new MarkdownManager({ extensions }), [extensions]);
  const initialContent = useMemo(
    () => (document ? appendImages(document, images) : legacyDocument(body, manager, images)),
    [],
  );
  function notify(value: Editor) {
    const next = canonicalDocument(value.getJSON());
    setCurrentDocument(next);
    callbacks.current.onChange(
      next,
      postDocumentImageIds(next).flatMap((id) => {
        const image = assets.current.get(id);
        return image ? [image] : [];
      }),
      postDocumentVideoIds(next).flatMap((id) => {
        const video = videoAssets.current.get(id);
        return video ? [video] : [];
      }),
    );
  }
  function rememberSelection() {
    const current = editorRef.current;
    if (current) bookmark.current = current.state.selection.getBookmark();
  }
  function restoreSelection() {
    const current = editorRef.current;
    if (!current) return;
    const saved = bookmark.current;
    bookmark.current = null;
    if (saved)
      current.view.dispatch(current.state.tr.setSelection(saved.resolve(current.state.doc)));
  }
  async function insertFiles(files: File[]) {
    const current = editorRef.current;
    if (!current || disabled || uploadingRef.current || !files.length) return;
    const count = postDocumentImageIds(canonicalDocument(current.getJSON())).length;
    if (count + files.length > 10) {
      callbacks.current.onError("사진은 10장까지 넣을 수 있어요.");
      bookmark.current = null;
      return;
    }
    if (
      files.some(
        (file) =>
          !IMAGE_TYPES.has(file.type) || file.size > IMAGE_COMPRESSION_POLICY.post.maxInputBytes,
      )
    ) {
      callbacks.current.onError("JPG·PNG·WebP·GIF 형식의 10MB 이하 사진을 선택해주세요.");
      bookmark.current = null;
      return;
    }
    if (!bookmark.current) rememberSelection();
    uploadingRef.current = true;
    current.setEditable(false);
    setUploading(true);
    callbacks.current.onBusyChange(true);
    callbacks.current.onError("");
    try {
      for (const file of files) {
        const image = await callbacks.current.upload(file);
        if (current.isDestroyed) return;
        assets.current.set(image.id, image);
        restoreSelection();
        current
          .chain()
          .focus()
          .insertContent([
            { type: "image", attrs: { assetId: image.id, alt: "" } },
            { type: "paragraph" },
          ])
          .run();
        rememberSelection();
      }
    } catch (error) {
      callbacks.current.onError(
        error instanceof Error ? error.message : "사진을 올리지 못했어요. 다시 시도해주세요.",
      );
    } finally {
      bookmark.current = null;
      uploadingRef.current = false;
      setUploading(false);
      callbacks.current.onBusyChange(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  async function insertVideoFile(file: File | undefined) {
    const current = editorRef.current;
    if (!file || !current || disabled || uploadingRef.current) return;
    if (!acceptsVideoUpload(file.type, file.size)) {
      callbacks.current.onError("50MB 이하의 MP4·MOV·WebM 영상을 선택해주세요.");
      bookmark.current = null;
      if (videoInputRef.current) videoInputRef.current.value = "";
      return;
    }
    if (
      postDocumentVideoIds(canonicalDocument(current.getJSON())).length >= VIDEO_MAX_ATTACHMENTS
    ) {
      callbacks.current.onError("영상 파일은 3개까지 넣을 수 있어요.");
      bookmark.current = null;
      if (videoInputRef.current) videoInputRef.current.value = "";
      return;
    }
    if (!bookmark.current) rememberSelection();
    uploadingRef.current = true;
    current.setEditable(false);
    setUploading(true);
    setUploadingVideo(true);
    setVideoStage("uploading");
    const videoController = new AbortController();
    videoRequest.current = videoController;
    setPanel(null);
    callbacks.current.onBusyChange(true);
    callbacks.current.onError("");
    try {
      const video = await uploadVideoFile(file, {
        signal: videoController.signal,
        onProgress: (stage) => {
          if (!current.isDestroyed) setVideoStage(stage);
        },
      });
      if (current.isDestroyed) return;
      videoAssets.current.set(video.id, video);
      restoreSelection();
      current
        .chain()
        .focus()
        .insertContent([
          { type: "uploadedVideo", attrs: { assetId: video.id } },
          { type: "paragraph" },
        ])
        .run();
    } catch (error) {
      if (videoController.signal.aborted || current.isDestroyed) return;
      callbacks.current.onError(
        error instanceof Error ? error.message : "영상을 올리지 못했어요. 다시 시도해주세요.",
      );
    } finally {
      bookmark.current = null;
      uploadingRef.current = false;
      setUploading(false);
      setUploadingVideo(false);
      if (videoRequest.current === videoController) videoRequest.current = null;
      callbacks.current.onBusyChange(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }
  const editor = useEditor({
    extensions,
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "rich-editor-content",
        role: "textbox",
        "aria-label": "게시글 내용",
        "aria-multiline": "true",
      },
      transformPastedHTML: (html) => {
        const parsed = window.document.createElement("template");
        parsed.innerHTML = html;
        parsed.content
          .querySelectorAll(
            "iframe,object,embed,script,style,img,video,audio,source,form,input,button,svg,math,link,meta,base",
          )
          .forEach((node) => node.remove());
        const existing = new Set(
          postDocumentImageIds(canonicalDocument(editorRef.current?.getJSON() ?? {})),
        );
        const existingVideos = new Set(
          postDocumentVideoIds(canonicalDocument(editorRef.current?.getJSON() ?? {})),
        );
        parsed.content.querySelectorAll("figure[data-sliper-uploaded-video]").forEach((node) => {
          if (existingVideos.has(node.getAttribute("data-sliper-uploaded-video") ?? ""))
            node.remove();
        });
        parsed.content.querySelectorAll("figure[data-sliper-image]").forEach((node) => {
          if (existing.has(node.getAttribute("data-sliper-image") ?? "")) node.remove();
        });
        return parsed.innerHTML;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        rememberSelection();
        if (files.length === 1 && files[0]?.type.startsWith("video/"))
          void insertVideoFile(files[0]);
        else void insertFiles(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (moved || !files.length) return false;
        event.preventDefault();
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (position) editorRef.current?.commands.setTextSelection(position.pos);
        rememberSelection();
        if (files.length === 1 && files[0]?.type.startsWith("video/"))
          void insertVideoFile(files[0]);
        else void insertFiles(files);
        return true;
      },
    },
    onCreate: ({ editor: current }) => {
      editorRef.current = current;
      notify(current);
    },
    onUpdate: ({ editor: current }) => notify(current),
    onTransaction: ({ transaction }) => {
      if (bookmark.current) bookmark.current = bookmark.current.map(transaction.mapping);
    },
    onDestroy: () => {
      editorRef.current = null;
    },
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            underline: current.isActive("underline"),
            bullet: current.isActive("bulletList"),
            ordered: current.isActive("orderedList"),
            quote: current.isActive("blockquote"),
            link: current.isActive("link"),
            style: current.isActive("heading", { level: 2 })
              ? "2"
              : current.isActive("heading", { level: 3 })
                ? "3"
                : "paragraph",
            undo: current.can().undo(),
            redo: current.can().redo(),
          }
        : null,
  });
  useEffect(() => {
    editor?.setEditable(
      !disabled && (!uploading || (uploadingVideo && videoStage !== "uploading")),
    );
  }, [editor, disabled, uploading, uploadingVideo, videoStage]);
  useEffect(() => () => videoRequest.current?.abort(), []);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const cancel = () => {
      bookmark.current = null;
    };
    input.addEventListener("cancel", cancel);
    return () => input.removeEventListener("cancel", cancel);
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      insertTemplate: (markdown) => {
        if (!editor || disabled || uploadingRef.current) return;
        editor.commands.setContent(legacyDocument(markdown, manager, []));
        editor.commands.focus("end");
      },
    }),
    [editor, disabled, manager],
  );
  function openPanel(value: "link" | "video") {
    if (!editor) return;
    rememberSelection();
    setAddress(value === "link" ? String(editor.getAttributes("link").href ?? "") : "");
    setPanelError("");
    setPanel(value);
  }
  function insertAddress() {
    if (!editor || !panel || disabled || uploadingRef.current) return;
    const safe = safeExternalLink(address);
    if (!safe || (panel === "video" && !safe.startsWith("https://"))) {
      setPanelError(
        panel === "video"
          ? "https://로 시작하는 영상 페이지 주소를 입력해주세요."
          : "http:// 또는 https://로 시작하는 링크를 입력해주세요.",
      );
      return;
    }
    restoreSelection();
    if (panel === "video") {
      let count = 0;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "video") count++;
      });
      if (count >= 10) {
        setPanelError("영상은 10개까지 넣을 수 있어요.");
        return;
      }
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "video", attrs: { url: parseVideoUrl(safe)?.url ?? safe } },
          { type: "paragraph" },
        ])
        .run();
    } else if (editor.state.selection.empty && !editor.isActive("link"))
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: safe,
          marks: [{ type: "link", attrs: { href: safe } }],
        })
        .unsetLink()
        .run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
    setPanel(null);
    setAddress("");
    setPanelError("");
  }
  const blocked = disabled || uploading || !editor;
  const tools = [
    {
      name: "굵게",
      Icon: Bold,
      active: state?.bold,
      action: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      name: "기울임",
      Icon: Italic,
      active: state?.italic,
      action: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      name: "밑줄",
      Icon: Underline,
      active: state?.underline,
      action: () => editor?.chain().focus().toggleUnderline().run(),
    },
    {
      name: "글머리 목록",
      Icon: List,
      active: state?.bullet,
      action: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      name: "번호 목록",
      Icon: ListOrdered,
      active: state?.ordered,
      action: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      name: "인용",
      Icon: Quote,
      active: state?.quote,
      action: () => editor?.chain().focus().toggleBlockquote().run(),
    },
  ];
  return (
    <div className={cn("rich-post-editor", blocked && "is-disabled")}>
      <div className="rich-editor-toolbar" role="toolbar" aria-label="본문 편집 도구">
        <select
          aria-label="본문 스타일"
          disabled={blocked}
          value={state?.style ?? "paragraph"}
          onChange={(event) => {
            if (event.target.value === "paragraph") editor?.chain().focus().setParagraph().run();
            else
              editor
                ?.chain()
                .focus()
                .toggleHeading({ level: Number(event.target.value) as 2 | 3 })
                .run();
          }}
        >
          <option value="paragraph">본문</option>
          <option value="2">큰 제목</option>
          <option value="3">작은 제목</option>
        </select>
        <div className="rich-tools-group">
          {tools.map(({ name, Icon, active, action }) => (
            <button
              type="button"
              key={name}
              title={name}
              aria-label={name}
              aria-pressed={!!active}
              className={cn(active && "active")}
              disabled={blocked}
              onMouseDown={(event) => event.preventDefault()}
              onClick={action}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
        <div className="rich-tools-group rich-insert-tools">
          <button
            type="button"
            title="링크 삽입"
            aria-label="링크 삽입"
            aria-pressed={!!state?.link}
            disabled={blocked}
            className={cn(state?.link && "active")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openPanel("link")}
          >
            <Link2 size={16} />
            <span>링크</span>
          </button>
          <button
            type="button"
            disabled={blocked}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              rememberSelection();
              inputRef.current?.click();
            }}
          >
            <ImagePlus size={16} />
            <span>사진</span>
          </button>
          <button
            type="button"
            disabled={blocked}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openPanel("video")}
          >
            <Video size={16} />
            <span>영상</span>
          </button>
        </div>
        <div className="rich-tools-group rich-history-tools">
          <button
            type="button"
            title="실행 취소"
            aria-label="실행 취소"
            disabled={blocked || !state?.undo}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            title="다시 실행"
            aria-label="다시 실행"
            disabled={blocked || !state?.redo}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={16} />
          </button>
        </div>
      </div>
      {panel && (
        <div
          className="rich-link-panel"
          role="group"
          aria-label={panel === "video" ? "영상 첨부" : "링크 첨부"}
        >
          <div className="rich-link-panel-heading">
            <strong>{panel === "video" ? "원하는 위치에 영상 넣기" : "텍스트에 링크 넣기"}</strong>
            <button
              type="button"
              aria-label="링크 입력 닫기"
              onClick={() => {
                bookmark.current = null;
                setPanel(null);
              }}
            >
              <X size={16} />
            </button>
          </div>
          {panel === "video" && (
            <div className="rich-video-upload-choice">
              <button
                type="button"
                className="rich-insert-button"
                disabled={blocked}
                onClick={() => videoInputRef.current?.click()}
              >
                <Video size={16} />
                기기에서 영상 선택
              </button>
              <span>MP4·MOV·WebM · 50MB / 3분 이하 · 최대 3개</span>
              <small>화질과 용량을 조절해 저장해요. 또는 아래에 영상 링크를 넣어주세요.</small>
            </div>
          )}
          <div className="rich-link-input-row">
            <input
              aria-label={panel === "video" ? "영상 주소" : "링크 주소"}
              autoFocus
              type="url"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={2048}
              placeholder={panel === "video" ? "https://www.youtube.com/watch?v=…" : "https://…"}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  insertAddress();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  bookmark.current = null;
                  setPanel(null);
                }
              }}
            />
            <button type="button" className="rich-insert-button" onClick={insertAddress}>
              삽입
            </button>
          </div>
          <p>
            {panel === "video"
              ? "YouTube·Vimeo·영상 파일 링크는 본문에서 재생돼요. 다른 플랫폼은 영상 페이지로 연결돼요."
              : "텍스트를 선택한 뒤 링크를 넣으면 선택한 문장에 연결돼요."}
          </p>
          {panel === "link" && state?.link && (
            <button
              type="button"
              className="rich-remove-link"
              onClick={() => {
                restoreSelection();
                editor?.chain().focus().extendMarkRange("link").unsetLink().run();
                setPanel(null);
              }}
            >
              링크 제거
            </button>
          )}
          {panelError && (
            <p className="rich-panel-error" role="alert">
              {panelError}
            </p>
          )}
        </div>
      )}
      <input
        type="file"
        ref={inputRef}
        className="sr-only"
        aria-label="본문에 넣을 사진 선택"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={(event) => {
          void insertFiles(Array.from(event.target.files ?? []));
        }}
      />
      <input
        type="file"
        ref={videoInputRef}
        className="sr-only"
        aria-label="본문에 넣을 영상 선택"
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
        onChange={(event) => void insertVideoFile(event.target.files?.[0])}
      />
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="rich-editor-loading">편집기를 준비하고 있어요.</div>
      )}
      <div className="rich-editor-caption" aria-live="polite">
        <span>
          {uploading
            ? uploadingVideo
              ? videoStage === "uploading"
                ? "영상을 올리고 있어요…"
                : videoStage === "queued"
                  ? "영상이 접수됐어요. 처리하는 동안 이야기를 이어서 적어도 좋아요."
                  : "영상을 준비하고 있어요. 완료되면 선택한 위치에 넣어드릴게요."
              : "사진을 압축하고 저장하고 있어요…"
            : "커서 위치에 사진·영상을 넣고 이야기를 이어가세요."}
        </span>
        <small>
          사진 {postDocumentImageIds(currentDocument).length}/10 · 영상{" "}
          {postDocumentVideoIds(currentDocument).length}/3
        </small>
        <small>사진 10MB 이하 · WebP 압축 · 움직이는 사진은 첫 장면 저장</small>
        <small>글·행사 기록에 첨부하지 않은 사진과 영상은 30일 후 정리돼요.</small>
      </div>
    </div>
  );
});
