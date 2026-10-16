CREATE TABLE "sliper"."media_retention_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_kind" varchar(8) NOT NULL,
	"asset_id" uuid NOT NULL,
	"object_key" varchar(64) NOT NULL,
	"storage_backend" varchar(16) NOT NULL,
	"policy_version" varchar(24) DEFAULT 'unattached-v1' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"lock_token" uuid,
	"error_code" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "retention_asset_once" UNIQUE("asset_kind","asset_id"),
	CONSTRAINT "retention_asset_kind" CHECK ("sliper"."media_retention_jobs"."asset_kind" in ('image','video')),
	CONSTRAINT "retention_storage" CHECK ("sliper"."media_retention_jobs"."storage_backend" in ('local','supabase')),
	CONSTRAINT "retention_object" CHECK (("sliper"."media_retention_jobs"."asset_kind"='video' and "sliper"."media_retention_jobs"."object_key"="sliper"."media_retention_jobs"."asset_id"::text||'.mp4') or ("sliper"."media_retention_jobs"."asset_kind"='image' and "sliper"."media_retention_jobs"."object_key" ~ ('^'||"sliper"."media_retention_jobs"."asset_id"::text||'[.](jpg|jpeg|png|webp|gif)$'))),
	CONSTRAINT "retention_policy" CHECK ("sliper"."media_retention_jobs"."policy_version"='unattached-v1'),
	CONSTRAINT "retention_attempts" CHECK ("sliper"."media_retention_jobs"."attempts" between 0 and 100),
	CONSTRAINT "retention_status" CHECK ("sliper"."media_retention_jobs"."status" in ('pending','processing','failed','removed')),
	CONSTRAINT "retention_lease" CHECK (("sliper"."media_retention_jobs"."status"='processing')=("sliper"."media_retention_jobs"."lease_until" is not null and "sliper"."media_retention_jobs"."lock_token" is not null) and ("sliper"."media_retention_jobs"."status"='processing' or ("sliper"."media_retention_jobs"."lease_until" is null and "sliper"."media_retention_jobs"."lock_token" is null))),
	CONSTRAINT "retention_completed" CHECK (("sliper"."media_retention_jobs"."status"='removed')=("sliper"."media_retention_jobs"."removed_at" is not null)),
	CONSTRAINT "retention_error" CHECK ("sliper"."media_retention_jobs"."error_code" is null or "sliper"."media_retention_jobs"."error_code" in ('STORAGE_DELETE_FAILED','SOURCE_NOT_ELIGIBLE'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."media_retention_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD COLUMN "unattached_since" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "sliper"."video_assets" ADD COLUMN "unattached_since" timestamp with time zone DEFAULT now();--> statement-breakpoint
CREATE INDEX "retention_pending_idx" ON "sliper"."media_retention_jobs" USING btree ("status","available_at","id");--> statement-breakpoint
CREATE INDEX "media_unattached_retention_idx" ON "sliper"."media_assets" USING btree ("unattached_since","id") WHERE "sliper"."media_assets"."post_id" is null and "sliper"."media_assets"."record_post_id" is null and "sliper"."media_assets"."record_origin_post_id" is null;--> statement-breakpoint
CREATE INDEX "video_unattached_retention_idx" ON "sliper"."video_assets" USING btree ("unattached_since","id") WHERE "sliper"."video_assets"."post_id" is null and "sliper"."video_assets"."record_post_id" is null and "sliper"."video_assets"."record_origin_post_id" is null;