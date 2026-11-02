CREATE TABLE "sliper"."object_cleanup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" varchar(64) NOT NULL,
	"storage_backend" varchar(16) NOT NULL,
	"kind" varchar(12) NOT NULL,
	"reason" varchar(24) NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"lock_token" uuid,
	"error_code" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cleanup_object_once" UNIQUE("storage_backend","kind","object_key"),
	CONSTRAINT "cleanup_backend" CHECK ("sliper"."object_cleanup_jobs"."storage_backend" in ('local','supabase')),
	CONSTRAINT "cleanup_kind" CHECK ("sliper"."object_cleanup_jobs"."kind" in ('post','profile','video')),
	CONSTRAINT "cleanup_reason" CHECK ("sliper"."object_cleanup_jobs"."reason" in ('profile-replaced','profile-cleared','account-closed','upload-rollback')),
	CONSTRAINT "cleanup_status" CHECK ("sliper"."object_cleanup_jobs"."status" in ('pending','processing','failed')),
	CONSTRAINT "cleanup_attempts" CHECK ("sliper"."object_cleanup_jobs"."attempts" between 0 and 8),
	CONSTRAINT "cleanup_key" CHECK ("sliper"."object_cleanup_jobs"."object_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp|gif|mp4)$' and (("sliper"."object_cleanup_jobs"."kind"='video')=("sliper"."object_cleanup_jobs"."object_key" like '%.mp4'))),
	CONSTRAINT "cleanup_lease" CHECK (("sliper"."object_cleanup_jobs"."status"='processing')=("sliper"."object_cleanup_jobs"."lock_token" is not null and "sliper"."object_cleanup_jobs"."lease_until" is not null) and ("sliper"."object_cleanup_jobs"."status"='processing' or ("sliper"."object_cleanup_jobs"."lock_token" is null and "sliper"."object_cleanup_jobs"."lease_until" is null))),
	CONSTRAINT "cleanup_error" CHECK ("sliper"."object_cleanup_jobs"."error_code" is null or "sliper"."object_cleanup_jobs"."error_code"='STORAGE_DELETE_FAILED')
);
--> statement-breakpoint
ALTER TABLE "sliper"."object_cleanup_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "cleanup_ready_idx" ON "sliper"."object_cleanup_jobs" USING btree ("status","available_at","id");
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.object_cleanup_jobs FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sliper_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON sliper.object_cleanup_jobs TO sliper_app;
  END IF;
END $$;
