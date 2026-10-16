import { sql } from "drizzle-orm";
import { boolean, check, integer, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { eventSettings, profiles, sliper } from "./schema";
import type { EventContactChannel } from "../domain/event-contact";

// This server-only table must never be joined into public event projections.
export const eventPrivateContacts = sliper
  .table(
    "event_private_contacts",
    {
      postId: uuid("post_id")
        .primaryKey()
        .references(() => eventSettings.postId, { onDelete: "cascade" }),
      enabled: boolean("enabled").notNull().default(false),
      channel: varchar("channel", { length: 8 }).$type<EventContactChannel>(),
      value: varchar("value", { length: 2048 }),
      note: varchar("note", { length: 300 }),
      revision: integer("revision").notNull().default(1),
      updatedBy: uuid("updated_by").references(() => profiles.id, { onDelete: "set null" }),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check("event_contact_revision", sql`${t.revision}>0`),
      check(
        "event_contact_state",
        sql`(${t.enabled} and ${t.channel} is not null and ${t.value} is not null and ${t.note} is not null) or (not ${t.enabled} and ${t.channel} is null and ${t.value} is null and ${t.note} is null)`,
      ),
      check(
        "event_contact_channel",
        sql`${t.channel} is null or ${t.channel} in ('phone','email','link')`,
      ),
      check(
        "event_contact_value",
        sql`${t.value} is null or (char_length(btrim(${t.value})) between 1 and 2048 and ${t.value} !~ '[[:cntrl:]]')`,
      ),
      check(
        "event_contact_format",
        sql`${t.channel} is null or (${t.channel}='phone' and ${t.value} ~ '^([+][1-9][0-9]{7,14}|0[1-9][0-9]{7,9})$') or (${t.channel}='email' and ${t.value} like '%@%' and ${t.value} !~ '[[:space:]]') or (${t.channel}='link' and ${t.value} ~ '^https://' and ${t.value} !~ '[[:space:]]')`,
      ),
    ],
  )
  .enableRLS();
