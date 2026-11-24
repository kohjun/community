import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { transcodeGameClue } from "../src/server/game-media-transcoding";
test("original sound clues are asynchronously encoded to a bounded MP4 audio container", async () => {
  // A sample sound from the former basic pack, kept in public/ for this test.
  const file = "/games/clue/62a1c211-1c8f-4021-9b42-dec8d529ba0a.wav",
    source = await readFile(path.join(process.cwd(), "public", file));
  const output = await transcodeGameClue(source, true, new AbortController().signal);
  assert.ok(output.byteLength > 1000 && output.byteLength < 1024 * 1024);
  assert.equal(output.subarray(4, 8).toString(), "ftyp");
  assert.ok(output.byteLength < source.byteLength);
});
test("media processing rejects arbitrary text masquerading as a supported audio file", async () => {
  await assert.rejects(
    transcodeGameClue(Buffer.from("not an audio recording"), true, new AbortController().signal),
  );
});
