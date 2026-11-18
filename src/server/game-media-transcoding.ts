import { mkdtemp, writeFile, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import ffprobe from "@ffprobe-installer/ffprobe";
import { runMediaProcess, withVideoProcessingSlot } from "./video-transcoding-core";
export async function transcodeGameClue(bytes: Uint8Array, audio: boolean, signal: AbortSignal) {
  return withVideoProcessingSlot(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sliper-game-media-")),
      input = path.join(dir, "input.bin"),
      output = path.join(dir, "output.mp4");
    try {
      await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
      const metadata = JSON.parse(
        await runMediaProcess(
          ffprobe.path,
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-format_whitelist",
            "mov,matroska,webm,mp3,wav,ogg,aac",
            "-show_entries",
            "format=duration:stream=codec_type,width,height",
            "-of",
            "json",
            input,
          ],
          15000,
          signal,
        ),
      ) as {
        format?: { duration?: string };
        streams?: { codec_type?: string; width?: number; height?: number }[];
      };
      const seconds = Number(metadata.format?.duration);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > (audio ? 30 : 15))
        throw new Error("GAME_MEDIA_DURATION");
      if (!metadata.streams?.some((s) => s.codec_type === (audio ? "audio" : "video")))
        throw new Error("GAME_MEDIA_TRACK");
      if (!audio && metadata.streams.some((s) => (s.width ?? 0) * (s.height ?? 0) > 20_000_000))
        throw new Error("GAME_MEDIA_RESOLUTION");
      if (!ffmpeg) throw new Error("FFMPEG_UNAVAILABLE");
      await runMediaProcess(
        ffmpeg,
        [
          "-nostdin",
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "mov,matroska,webm,mp3,wav,ogg,aac",
          "-i",
          input,
          "-map_metadata",
          "-1",
          "-threads",
          "1",
          ...(audio
            ? ["-vn", "-c:a", "aac", "-b:a", "96k"]
            : [
                "-vf",
                "scale='min(1280,iw)':-2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "28",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
              ]),
          "-t",
          String(audio ? 30 : 15),
          "-movflags",
          "+faststart",
          output,
        ],
        60000,
        signal,
      );
      const result = await readFile(output);
      if (result.byteLength > 10 * 1024 * 1024) throw new Error("GAME_MEDIA_SIZE");
      return result;
    } finally {
      await unlink(input).catch(() => {});
      await unlink(output).catch(() => {});
      await rmdir(dir).catch(() => {});
    }
  });
}
