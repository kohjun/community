import { sql } from "drizzle-orm";
import { check, date, index, integer, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { profiles, sliper } from "./schema";
export const analyticsState = sliper
  .table(
    "analytics_state",
    {
      id: integer("id").primaryKey().default(1),
      startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
      cleanedDay: date("cleaned_day"),
    },
    (t) => [check("analytics_singleton", sql`${t.id}=1`)],
  )
  .enableRLS();
export const analyticsActivityDays = sliper
  .table(
    "analytics_activity_days",
    {
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.id, { onDelete: "cascade" }),
      day: date("day").notNull(),
    },
    (t) => [primaryKey({ columns: [t.userId, t.day] }), index("analytics_day_idx").on(t.day)],
  )
  .enableRLS();
