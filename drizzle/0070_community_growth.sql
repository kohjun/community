CREATE TABLE "sliper"."event_ideas" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"region" varchar(60) NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"source_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_dates" CHECK ("sliper"."event_ideas"."date_to">="sliper"."event_ideas"."date_from")
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_ideas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" text NOT NULL,
	"next_wish" varchar(500) DEFAULT '' NOT NULL,
	"visibility" varchar(16) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reflection_event_member" UNIQUE("post_id","user_id"),
	CONSTRAINT "reflection_photos" CHECK (jsonb_typeof("sliper"."event_reflections"."photos")='array' and jsonb_array_length("sliper"."event_reflections"."photos")<=6),
	CONSTRAINT "reflection_visibility" CHECK ("sliper"."event_reflections"."visibility" in ('participants','members')),
	CONSTRAINT "reflection_body" CHECK (char_length("sliper"."event_reflections"."body") between 1 and 2000 and "sliper"."event_reflections"."version">0)
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_reflections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state" varchar(16) DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"offer_until" timestamp with time zone,
	CONSTRAINT "waitlist_event_member" UNIQUE("post_id","user_id"),
	CONSTRAINT "waitlist_state" CHECK ("sliper"."event_waitlist"."state" in ('waiting','offered','submitted','expired','cancelled')),
	CONSTRAINT "waitlist_offer" CHECK ("sliper"."event_waitlist"."state"<>'offered' or "sliper"."event_waitlist"."offer_until" is not null)
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_waitlist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."idea_events" (
	"idea_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_events_idea_id_event_id_pk" PRIMARY KEY("idea_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."idea_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."idea_interests" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_interests_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."idea_interests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_scan_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_delivered_at" timestamp with time zone,
	CONSTRAINT "saved_search_shape" CHECK (jsonb_typeof("sliper"."saved_searches"."settings")='object' and octet_length("sliper"."saved_searches"."settings"::text)<=4096)
);
--> statement-breakpoint
ALTER TABLE "sliper"."saved_searches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "sliper"."media_unattached_retention_idx";--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD COLUMN "reunion_origin_post_id" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."event_ideas" ADD CONSTRAINT "event_ideas_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_ideas" ADD CONSTRAINT "event_ideas_source_event_id_posts_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "sliper"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_reflections" ADD CONSTRAINT "event_reflections_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_reflections" ADD CONSTRAINT "event_reflections_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_waitlist" ADD CONSTRAINT "event_waitlist_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_waitlist" ADD CONSTRAINT "event_waitlist_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."idea_events" ADD CONSTRAINT "idea_events_idea_id_event_ideas_post_id_fk" FOREIGN KEY ("idea_id") REFERENCES "sliper"."event_ideas"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."idea_events" ADD CONSTRAINT "idea_events_event_id_posts_id_fk" FOREIGN KEY ("event_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."idea_interests" ADD CONSTRAINT "idea_interests_post_id_event_ideas_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_ideas"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."idea_interests" ADD CONSTRAINT "idea_interests_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."saved_searches" ADD CONSTRAINT "saved_searches_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ideas_recent_idx" ON "sliper"."event_ideas" USING btree ("created_at" DESC NULLS LAST,"post_id");--> statement-breakpoint
CREATE INDEX "ideas_source_idx" ON "sliper"."event_ideas" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "reflection_event_page_idx" ON "sliper"."event_reflections" USING btree ("post_id","created_at","id");--> statement-breakpoint
CREATE INDEX "waitlist_queue_idx" ON "sliper"."event_waitlist" USING btree ("post_id","state","created_at","id");--> statement-breakpoint
CREATE INDEX "waitlist_member_idx" ON "sliper"."event_waitlist" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idea_event_reverse_idx" ON "sliper"."idea_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idea_interest_member_idx" ON "sliper"."idea_interests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_search_owner_idx" ON "sliper"."saved_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_search_scan_idx" ON "sliper"."saved_searches" USING btree ("next_scan_at","id");--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD CONSTRAINT "media_assets_reunion_origin_post_id_posts_id_fk" FOREIGN KEY ("reunion_origin_post_id") REFERENCES "sliper"."posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_unattached_retention_idx" ON "sliper"."media_assets" USING btree ("unattached_since","id") WHERE "sliper"."media_assets"."post_id" is null and "sliper"."media_assets"."record_post_id" is null and "sliper"."media_assets"."record_origin_post_id" is null and "sliper"."media_assets"."reunion_origin_post_id" is null;--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD CONSTRAINT "media_reunion_parent" CHECK ("sliper"."media_assets"."reunion_origin_post_id" is null or ("sliper"."media_assets"."post_id" is null and "sliper"."media_assets"."record_post_id" is null and "sliper"."media_assets"."record_origin_post_id" is null));