import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CLUE_AUDIO_BANK } from "../src/server/clue-bank";
import { transcodeGameClue } from "../src/server/game-media-transcoding";
test("original sound clues are asynchronously encoded to a bounded MP4 audio container", async () => {
  const file = CLUE_AUDIO_BANK[0]!.basicAsset!,
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
