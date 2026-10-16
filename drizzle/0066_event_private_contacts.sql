CREATE TABLE "sliper"."event_private_contacts" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"channel" varchar(8),
	"value" varchar(2048),
	"note" varchar(300),
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_contact_revision" CHECK ("sliper"."event_private_contacts"."revision">0),
	CONSTRAINT "event_contact_state" CHECK (("sliper"."event_private_contacts"."enabled" and "sliper"."event_private_contacts"."channel" is not null and "sliper"."event_private_contacts"."value" is not null and "sliper"."event_private_contacts"."note" is not null) or (not "sliper"."event_private_contacts"."enabled" and "sliper"."event_private_contacts"."channel" is null and "sliper"."event_private_contacts"."value" is null and "sliper"."event_private_contacts"."note" is null)),
	CONSTRAINT "event_contact_channel" CHECK ("sliper"."event_private_contacts"."channel" is null or "sliper"."event_private_contacts"."channel" in ('phone','email','link')),
	CONSTRAINT "event_contact_value" CHECK ("sliper"."event_private_contacts"."value" is null or (char_length(btrim("sliper"."event_private_contacts"."value")) between 1 and 2048 and "sliper"."event_private_contacts"."value" !~ '[[:cntrl:]]')),
	CONSTRAINT "event_contact_format" CHECK ("sliper"."event_private_contacts"."channel" is null or ("sliper"."event_private_contacts"."channel"='phone' and "sliper"."event_private_contacts"."value" ~ '^([+][1-9][0-9]{7,14}|0[1-9][0-9]{7,9})$') or ("sliper"."event_private_contacts"."channel"='email' and "sliper"."event_private_contacts"."value" like '%@%' and "sliper"."event_private_contacts"."value" !~ '[[:space:]]') or ("sliper"."event_private_contacts"."channel"='link' and "sliper"."event_private_contacts"."value" ~ '^https://' and "sliper"."event_private_contacts"."value" !~ '[[:space:]]'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_private_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."event_private_contacts" ADD CONSTRAINT "event_private_contacts_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_private_contacts" ADD CONSTRAINT "event_private_contacts_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.event_private_contacts FROM PUBLIC, anon, authenticated;

--> statement-breakpoint
-- Remove the historical trigger-function default grant without rewriting migration 0057.
REVOKE ALL ON FUNCTION sliper.guard_question_answer() FROM PUBLIC, anon, authenticated;
