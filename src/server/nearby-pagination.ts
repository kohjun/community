import { z } from "zod";
import { uuidSchema } from "../domain/validation";
import { AppError } from "./errors";
import { cursorSchema } from "./pagination";

const nearbyPositionSchema = z.strictObject({
  v: z.literal(2),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.iso.datetime({ precision: 6 }),
  id: uuidSchema,
  distanceKm: z.number().finite().min(0).max(20020),
});
export function encodeNearbyCursor(
  scope: string,
  row: { createdAt: string; id: string; distanceKm?: number | null },
) {
  const position = nearbyPositionSchema.parse({
    v: 2,
    scope,
    at: row.createdAt,
    id: row.id,
    distanceKm: row.distanceKm,
  });
  return Buffer.from(JSON.stringify(position)).toString("base64url");
}
export function decodeNearbyCursor(value: string | undefined, scope: string) {
  if (!value) return null;
  try {
    const position = nearbyPositionSchema.parse(
      JSON.parse(Buffer.from(cursorSchema.parse(value), "base64url").toString("utf8")),
    );
    if (position.scope !== scope) throw new Error("Cursor scope mismatch");
    return position;
  } catch {
    throw new AppError(
      "VALIDATION",
      "거리순 목록 위치가 올바르지 않아요. 처음부터 다시 불러와주세요.",
    );
  }
}
