CREATE TABLE "sliper"."event_records" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"snapshot" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"purpose" varchar(2000) DEFAULT '' NOT NULL,
	"execution" varchar(2000) DEFAULT '' NOT NULL,
	"highlights" varchar(2000) DEFAULT '' NOT NULL,
	"improvements" varchar(2000) DEFAULT '' NOT NULL,
	"body_document" jsonb,
	"body_markdown" text DEFAULT '' NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_status" CHECK ("sliper"."event_records"."status" in ('draft','published','withdrawn')),
	CONSTRAINT "record_document_size" CHECK ("sliper"."event_records"."body_document" is null or octet_length("sliper"."event_records"."body_document"::text)<=204800)
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(24) NOT NULL,
	"note" varchar(500) DEFAULT '' NOT NULL,
	"confirmed_by" uuid,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp with time zone,
	"correction_note" varchar(500) DEFAULT '' NOT NULL,
	"legacy_contribution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_credit_role_once" UNIQUE("post_id","user_id","role"),
	CONSTRAINT "event_credit_no_self" CHECK ("sliper"."event_credits"."confirmed_by" is null or "sliper"."event_credits"."confirmed_by"<>"sliper"."event_credits"."user_id"),
	CONSTRAINT "event_credit_role" CHECK ("sliper"."event_credits"."role" in ('기획자','MC','진행 스태프','촬영·편집','디자인','공간·장비')),
	CONSTRAINT "event_credit_status" CHECK ("sliper"."event_credits"."status" in ('pending','accepted','rejected','withdrawn','correction_requested')),
	CONSTRAINT "event_credit_acceptance" CHECK (("sliper"."event_credits"."status"='accepted')=("sliper"."event_credits"."accepted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_credits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_record_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_post_id" uuid NOT NULL,
	"related_post_id" uuid,
	"library_entry_id" uuid,
	CONSTRAINT "record_link_post_once" UNIQUE("record_post_id","related_post_id"),
	CONSTRAINT "record_link_library_once" UNIQUE("record_post_id","library_entry_id"),
	CONSTRAINT "record_link_one_target" CHECK (num_nonnulls("sliper"."event_record_links"."related_post_id","sliper"."event_record_links"."library_entry_id")=1)
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_record_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_result_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"recorder_id" uuid,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"reason" text NOT NULL,
	"legacy" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_result_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."portfolio_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"visible" boolean DEFAULT false NOT NULL,
	"featured_event_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_featured_limit" CHECK (cardinality("sliper"."portfolio_preferences"."featured_event_ids")<=3)
);
--> statement-breakpoint
ALTER TABLE "sliper"."portfolio_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."video_assets" DROP CONSTRAINT "video_assets_attachment_ready";--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD COLUMN "completed_by" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD COLUMN "record_post_id" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."video_assets" ADD COLUMN "record_post_id" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."event_records" ADD CONSTRAINT "event_records_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_records" ADD CONSTRAINT "event_records_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_credits" ADD CONSTRAINT "event_credits_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_credits" ADD CONSTRAINT "event_credits_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_credits" ADD CONSTRAINT "event_credits_confirmed_by_profiles_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_record_links" ADD CONSTRAINT "event_record_links_record_post_id_event_records_post_id_fk" FOREIGN KEY ("record_post_id") REFERENCES "sliper"."event_records"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_record_links" ADD CONSTRAINT "event_record_links_related_post_id_posts_id_fk" FOREIGN KEY ("related_post_id") REFERENCES "sliper"."posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_record_links" ADD CONSTRAINT "event_record_links_library_entry_id_library_entries_id_fk" FOREIGN KEY ("library_entry_id") REFERENCES "sliper"."library_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_result_revisions" ADD CONSTRAINT "event_result_revisions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_result_revisions" ADD CONSTRAINT "event_result_revisions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_result_revisions" ADD CONSTRAINT "event_result_revisions_recorder_id_profiles_id_fk" FOREIGN KEY ("recorder_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."portfolio_preferences" ADD CONSTRAINT "portfolio_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_feed_idx" ON "sliper"."event_records" USING btree ("status","completed_at" DESC NULLS LAST,"post_id");--> statement-breakpoint
CREATE INDEX "record_owner_idx" ON "sliper"."event_records" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "event_credit_member_idx" ON "sliper"."event_credits" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "result_revision_identity_idx" ON "sliper"."event_result_revisions" USING btree ("post_id","user_id","created_at");--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD CONSTRAINT "event_settings_completed_by_profiles_id_fk" FOREIGN KEY ("completed_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD CONSTRAINT "media_assets_record_post_id_event_records_post_id_fk" FOREIGN KEY ("record_post_id") REFERENCES "sliper"."event_records"("post_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."video_assets" ADD CONSTRAINT "video_assets_record_post_id_event_records_post_id_fk" FOREIGN KEY ("record_post_id") REFERENCES "sliper"."event_records"("post_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD CONSTRAINT "media_assets_record_order_unique" UNIQUE("record_post_id","sort_order");--> statement-breakpoint
ALTER TABLE "sliper"."video_assets" ADD CONSTRAINT "video_assets_record_order_unique" UNIQUE("record_post_id","sort_order");--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD CONSTRAINT "media_single_parent" CHECK (num_nonnulls("sliper"."media_assets"."post_id", "sliper"."media_assets"."record_post_id") <= 1);--> statement-breakpoint
ALTER TABLE "sliper"."video_assets" ADD CONSTRAINT "video_single_parent" CHECK (num_nonnulls("sliper"."video_assets"."post_id", "sliper"."video_assets"."record_post_id") <= 1);--> statement-breakpoint
ALTER TABLE "sliper"."video_assets" ADD CONSTRAINT "video_assets_attachment_ready" CHECK (("sliper"."video_assets"."post_id" is null and "sliper"."video_assets"."record_post_id" is null) or "sliper"."video_assets"."status" = 'ready');