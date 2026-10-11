import type { ReactNode } from "react";
import type { PublicImage, PublicVideo } from "../domain/contracts";
import {
  postDocumentSchema,
  safeExternalLink,
  type PostDocument,
  type PostDocumentMark,
  type PostDocumentNode,
} from "../domain/post-document";
import { Markdown } from "./markdown";
import { EmbeddedVideo } from "./embedded-video";

function markedText(text: string, marks: PostDocumentMark[] = []): ReactNode {
  return marks.reduce<ReactNode>((children, mark, index) => {
    switch (mark.type) {
      case "bold":
        return <strong key={index}>{children}</strong>;
      case "italic":
        return <em key={index}>{children}</em>;
      case "strike":
        return <s key={index}>{children}</s>;
      case "underline":
        return <u key={index}>{children}</u>;
      case "code":
        return <code key={index}>{children}</code>;
      case "link": {
        const href = safeExternalLink(mark.attrs.href);
        return href ? (
          <a key={index} href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          children
        );
      }
    }
  }, text);
}

function privateImage(image: PublicImage | undefined): image is PublicImage {
  return (
    !!image &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(image.id) &&
    image.src === "/api/media/" + image.id
  );
}

export function PostBody({
  document,
  body,
  images,
  videos = [],
}: {
  document?: PostDocument | null;
  body: string;
  images: PublicImage[];
  videos?: PublicVideo[];
}) {
  const videoById = new Map(
    videos
      .filter((video) => video.src === "/api/videos/" + video.id)
      .map((video) => [video.id, video]),
  );
  const parsed = document ? postDocumentSchema.safeParse(document) : null;
  const byId = new Map(images.filter(privateImage).map((image) => [image.id, image]));
  if (!parsed?.success) {
    return (
      <>
        {[...byId.values()].map((image) => (
          <img key={image.id} className="detail-image" src={image.src} alt="첨부 이미지" />
        ))}
        <Markdown>{body}</Markdown>
      </>
    );
  }
  const placed = new Set<string>();
  const renderNodes = (nodes: PostDocumentNode[] = []): ReactNode =>
    nodes.map((node, index) => {
      switch (node.type) {
        case "text":
          return <span key={index}>{markedText(node.text, node.marks)}</span>;
        case "paragraph":
          return <p key={index}>{renderNodes(node.content)}</p>;
        case "heading":
          return node.attrs.level === 2 ? (
            <h2 key={index}>{renderNodes(node.content)}</h2>
          ) : (
            <h3 key={index}>{renderNodes(node.content)}</h3>
          );
        case "bulletList":
          return <ul key={index}>{renderNodes(node.content)}</ul>;
        case "orderedList":
          return (
            <ol key={index} start={node.attrs?.start ?? 1}>
              {renderNodes(node.content)}
            </ol>
          );
        case "listItem":
          return <li key={index}>{renderNodes(node.content)}</li>;
        case "blockquote":
          return <blockquote key={index}>{renderNodes(node.content)}</blockquote>;
        case "hardBreak":
          return <br key={index} />;
        case "horizontalRule":
          return <hr key={index} />;
        case "uploadedVideo": {
          const video = videoById.get(node.attrs.assetId);
          if (!video) return null;
          return (
            <figure key={index} className="post-video post-uploaded-video">
              <video
                src={"/api/videos/" + video.id}
                controls
                playsInline
                preload="none"
                width={video.width}
                height={video.height}
                aria-label="첨부 영상"
              />
              <figcaption className="post-video-caption">
                <span>첨부 영상 · {Math.ceil(video.durationSeconds)}초</span>
                <span>{(video.byteSize / 1024 / 1024).toFixed(1)}MB</span>
              </figcaption>
            </figure>
          );
        }
        case "video":
          return <EmbeddedVideo key={index} url={node.attrs.url} />;
        case "legacyMarkdown":
          return <Markdown key={index}>{node.attrs.markdown}</Markdown>;
        case "image": {
          const image = byId.get(node.attrs.assetId);
          if (!image || placed.has(image.id)) return null;
          placed.add(image.id);
          return (
            <figure key={index} className="post-inline-image">
              <img src={image.src} alt={node.attrs.alt || "첨부 이미지"} loading="lazy" />
            </figure>
          );
        }
      }
    });
  const content = renderNodes(parsed.data.content);
  const unplaced = [...byId.values()].filter((image) => !placed.has(image.id));
  return (
    <div className="rich-post-body">
      {content}
      {unplaced.length > 0 && (
        <div className="post-unplaced-images" aria-label="첨부 이미지">
          {unplaced.map((image) => (
            <figure key={image.id} className="post-inline-image">
              <img src={image.src} alt="첨부 이미지" loading="lazy" />
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
