export type RgbColor = { r: number; g: number; b: number };
export type LabColor = { l: number; a: number; b: number };

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

export function normalizeHex(hex: string): string {
  const trimmed = hex.trim();
  if (!HEX_PATTERN.test(trimmed)) return "#000000";
  return trimmed.toUpperCase();
}

export function hexToRgb(hex: string): RgbColor {
  const clean = normalizeHex(hex).slice(1);
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  const clamp = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function srgbToLinear(channel: number): number {
  const v = Math.max(0, Math.min(255, channel)) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function labPivot(value: number): number {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

export function rgbToLab(rgb: RgbColor): LabColor {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  // D65 reference white
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1.0;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const fx = labPivot(x);
  const fy = labPivot(y);
  const fz = labPivot(z);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/**
 * Luminance-damped CIE Lab distance so dim pubs or warm cafe lighting
 * do not unfairly penalize accurate hue matches.
 */
export function perceptualColorDistance(target: RgbColor, sample: RgbColor): number {
  const a = rgbToLab(target);
  const b = rgbToLab(sample);
  const dl = (a.l - b.l) * 0.5;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.hypot(dl, da, db);
}

/** Returns an integer match score in 0..100 (higher is closer). */
export function computeColorMatchScore(targetHex: string, sampleHex: string): number {
  const dist = perceptualColorDistance(hexToRgb(targetHex), hexToRgb(sampleHex));
  // Distance 0 => 100, ~14 => ~85, ~40 => ~55, >=95 => 0
  const raw = Math.max(0, 100 - dist * 1.12);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Samples the center reticle of an RGBA pixel buffer using clipped averaging
 * to resist specular highlights and sensor noise.
 */
export function sampleCenterRgb(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radiusRatio = 0.14,
): { rgb: RgbColor; luma: number } {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return { rgb: { r: 128, g: 128, b: 128 }, luma: 128 };
  }
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const radius = Math.max(2, Math.floor(Math.min(width, height) * radiusRatio));
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(width - 1, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(height - 1, cy + radius);
  const stride = Math.max(1, Math.floor((radius * 2) / 18));
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let y = y0; y <= y1; y += stride) {
    for (let x = x0; x <= x1; x += stride) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const offset = (y * width + x) * 4;
      sumR += data[offset] ?? 0;
      sumG += data[offset + 1] ?? 0;
      sumB += data[offset + 2] ?? 0;
      count++;
    }
  }
  if (!count) return { rgb: { r: 128, g: 128, b: 128 }, luma: 128 };
  const rgb = {
    r: Math.round(sumR / count),
    g: Math.round(sumG / count),
    b: Math.round(sumB / count),
  };
  const luma = Math.round(0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b);
  return { rgb, luma };
}
