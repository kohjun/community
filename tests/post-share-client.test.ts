import assert from "node:assert/strict";
import test from "node:test";
import { postShareUrl, sharePost, shouldOpenPostModal } from "../src/lib/post-sharing";
const postId = "4f513b14-dfdc-4b04-bf24-e75e171f77ec";
const input = { postId, title: "같이 추리 게임 해요", origin: "https://sliper.example" };

test("post sharing builds a stable URL without the current page query or fragment", () => {
  assert.equal(
    postShareUrl(postId.toUpperCase(), "https://sliper.example/stories?private=hidden#comment"),
    "https://sliper.example/posts/" + postId,
  );
  assert.equal(
    postShareUrl(postId, "http://192.168.0.4:3000"),
    "http://192.168.0.4:3000/posts/" + postId,
  );
  for (const origin of [
    "javascript:alert(1)",
    "https://user:password@example.com",
    "file:///tmp/post",
  ])
    assert.throws(() => postShareUrl(postId, origin));
  assert.throws(() => postShareUrl("../me", "https://sliper.example"));
});
test("native sharing starts in the initiating click turn and contains only the post title and URL", async () => {
  let invoked = false,
    copied = false;
  const pending = sharePost(input, {
    share: async (data) => {
      invoked = true;
      assert.deepEqual(data, { title: input.title, url: postShareUrl(postId, input.origin) });
    },
    copy: async () => {
      copied = true;
    },
  });
  assert.equal(invoked, true);
  assert.equal((await pending).status, "shared");
  assert.equal(copied, false);
});
test("cancelling native share never copies the link or opens another destination", async () => {
  let copies = 0;
  const result = await sharePost(input, {
    share: async () => {
      throw Object.assign(new Error("cancel"), { name: "AbortError" });
    },
    copy: async () => {
      copies++;
    },
  });
  assert.equal(result.status, "cancelled");
  assert.equal(copies, 0);
});
test("unsupported native sharing falls back to clipboard", async () => {
  let copied = "";
  const result = await sharePost(input, {
    copy: async (url) => {
      copied = url;
    },
  });
  assert.equal(result.status, "copied");
  assert.equal(copied, postShareUrl(postId, input.origin));
});
test("a blocked share API tries clipboard and blocked clipboard offers manual copying", async () => {
  const result = await sharePost(input, {
    share: async () => {
      throw new Error("not supported");
    },
    copy: async () => {
      throw new Error("HTTP origin");
    },
  });
  assert.equal(result.status, "manual");
  assert.equal(result.url, postShareUrl(postId, input.origin));
  assert.equal((await sharePost(input, {})).status, "manual");
});
test("only a normal unmodified left click opens the modal; new tab and keyboard modifiers stay native", () => {
  const click = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  assert.equal(shouldOpenPostModal(click), true);
  for (const key of ["defaultPrevented", "metaKey", "ctrlKey", "shiftKey", "altKey"] as const)
    assert.equal(shouldOpenPostModal({ ...click, [key]: true }), false);
  for (const button of [1, 2]) assert.equal(shouldOpenPostModal({ ...click, button }), false);
});
