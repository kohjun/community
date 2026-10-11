import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { TextSelection } from "@tiptap/pm/state";
import { createRichPostEditorExtensions } from "../src/components/rich-post-editor";
import {
  appendImages,
  canonicalDocument,
  legacyDocument,
} from "../src/lib/rich-post-editor-document";
import { postDocumentImageIds, postDocumentSchema } from "../src/domain/post-document";
import type { PublicImage } from "../src/domain/contracts";
const image: PublicImage = {
  id: "5d75ce60-68f4-42b0-8bb8-1de9049dc0d1",
  src: "/api/media/5d75ce60-68f4-42b0-8bb8-1de9049dc0d1",
  contentType: "image/webp",
  sortOrder: 0,
};
const extensions = createRichPostEditorExtensions((id) => (id === image.id ? image : undefined));
const manager = new MarkdownManager({ extensions });
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
function headlessEditor(text = "앞 문장뒤 문장") {
  const editor = new Editor({
    element: null,
    extensions,
    content: { type: "doc", content: [paragraph(text)] },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
}
function insertImage(editor: Editor) {
  assert.equal(
    editor.commands.insertContent([
      { type: "image", attrs: { assetId: image.id, alt: "" } },
      { type: "paragraph" },
    ]),
    true,
  );
}
test("ordinary legacy Markdown retains heading, emphasis, list and public link when imported", () => {
  const document = legacyDocument(
    "# 제목\n\n이것은 **중요** [참고](https://example.com/info) 입니다.\n\n1. 첫 항목\n2. 다음 항목",
    manager,
    [],
  );
  assert.equal(document.content[0]?.type, "heading");
  assert.deepEqual(document.content[0]?.type === "heading" ? document.content[0].attrs : null, {
    level: 2,
  });
  const text = JSON.stringify(document);
  assert.match(text, /중요/);
  assert.match(text, /"type":"bold"/);
  assert.match(text, /"href":"https:\/\/example.com\/info"/);
  assert.match(text, /orderedList/);
  assert.equal(postDocumentSchema.safeParse(document).success, true);
});
for (const [name, markdown] of [
  ["fenced code", "앞 문장\n\n\x60\x60\x60ts\nconst answer = 42;\n\x60\x60\x60\n\n뒤 문장"],
  ["table", "앞 문장\n\n| 이름 | 내용 |\n| --- | --- |\n| 슬리퍼 | 모임 |\n\n뒤 문장"],
  ["indented code", "앞 문장\n\n    return 42;\n\n뒤 문장"],
  ["tab-indented code", "앞 문장\n\n\treturn 42;\n\n뒤 문장"],
  ["quoted indented code", "앞 문장\n\n>     return 42;\n\n뒤 문장"],
  ["list fenced code", "앞 문장\n\n- \x60\x60\x60ts\n  return 42;\n  \x60\x60\x60\n\n뒤 문장"],
  ["nested fenced code", "앞 문장\n\n> \x60\x60\x60ts\n> return 42;\n> \x60\x60\x60\n\n뒤 문장"],
  [
    "reference image",
    "앞 문장\n\n![기존 사진][photo]\n\n뒤 문장\n\n[photo]: https://example.com/image.png",
  ],
  ["task list", "앞 문장\n\n- [x] 완료\n- [ ] 다음\n\n뒤 문장"],
  ["remote image", "앞 문장\n\n![기존 사진](https://example.com/image.png)\n\n뒤 문장"],
  ["HTML source", "앞 문장\n\n<strong>기존 내용</strong>\n\n뒤 문장"],
] as const) {
  test("unsupported legacy " + name + " preserves its complete original source", () => {
    const document = legacyDocument(markdown, manager, [image]);
    const block = document.content.find((node) => node.type === "legacyMarkdown");
    assert.equal(block?.type === "legacyMarkdown" ? block.attrs.markdown : null, markdown);
    assert.deepEqual(postDocumentImageIds(document), [image.id]);
    assert.equal(postDocumentSchema.safeParse(document).success, true);
  });
}
test("initial attachments become document blocks once and do not duplicate existing inline images", () => {
  const imported = legacyDocument("", manager, [image]);
  const appended = appendImages(imported, [image]);
  assert.deepEqual(postDocumentImageIds(appended), [image.id]);
  assert.equal(appended.content.filter((node) => node.type === "image").length, 1);
});
test("inserting a photo in the middle of a paragraph retains both sides and allows continuing text", () => {
  const editor = headlessEditor();
  editor.commands.setTextSelection(5);
  insertImage(editor);
  editor.commands.insertContent({ type: "text", text: "사진 다음 새 문장" });
  const document = canonicalDocument(editor.getJSON());
  const picture = document.content.findIndex((node) => node.type === "image");
  assert.ok(picture > 0);
  assert.equal(
    document.content[0]?.type === "paragraph"
      ? document.content[0].content?.[0]?.type === "text"
        ? document.content[0].content[0].text
        : ""
      : "",
    "앞 문장",
  );
  const source = JSON.stringify(document);
  assert.ok(source.indexOf("사진 다음 새 문장") > source.indexOf(image.id));
  assert.ok(source.indexOf("뒤 문장") > source.indexOf(image.id));
  assert.equal(postDocumentSchema.safeParse(document).success, true);
  editor.destroy();
});
test("an upload bookmark follows document changes and ignores a cursor move while awaiting upload", () => {
  const editor = headlessEditor();
  editor.commands.setTextSelection(5);
  let bookmark = editor.state.selection.getBookmark();
  editor.on("transaction", ({ transaction }) => {
    bookmark = bookmark.map(transaction.mapping);
  });
  editor.commands.insertContentAt(1, { type: "text", text: "추가 " });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)));
  insertImage(editor);
  const source = JSON.stringify(canonicalDocument(editor.getJSON()));
  assert.ok(source.indexOf("추가 앞 문장") < source.indexOf(image.id));
  assert.ok(source.indexOf(image.id) < source.indexOf("뒤 문장"));
  editor.destroy();
});
test("undo and redo restore inline photos while the asset pool remains reusable", () => {
  const editor = headlessEditor();
  editor.commands.setTextSelection(5);
  insertImage(editor);
  assert.deepEqual(postDocumentImageIds(canonicalDocument(editor.getJSON())), [image.id]);
  assert.equal(editor.commands.undo(), true);
  assert.deepEqual(postDocumentImageIds(canonicalDocument(editor.getJSON())), []);
  assert.equal(editor.state.doc.textContent, "앞 문장뒤 문장");
  assert.equal(editor.commands.redo(), true);
  assert.deepEqual(postDocumentImageIds(canonicalDocument(editor.getJSON())), [image.id]);
  editor.destroy();
});
test("real editor schema saves inline links without TipTap default HTML attributes", () => {
  const editor = headlessEditor();
  editor.commands.setTextSelection({ from: 1, to: 5 });
  editor.commands.setLink({ href: "https://example.com/info" });
  const document = canonicalDocument(editor.getJSON());
  assert.equal(postDocumentSchema.safeParse(document).success, true);
  assert.ok(!JSON.stringify(document).includes("noopener"));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
  editor.chain().extendMarkRange("link").setLink({ href: "https://example.com/changed" }).run();
  assert.equal(editor.state.doc.textContent, "앞 문장뒤 문장");
  assert.match(
    JSON.stringify(canonicalDocument(editor.getJSON())),
    /https:\/\/example.com\/changed/,
  );
  editor.destroy();
});
test("video blocks keep text before and after them in the actual editor schema", () => {
  const editor = headlessEditor();
  editor.commands.setTextSelection(5);
  editor.commands.insertContent([
    { type: "video", attrs: { url: "https://youtu.be/dQw4w9WgXcQ" } },
    { type: "paragraph" },
  ]);
  editor.commands.insertContent({ type: "text", text: "영상 다음 내용" });
  const parsed = postDocumentSchema.parse(canonicalDocument(editor.getJSON()));
  const video = parsed.content.findIndex((node) => node.type === "video");
  assert.ok(video > 0);
  const source = JSON.stringify(parsed);
  assert.match(source, /https:\/\/www.youtube.com\/watch\?v=dQw4w9WgXcQ/);
  assert.ok(source.indexOf("영상 다음 내용") > source.indexOf("watch"));
  assert.ok(source.indexOf("뒤 문장") > source.indexOf("watch"));
  editor.destroy();
});

test("uploaded video files stay between paragraphs and survive undo/redo in the real editor schema", () => {
  const editor = headlessEditor();
  editor.commands.setTextSelection(5);
  assert.equal(
    editor.commands.insertContent([
      { type: "uploadedVideo", attrs: { assetId: image.id } },
      { type: "paragraph" },
    ]),
    true,
  );
  let document = canonicalDocument(editor.getJSON());
  assert.equal(postDocumentSchema.safeParse(document).success, true);
  assert.deepEqual(
    document.content.map((node) => node.type),
    ["paragraph", "uploadedVideo", "paragraph", "paragraph"],
  );
  assert.ok(
    JSON.stringify(document).indexOf("앞 문장") < JSON.stringify(document).indexOf(image.id),
  );
  assert.ok(
    JSON.stringify(document).indexOf(image.id) < JSON.stringify(document).indexOf("뒤 문장"),
  );
  assert.equal(editor.commands.undo(), true);
  assert.equal(editor.state.doc.textContent, "앞 문장뒤 문장");
  assert.equal(editor.commands.redo(), true);
  document = canonicalDocument(editor.getJSON());
  assert.equal(document.content.filter((node) => node.type === "uploadedVideo").length, 1);
  editor.destroy();
});
