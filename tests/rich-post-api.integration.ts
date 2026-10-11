import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import postgres from "postgres";
import sharp from "sharp";
import type { ActionResult, PublicImage } from "../src/domain/contracts";
import type { CommunityPost, CommunityDetail } from "../src/domain/community";
import { parseVideoUrl } from "../src/domain/post-document";
import { createLocalTestSession, loadLocalTestAccount } from "../src/server/local-test-auth";

const origin = "http://127.0.0.1:3000",
  url = new URL(process.env.DATABASE_URL || "http://missing");
if (
  process.env.LOCAL_DATABASE !== "1" ||
  process.env.SLIPER_AUTH_MODE !== "development" ||
  process.env.APP_ORIGIN !== origin ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.pathname !== "/sliper_dev"
)
  throw new Error("Rich post HTTP checks require the isolated local development database.");
const account = loadLocalTestAccount({ ...process.env, NODE_ENV: "development" });
if (!account) throw new Error("Set up the existing local test account before rich post checks.");
const otherCookie = "sliper_test_session=" + createLocalTestSession(account, "127.0.0.1:3000");
const db = postgres(url.toString(), { prepare: false, max: 1 });
async function api<T>(route: string, method = "GET", body?: unknown, cookie = "", from = origin) {
  const isForm = body instanceof FormData;
  const response = await fetch(origin + "/api/community" + route, {
    method,
    headers: {
      Origin: from,
      ...(!isForm ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? null : isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, result: (await response.json()) as ActionResult<T> };
}
function data<T>(response: { status: number; result: ActionResult<T> }) {
  assert.equal(response.status, 200);
  assert.ok(response.result.ok, "Rich post API returned an error.");
  return response.result.data;
}
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
test("rich posts persist ordered text/photos/video, retain legacy compatibility and enforce revision/asset ownership through HTTP", async () => {
  const fixturePosts: string[] = [],
    fixtureImages: PublicImage[] = [];
  const input = {
    categorySlug: "party",
    kind: "이야기",
    title: "본문 편집 HTTP 검사 " + randomUUID(),
    bodyMarkdown: "클라이언트가 보낸 검색문을 그대로 신뢰하지 않습니다.",
    isAnonymous: false,
    imageAssetIds: [] as string[],
  };
  async function upload(cookie = "") {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 10, g: 132, b: 254, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "fixture.png");
    const image = data(await api<PublicImage>("/uploads", "POST", form, cookie));
    fixtureImages.push(image);
    return image;
  }
  try {
    const first = await upload(),
      second = await upload(),
      foreign = await upload(otherCookie);
    const document = {
      version: 1,
      type: "doc",
      content: [
        paragraph("사진 앞 첫 문장"),
        { type: "image", attrs: { assetId: first.id, alt: "첫 번째 사진" } },
        paragraph("사진과 영상 사이 문장"),
        { type: "video", attrs: { url: "https://youtu.be/dQw4w9WgXcQ" } },
        paragraph("영상 다음 문장"),
        { type: "image", attrs: { assetId: second.id, alt: "두 번째 사진" } },
        paragraph("사진 다음 마지막 문장"),
      ],
    };
    const richInput = { ...input, bodyDocument: document, imageAssetIds: [first.id, second.id] };
    const created = data(await api<CommunityPost>("/posts", "POST", richInput));
    fixturePosts.push(created.id);
    assert.equal(created.bodyDocument?.version, 1);
    assert.deepEqual(
      created.bodyDocument?.content.map((node) => node.type),
      ["paragraph", "image", "paragraph", "video", "paragraph", "image", "paragraph"],
    );
    assert.ok(created.body.includes("첫 문장") && created.body.includes("마지막 문장"));
    assert.equal(
      created.body.includes("클라이언트가 보낸"),
      false,
      "The server derives search text from the document.",
    );
    assert.deepEqual(
      created.images.map((image) => image.id),
      [first.id, second.id],
    );
    const video = created.bodyDocument?.content.find((node) => node.type === "video");
    assert.ok(video && video.type === "video");
    assert.equal(parseVideoUrl(video.attrs.url)?.provider, "youtube");
    for (const image of [first, second]) {
      const response = await fetch(origin + image.src);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /^image\/webp/);
    }
    const loaded = data(await api<CommunityDetail>("/posts/" + created.id));
    assert.deepEqual(loaded.post.bodyDocument, created.bodyDocument);
    const edit = {
      ...richInput,
      title: input.title + " 수정",
      expectedUpdatedAt: created.updatedAt,
    };
    assert.equal((await api("/posts/" + created.id, "PATCH", edit, otherCookie)).status, 403);
    assert.equal(
      (await api("/posts/" + created.id, "PATCH", edit, "", "https://untrusted.example.invalid"))
        .status,
      403,
    );
    const changed = data(await api<CommunityPost>("/posts/" + created.id, "PATCH", edit));
    assert.equal((await api("/posts/" + created.id, "PATCH", edit)).status, 409);
    const { bodyDocument: omitted, ...legacyEdit } = edit;
    void omitted;
    assert.equal(
      (
        await api("/posts/" + created.id, "PATCH", {
          ...legacyEdit,
          expectedUpdatedAt: changed.updatedAt,
        })
      ).status,
      400,
      "Old clients cannot silently erase a rich document.",
    );
    assert.deepEqual(
      data(await api<CommunityDetail>("/posts/" + created.id)).post.bodyDocument,
      changed.bodyDocument,
    );
    for (const invalid of [
      { version: 1, type: "doc", content: [paragraph("잘못된 문자" + String.fromCharCode(0))] },
      {
        version: 1,
        type: "doc",
        content: [paragraph("잘못된 문자" + String.fromCharCode(0xd800))],
      },
      {
        version: 1,
        type: "doc",
        content: [{ type: "iframe", attrs: { src: "https://untrusted.example.invalid/embed" } }],
      },
      {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "링크",
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          },
        ],
      },
      {
        version: 1,
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              assetId: first.id,
              src: "https://untrusted.example.invalid/tracker",
              alt: "외부 이미지",
            },
          },
        ],
      },
      {
        version: 1,
        type: "doc",
        content: [{ type: "video", attrs: { url: "https://127.0.0.1/private.mp4" } }],
      },
    ]) {
      assert.equal(
        (
          await api("/posts", "POST", {
            ...input,
            bodyDocument: invalid,
            imageAssetIds: [first.id],
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await api("/posts", "POST", {
          ...input,
          bodyDocument: {
            version: 1,
            type: "doc",
            content: [
              paragraph("다른 회원의 이미지"),
              { type: "image", attrs: { assetId: foreign.id, alt: "권한 검사" } },
            ],
          },
          imageAssetIds: [foreign.id],
        })
      ).status,
      403,
    );
    assert.equal(
      (await api("/posts", "POST", { ...input, bodyDocument: document, imageAssetIds: [] })).status,
      400,
    );
    const legacy = data(
      await api<CommunityPost>("/posts", "POST", {
        ...input,
        title: "기존 마크다운 검사",
        bodyMarkdown: "## 기존 제목\n\n**기존 본문을 유지합니다.**",
      }),
    );
    fixturePosts.push(legacy.id);
    assert.equal(legacy.bodyDocument ?? null, null);
    assert.ok(legacy.body.includes("**기존"));
    const legacyChanged = data(
      await api<CommunityPost>("/posts/" + legacy.id, "PATCH", {
        ...input,
        title: legacy.title,
        bodyMarkdown: "## 수정 후에도 기존 방식 유지",
        expectedUpdatedAt: legacy.updatedAt,
      }),
    );
    assert.equal(legacyChanged.bodyDocument ?? null, null);
    const removed = data(await api<{ id: string }>("/posts/" + created.id, "DELETE"));
    assert.equal(removed.id, created.id);
    const [deleted] =
      await db`select body_document, body_markdown from sliper.posts where id=${created.id}`;
    assert.ok(deleted, "The soft-deleted test row remains present.");
    assert.equal(
      deleted.body_document,
      null,
      "Deleting a post clears the persisted rich document.",
    );
    assert.equal(deleted.body_markdown, "");
    assert.equal((await fetch(origin + first.src)).status, 404);
    assert.equal((await api("/posts/" + created.id)).status, 404);
  } finally {
    try {
      for (const id of fixturePosts) {
        await db`delete from sliper.activity_events where source_key=${"post:" + id}`;
        await db`delete from sliper.posts where id=${id}`;
      }
      for (const image of fixtureImages) {
        assert.match(image.id, /^[0-9a-f-]{36}$/i);
        await db`delete from sliper.media_assets where id=${image.id}`;
        await unlink(path.join(process.cwd(), ".local", "uploads", image.id + ".webp")).catch(
          () => {},
        );
      }
    } finally {
      await db.end();
    }
  }
});
