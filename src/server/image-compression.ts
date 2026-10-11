import sharp from "sharp";
import {
  IMAGE_COMPRESSION_POLICY,
  IMAGE_MAX_INPUT_PIXELS,
  type CompressedImageKind,
} from "../domain/image-compression";
import { AppError } from "./errors";

const acceptedFormats = new Set(["jpeg", "png", "webp", "gif"]);
const invalidImageMessage = "읽을 수 있는 JPG·PNG·WebP·GIF 사진(2천만 화소 이하)을 선택해주세요.";

/**
 * Only encoded WebP bytes leave this boundary; original files and their EXIF/GPS
 * metadata never reach storage. Animated inputs intentionally become a still frame.
 */
export async function compressUploadedImage(
  input: Buffer,
  kind: CompressedImageKind,
): Promise<Buffer> {
  const policy = IMAGE_COMPRESSION_POLICY[kind];
  if (!input.byteLength || input.byteLength > policy.maxInputBytes)
    throw new AppError(
      "VALIDATION",
      kind === "post"
        ? "10MB 이하의 JPG·PNG·WebP·GIF 사진을 선택해주세요."
        : "5MB 이하의 JPG·PNG·WebP·GIF 사진을 선택해주세요.",
    );
  try {
    // Never decode every frame of an untrusted animation.
    const source = sharp(input, {
      page: 0,
      pages: 1,
      animated: false,
      limitInputPixels: IMAGE_MAX_INPUT_PIXELS,
      failOn: "warning",
    });
    const metadata = await source.metadata();
    if (!acceptedFormats.has(metadata.format || "") || !metadata.width || !metadata.height)
      throw new Error("Unsupported image");
    for (const step of policy.steps) {
      const pipeline = source.clone().rotate();
      if (kind === "profile")
        pipeline.resize(step.dimension, step.dimension, { fit: "cover", position: "centre" });
      else
        pipeline.resize({
          width: step.dimension,
          height: step.dimension,
          fit: "inside",
          withoutEnlargement: true,
        });
      // Sharp strips source metadata by default. Do not add keep/withMetadata here.
      const output = await pipeline.webp({ quality: step.quality, effort: 4 }).toBuffer();
      if (output.byteLength > 0 && output.byteLength <= policy.maxOutputBytes) return output;
    }
    throw new Error("Encoded image exceeded output budget");
  } catch {
    throw new AppError("VALIDATION", invalidImageMessage);
  }
}
