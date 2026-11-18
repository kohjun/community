CREATE TABLE "sliper"."crew_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" uuid NOT NULL,
	"author_id" uuid,
	"client_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "crew_messages_client_once" UNIQUE("crew_id","author_id","client_id"),
	CONSTRAINT "crew_messages_body" CHECK (("sliper"."crew_messages"."deleted_at" is null and char_length(btrim("sliper"."crew_messages"."body")) between 1 and 2000) or ("sliper"."crew_messages"."deleted_at" is not null and "sliper"."crew_messages"."body"=''))
);
--> statement-breakpoint
ALTER TABLE "sliper"."crew_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."crew_messages" ADD CONSTRAINT "crew_messages_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "sliper"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_messages" ADD CONSTRAINT "crew_messages_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crew_messages_history_idx" ON "sliper"."crew_messages" USING btree ("crew_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
REVOKE ALL ON TABLE "sliper"."crew_messages" FROM anon, authenticated;
