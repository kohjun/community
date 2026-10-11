import { sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { requestLimits } from "../db/safety-schema";
import { AppError } from "./errors";
// A single atomic upsert prevents parallel requests and multiple server processes bypassing limits.
export async function enforceRequestLimit(
  db: Database,
  userId: string,
  action: string,
  limit: number,
  seconds = 3600,
) {
  const window = new Date(Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000);
  const rows = await db
    .insert(requestLimits)
    .values({ userId, action, windowStartedAt: window, count: 1 })
    .onConflictDoUpdate({
      target: [requestLimits.userId, requestLimits.action],
      set: {
        windowStartedAt: window,
        count: sql`case when ${requestLimits.windowStartedAt}=${window.toISOString()}::timestamptz then ${requestLimits.count}+1 else 1 end`,
      },
      setWhere: sql`${requestLimits.windowStartedAt}<>${window.toISOString()}::timestamptz or ${requestLimits.count}<${limit}`,
    })
    .returning({ count: requestLimits.count });
  if (!rows.length)
    throw new AppError("RATE_LIMITED", "요청이 많아요. 잠시 쉬었다가 다시 시도해주세요.");
}
