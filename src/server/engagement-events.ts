import type { Database } from "../db/connection";
import { inboxItems } from "../db/engagement-schema";
export type EngagementConnection = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function insertInbox(
  connection: EngagementConnection,
  input: typeof inboxItems.$inferInsert,
) {
  return connection
    .insert(inboxItems)
    .values(input)
    .onConflictDoNothing({ target: [inboxItems.recipientId, inboxItems.dedupeKey] })
    .returning({ id: inboxItems.id });
}
