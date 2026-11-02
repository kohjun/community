import { sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { analyticsService } from "./analytics-service";
export async function launchPreparation(db: Database, actor: string | null) {
  await analyticsService(db).allowedAdmin(actor);
  const rows = await db.execute(sql`select
    (select count(*)::int from sliper.staff_roles where role='admin') as administrators,
    (select count(*)::int from sliper.posts where status='published' and not sample) as stories,
    (select count(*)::int from sliper.posts where status='published' and sample) as samples,
    (select count(*)::int from sliper.event_settings e join sliper.posts p on p.id=e.post_id where p.status='published' and not p.sample and e.open and e.completed_at is null and e.starts_at>statement_timestamp()) as upcoming,
    (select count(*)::int from sliper.library_entries where status='published' and not sample) as materials`);
  return rows[0] as {
    administrators: number;
    stories: number;
    samples: number;
    upcoming: number;
    materials: number;
  };
}
