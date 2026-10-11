import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PostBody } from "../src/components/post-body";
import { EmbeddedVideo } from "../src/components/embedded-video";
import type { PostDocument } from "../src/domain/post-document";
import type { PublicImage } from "../src/domain/contracts";

const firstId = "5d75ce60-68f4-42b0-8bb8-1de9049dc0d1";
const secondId = "5d75ce60-68f4-42b0-8bb8-1de9049dc0d2";
const firstImage: PublicImage = {
  id: firstId,
  src: "/api/media/" + firstId,
  contentType: "image/png",
  sortOrder: 0,
};
const secondImage: PublicImage = {
  id: secondId,
  src: "/api/media/" + secondId,
  contentType: "image/png",
  sortOrder: 1,
};
const doc = (content: PostDocument["content"]): PostDocument => ({
  version: 1,
  type: "doc",
  content,
});
const paragraph = (text: string): PostDocument["content"][number] => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const renderBody = (document: PostDocument | null, images: PublicImage[] = []) =>
  renderToStaticMarkup(createElement(PostBody, { document, body: "기존 내용", images }));

test("rich post body preserves text, video, image and following text order without duplicating the gallery", () => {
  const markup = renderBody(
    doc([
      paragraph("영상 앞 내용"),
      { type: "video", attrs: { url: "https://youtu.be/dQw4w9WgXcQ" } },
      paragraph("사진 앞 내용"),
      { type: "image", attrs: { assetId: firstId, alt: "모임 현장" } },
      paragraph("사진 다음 내용"),
    ]),
    [firstImage, secondImage],
  );
  const positions = [
    markup.indexOf("영상 앞 내용"),
    markup.indexOf('class="post-video"'),
    markup.indexOf("사진 앞 내용"),
    markup.indexOf('alt="모임 현장"'),
    markup.indexOf("사진 다음 내용"),
    markup.indexOf("post-unplaced-images"),
  ];
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
  );
  assert.equal(
    (markup.match(new RegExp('<img[^>]*src="/api/media/' + firstId, "g")) ?? []).length,
    1,
  );
  assert.equal((markup.match(/<img /g) ?? []).length, 2);
  assert.doesNotMatch(markup, /<iframe|youtube-nocookie\.com/);
});

test("video embeds and direct files require a click before any player or remote preview is rendered", () => {
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://vimeo.com/12345678",
    "https://cdn.example.com/event.mp4",
  ]) {
    const markup = renderToStaticMarkup(createElement(EmbeddedVideo, { url }));
    assert.match(markup, /눌러서 영상을 불러오세요/);
    assert.doesNotMatch(markup, /<iframe|<video|<img|<source/);
    assert.match(markup, /rel="noopener noreferrer"/);
  }
});

test("unsupported public video URLs render only an external link card and unsafe URLs render nothing", () => {
  const markup = renderToStaticMarkup(
    createElement(EmbeddedVideo, { url: "https://www.example.com/watch?id=123" }),
  );
  assert.match(markup, /첨부한 영상 링크/);
  assert.match(markup, /href="https:\/\/www\.example\.com\/watch\?id=123"/);
  assert.doesNotMatch(markup, /<iframe|<video|post-video-activate/);
  for (const url of [
    "javascript:alert(1)",
    "https://127.0.0.1/video.mp4",
    "https://user:pass@example.com/video.mp4",
  ]) {
    assert.equal(renderToStaticMarkup(createElement(EmbeddedVideo, { url })), "");
  }
});

test("rich text is escaped, safe links have opener protection, and only matched private media can load", () => {
  const markup = renderBody(
    doc([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "<script>alert(1)</script>",
            marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      },
      { type: "image", attrs: { assetId: firstId, alt: '" onerror="alert(1)' } },
      { type: "image", attrs: { assetId: secondId, alt: "외부 사진" } },
    ]),
    [firstImage, { ...secondImage, src: "https://tracker.example.com/photo.png" }],
  );
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script|onerror="alert|tracker\.example\.com|외부 사진/);
  assert.match(markup, /<strong>/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.equal((markup.match(/<img /g) ?? []).length, 1);
});

test("legacy posts retain Markdown rendering and the original image-first arrangement", () => {
  const markup = renderToStaticMarkup(
    createElement(PostBody, {
      body: "### 예전 글\n**내용**\n\n<script>alert(1)</script>",
      images: [firstImage],
    }),
  );
  assert.ok(markup.indexOf('class="detail-image"') < markup.indexOf('<div class="markdown">'));
  assert.match(markup, /<h3>예전 글<\/h3>/);
  assert.match(markup, /<strong>내용<\/strong>/);
  assert.doesNotMatch(markup, /<script>/);
});

test("imported legacy Markdown remains safely rendered between new rich blocks", () => {
  const markup = renderBody(
    doc([
      paragraph("추가한 앞 내용"),
      {
        type: "legacyMarkdown",
        attrs: {
          markdown:
            '**기존 표와 서식**\n\n<iframe src="https://evil.example.com"></iframe>\n\n![외부 이미지](https://tracker.example.com/image.png)',
        },
      },
      paragraph("추가한 뒷 내용"),
    ]),
  );
  assert.match(markup, /<strong>기존 표와 서식<\/strong>/);
  assert.ok(markup.indexOf("추가한 앞 내용") < markup.indexOf("기존 표와 서식"));
  assert.ok(markup.indexOf("기존 표와 서식") < markup.indexOf("추가한 뒷 내용"));
  assert.doesNotMatch(markup, /<iframe|<img|tracker\.example\.com/);
});
