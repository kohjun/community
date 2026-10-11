export const IMAGE_UPLOAD_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const IMAGE_COMPRESSION_POLICY = {
  post: {
    maxInputBytes: 10 * 1024 * 1024,
    maxOutputBytes: 2 * 1024 * 1024,
    maxDimension: 2400,
    steps: [
      { dimension: 2400, quality: 82 },
      { dimension: 2400, quality: 72 },
      { dimension: 1800, quality: 72 },
      { dimension: 1600, quality: 65 },
    ],
  },
  profile: {
    maxInputBytes: 5 * 1024 * 1024,
    maxOutputBytes: 256 * 1024,
    maxDimension: 512,
    steps: [
      { dimension: 512, quality: 82 },
      { dimension: 512, quality: 72 },
      { dimension: 384, quality: 72 },
      { dimension: 256, quality: 65 },
    ],
  },
} as const;
export const IMAGE_MAX_INPUT_PIXELS = 20_000_000;
export type CompressedImageKind = keyof typeof IMAGE_COMPRESSION_POLICY;
