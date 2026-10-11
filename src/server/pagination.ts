import { createHash } from "node:crypto";
import { sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./errors";
import { uuidSchema } from "../domain/validation";

export const cursorSchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/);
export const pageQuerySchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const positionSchema = z.strictObject({
  v: z.literal(1),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.iso.datetime({ precision: 6 }),
  id: uuidSchema,
  score: z.number().int().nonnegative().optional(),
});
export type Position = z.infer<typeof positionSchema>;
export function pageScope(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export function encodeCursor(
  scope: string,
  row: { createdAt: string; id: string },
  score?: number,
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      scope,
      at: row.createdAt,
      id: row.id,
      ...(score === undefined ? {} : { score }),
    }),
  ).toString("base64url");
}
export function decodeCursor(value: string | undefined, scope: string): Position | null {
  if (!value) return null;
  try {
    const parsed = positionSchema.parse(
      JSON.parse(Buffer.from(cursorSchema.parse(value), "base64url").toString("utf8")),
    );
    if (parsed.scope !== scope) throw new Error("Cursor scope mismatch");
    return parsed;
  } catch {
    throw new AppError("VALIDATION", "목록 위치가 올바르지 않아요. 처음부터 다시 불러와주세요.");
  }
}
// Preserve PostgreSQL microseconds. JS Date truncation can skip rows at page boundaries.
export function preciseTimestamp(column: SQLWrapper) {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
export function afterPosition(
  time: SQLWrapper,
  id: SQLWrapper,
  cursor: Position,
  direction: "asc" | "desc",
) {
  return direction === "asc"
    ? sql`(${time}, ${id}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
    : sql`(${time}, ${id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
}
