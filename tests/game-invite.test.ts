import assert from "node:assert/strict";
import test from "node:test";
import { gameJoinUrl } from "../src/domain/game-invite";
const id = "F71DF8DA-49AB-47A5-9A70-77C32C376108";
test("QR invitations use the guest path without host authority, OAuth parameters or fragments", () => {
  const url = new URL(gameJoinUrl("https://sliper.kr", id));
  assert.equal(url.href, `https://sliper.kr/games/${id.toLowerCase()}`);
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
});
test("local and LAN invitation links preserve the running website port", () => {
  for (const origin of ["http://127.0.0.1:3000", "http://192.168.0.5:3000", "https://sliper.kr"])
    assert.equal(new URL(gameJoinUrl(origin, id)).origin, origin);
});
test("invites reject embedded credentials, unsafe protocols, paths, queries and malformed room IDs", () => {
  for (const origin of [
    "javascript:alert(1)",
    "data:text/plain,room",
    "https://user:pass@sliper.kr",
    "https://sliper.kr/login",
    "https://sliper.kr?host=1",
    "https://sliper.kr#token=private",
  ])
    assert.throws(() => gameJoinUrl(origin, id));
  assert.throws(() => gameJoinUrl("https://sliper.kr", "../../management"));
});
