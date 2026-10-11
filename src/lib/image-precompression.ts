import {
  IMAGE_COMPRESSION_POLICY,
  IMAGE_MAX_INPUT_PIXELS,
  IMAGE_UPLOAD_CONTENT_TYPES,
  type CompressedImageKind,
} from "../domain/image-compression";

const invalidImageMessage = "읽을 수 있는 JPG·PNG·WebP·GIF 사진(2천만 화소 이하)을 선택해주세요.";
const acceptedTypes = new Set<string>(IMAGE_UPLOAD_CONTENT_TYPES);

type ImageSize = { width: number; height: number };
export type ImageDrawRegion = ImageSize & {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};
export type DecodedUploadImage = ImageSize & {
  source: CanvasImageSource;
  close: () => void;
};
/** A small boundary so browser encoding and its cleanup can also be tested without a DOM. */
export interface ImagePreparationAdapter {
  decode: (file: File) => Promise<DecodedUploadImage>;
  encode: (
    image: DecodedUploadImage,
    region: ImageDrawRegion,
    quality: number,
  ) => Promise<Blob | null>;
}
type PreparationOptions = {
  signal?: AbortSignal;
  adapter?: ImagePreparationAdapter | null;
};

function assertValidSize({ width, height }: ImageSize) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > IMAGE_MAX_INPUT_PIXELS
  )
    throw new Error(invalidImageMessage);
}

/** Read encoded headers before allocating decoded pixels. This is not server validation. */
export function imageHeaderSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    text(1, 7) === "PNG\r\n\x1a\n" &&
    text(12, 4) === "IHDR"
  )
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(text(0, 6)))
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes.length >= 12 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const chunk = text(offset, 4);
      const length = view.getUint32(offset + 4, true);
      const data = offset + 8;
      if (data + length > bytes.length) return null;
      if (chunk === "VP8X" && length >= 10) {
        const uint24 = (start: number) =>
          bytes[start]! + bytes[start + 1]! * 256 + bytes[start + 2]! * 65536;
        return { width: 1 + uint24(data + 4), height: 1 + uint24(data + 7) };
      }
      if (
        chunk === "VP8 " &&
        length >= 10 &&
        bytes[data + 3] === 0x9d &&
        bytes[data + 4] === 0x01 &&
        bytes[data + 5] === 0x2a
      )
        return {
          width: view.getUint16(data + 6, true) & 0x3fff,
          height: view.getUint16(data + 8, true) & 0x3fff,
        };
      if (chunk === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
        const packed = view.getUint32(data + 1, true);
        return { width: 1 + (packed & 0x3fff), height: 1 + ((packed >>> 14) & 0x3fff) };
      }
      offset = data + length + (length % 2);
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 3 < bytes.length;) {
      if (bytes[offset++] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if (length >= 7 && marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      offset += length;
    }
  }
  return null;
}

export function imageDrawRegion(
  size: ImageSize,
  kind: CompressedImageKind,
  dimension: number,
): ImageDrawRegion {
  assertValidSize(size);
  if (kind === "profile") {
    const side = Math.min(size.width, size.height);
    return {
      sourceX: (size.width - side) / 2,
      sourceY: (size.height - side) / 2,
      sourceWidth: side,
      sourceHeight: side,
      width: dimension,
      height: dimension,
    };
  }
  const scale = Math.min(1, dimension / Math.max(size.width, size.height));
  return {
    sourceX: 0,
    sourceY: 0,
    sourceWidth: size.width,
    sourceHeight: size.height,
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("사진 준비를 취소했어요.", "AbortError");
}

function abortable<T>(work: Promise<T>, signal?: AbortSignal, discard?: (value: T) => void) {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const abort = () => {
      aborted = true;
      signal.removeEventListener("abort", abort);
      reject(new DOMException("사진 준비를 취소했어요.", "AbortError"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (aborted) discard?.(value);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        if (!aborted) reject(error);
      },
    );
  });
}

function browserAdapter(): ImagePreparationAdapter | null {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return null;
  const probe = document.createElement("canvas");
  if (typeof probe.toBlob !== "function" || !probe.getContext("2d")) return null;
  return {
    async decode(file) {
      // Blob decoding takes the first animation frame and applies source EXIF orientation.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close(),
      };
    },
    async encode(image, region, quality) {
      const canvas = document.createElement("canvas");
      try {
        canvas.width = region.width;
        canvas.height = region.height;
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(
          image.source,
          region.sourceX,
          region.sourceY,
          region.sourceWidth,
          region.sourceHeight,
          0,
          0,
          region.width,
          region.height,
        );
        return await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/webp", quality),
        );
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
  };
}

async function prepareImage(
  file: File,
  kind: CompressedImageKind,
  { signal, adapter }: PreparationOptions,
): Promise<File> {
  throwIfAborted(signal);
  let header: ImageSize | null;
  try {
    header = imageHeaderSize(new Uint8Array(await abortable(file.arrayBuffer(), signal)));
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return file;
  }
  if (header) assertValidSize(header);
  let runtime: ImagePreparationAdapter | null;
  try {
    runtime = adapter === undefined ? browserAdapter() : adapter;
  } catch {
    return file;
  }
  if (!runtime) return file;
  // Let the pending UI paint before starting any decoded image work.
  await abortable(new Promise<void>((resolve) => setTimeout(resolve, 0)), signal);
  let image: DecodedUploadImage;
  try {
    // Native decoding cannot be interrupted. Keep the queue occupied until it finishes.
    image = await runtime.decode(file);
  } catch {
    throwIfAborted(signal);
    return file;
  }
  try {
    throwIfAborted(signal);
    assertValidSize(image);
    for (const step of IMAGE_COMPRESSION_POLICY[kind].steps) {
      throwIfAborted(signal);
      let blob: Blob | null;
      try {
        blob = await runtime.encode(
          image,
          imageDrawRegion(image, kind, step.dimension),
          step.quality / 100,
        );
      } catch {
        throwIfAborted(signal);
        return file;
      }
      throwIfAborted(signal);
      // Some browsers silently encode PNG when WebP encoding is unsupported.
      if (!blob || blob.type !== "image/webp") return file;
      if (
        blob.size > 0 &&
        blob.size <= IMAGE_COMPRESSION_POLICY[kind].maxOutputBytes &&
        blob.size < file.size
      )
        return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.webp`, {
          type: "image/webp",
          lastModified: file.lastModified,
        });
      await abortable(new Promise<void>((resolve) => setTimeout(resolve, 0)), signal);
    }
    return file;
  } finally {
    image.close();
  }
}

// One decoded source at a time, including when several upload surfaces are open.
let preparationQueue: Promise<void> = Promise.resolve();
/** Browser optimization only. The server still validates and strips source metadata. */
export function prepareImageForUpload(
  file: File,
  kind: CompressedImageKind,
  options: PreparationOptions = {},
): Promise<File> {
  const policy = IMAGE_COMPRESSION_POLICY[kind];
  if (!file.size || file.size > policy.maxInputBytes)
    return Promise.reject(
      new Error(
        kind === "post"
          ? "10MB 이하의 JPG·PNG·WebP·GIF 사진을 선택해주세요."
          : "5MB 이하의 JPG·PNG·WebP·GIF 사진을 선택해주세요.",
      ),
    );
  if (file.type && !acceptedTypes.has(file.type))
    return Promise.reject(new Error(invalidImageMessage));
  const work = preparationQueue.then(() => prepareImage(file, kind, options));
  preparationQueue = work.then(
    () => {},
    () => {},
  );
  return abortable(work, options.signal);
}
