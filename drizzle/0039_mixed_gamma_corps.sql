CREATE TYPE "sliper"."video_job_status" AS ENUM('queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "sliper"."video_processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploader_id" uuid NOT NULL,
	"source_object_key" varchar(40) NOT NULL,
	"source_storage_backend" varchar(16) NOT NULL,
	"source_byte_size" integer NOT NULL,
	"source_ready" boolean DEFAULT false NOT NULL,
	"source_removed_at" timestamp with time zone,
	"source_cleanup_at" timestamp with time zone DEFAULT now() NOT NULL,
	"upload_expires_at" timestamp with time zone DEFAULT now()+interval '15 minutes' NOT NULL,
	"source_expires_at" timestamp with time zone DEFAULT now()+interval '24 hours' NOT NULL,
	"status" "sliper"."video_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"lock_token" uuid,
	"result_asset_id" uuid,
	"last_error_code" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_processing_jobs_source_object_key_unique" UNIQUE("source_object_key"),
	CONSTRAINT "video_processing_jobs_result_unique" UNIQUE("result_asset_id"),
	CONSTRAINT "video_processing_jobs_source_key" CHECK ("sliper"."video_processing_jobs"."source_object_key"="sliper"."video_processing_jobs"."id"::text||'.bin'),
	CONSTRAINT "video_processing_jobs_source_backend" CHECK ("sliper"."video_processing_jobs"."source_storage_backend" in ('local','supabase')),
	CONSTRAINT "video_processing_jobs_source_size" CHECK ("sliper"."video_processing_jobs"."source_byte_size" between 1 and 52428800),
	CONSTRAINT "video_processing_jobs_attempts" CHECK ("sliper"."video_processing_jobs"."attempts" between 0 and 3),
	CONSTRAINT "video_processing_jobs_lease" CHECK (("sliper"."video_processing_jobs"."status"='processing')=("sliper"."video_processing_jobs"."lock_token" is not null and "sliper"."video_processing_jobs"."lease_expires_at" is not null) and ("sliper"."video_processing_jobs"."status"='processing' or ("sliper"."video_processing_jobs"."lock_token" is null and "sliper"."video_processing_jobs"."lease_expires_at" is null))),
	CONSTRAINT "video_processing_jobs_result" CHECK (("sliper"."video_processing_jobs"."status"='ready')=("sliper"."video_processing_jobs"."result_asset_id" is not null)),
	CONSTRAINT "video_processing_jobs_ready_source" CHECK ("sliper"."video_processing_jobs"."status" not in ('processing','ready') or "sliper"."video_processing_jobs"."source_ready"),
	CONSTRAINT "video_processing_jobs_source_removed" CHECK ("sliper"."video_processing_jobs"."source_removed_at" is null or "sliper"."video_processing_jobs"."status" in ('ready','failed')),
	CONSTRAINT "video_processing_jobs_expiry" CHECK ("sliper"."video_processing_jobs"."upload_expires_at">"sliper"."video_processing_jobs"."created_at" and "sliper"."video_processing_jobs"."source_expires_at">="sliper"."video_processing_jobs"."upload_expires_at"),
	CONSTRAINT "video_processing_jobs_error" CHECK ("sliper"."video_processing_jobs"."last_error_code" is null or "sliper"."video_processing_jobs"."last_error_code" in ('UPLOAD_FAILED','INVALID_VIDEO','PROCESSING_FAILED','EXPIRED'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."video_processing_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."video_processing_outputs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"object_key" varchar(40) NOT NULL,
	"storage_backend" varchar(16) NOT NULL,
	"published_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"cleanup_at" timestamp with time zone DEFAULT now()+interval '1 hour' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_processing_outputs_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "video_processing_outputs_key" CHECK ("sliper"."video_processing_outputs"."object_key"="sliper"."video_processing_outputs"."id"::text||'.mp4'),
	CONSTRAINT "video_processing_outputs_backend" CHECK ("sliper"."video_processing_outputs"."storage_backend" in ('local','supabase')),
	CONSTRAINT "video_processing_outputs_published" CHECK ("sliper"."video_processing_outputs"."published_at" is null or ("sliper"."video_processing_outputs"."discarded_at" is null and "sliper"."video_processing_outputs"."removed_at" is null)),
	CONSTRAINT "video_processing_outputs_removed" CHECK ("sliper"."video_processing_outputs"."removed_at" is null or "sliper"."video_processing_outputs"."discarded_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "sliper"."video_processing_outputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."video_processing_jobs" ADD CONSTRAINT "video_processing_jobs_uploader_id_profiles_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "sliper"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."video_processing_outputs" ADD CONSTRAINT "video_processing_outputs_job_id_video_processing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "sliper"."video_processing_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_processing_jobs_queue_idx" ON "sliper"."video_processing_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "video_processing_jobs_uploader_idx" ON "sliper"."video_processing_jobs" USING btree ("uploader_id","status");--> statement-breakpoint
CREATE INDEX "video_processing_jobs_source_cleanup_idx" ON "sliper"."video_processing_jobs" USING btree ("source_removed_at","source_cleanup_at");--> statement-breakpoint
CREATE INDEX "video_processing_outputs_job_idx" ON "sliper"."video_processing_outputs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "video_processing_outputs_cleanup_idx" ON "sliper"."video_processing_outputs" USING btree ("published_at","removed_at","cleanup_at");
--> statement-breakpoint
CREATE FUNCTION sliper.guard_video_processing_job() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.uploader_id IS DISTINCT FROM OLD.uploader_id
      OR NEW.source_object_key IS DISTINCT FROM OLD.source_object_key
      OR NEW.source_storage_backend IS DISTINCT FROM OLD.source_storage_backend
      OR NEW.source_byte_size IS DISTINCT FROM OLD.source_byte_size OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Video job identity and source metadata cannot change' USING ERRCODE='23514';
    END IF;
    IF OLD.result_asset_id IS NOT NULL AND NEW.result_asset_id IS DISTINCT FROM OLD.result_asset_id THEN
      RAISE EXCEPTION 'Published video job result cannot change' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.result_asset_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.result_asset_id IS NULL) THEN
    PERFORM 1 FROM sliper.video_assets a
      JOIN sliper.video_processing_outputs o ON o.id=a.id
      WHERE a.id=NEW.result_asset_id AND a.uploader_id=NEW.uploader_id AND a.status='ready'
        AND o.job_id=NEW.id AND o.published_at IS NOT NULL AND o.discarded_at IS NULL
        AND a.object_key=o.object_key AND a.storage_backend=o.storage_backend;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Video result must be a ready derivative of this uploader job' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER video_processing_job_guard BEFORE INSERT OR UPDATE ON sliper.video_processing_jobs
FOR EACH ROW EXECUTE FUNCTION sliper.guard_video_processing_job();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_video_processing_output() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.job_id IS DISTINCT FROM OLD.job_id
      OR NEW.object_key IS DISTINCT FROM OLD.object_key OR NEW.storage_backend IS DISTINCT FROM OLD.storage_backend
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Video output identity cannot change' USING ERRCODE='23514';
    END IF;
    IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'Published video output cannot be unpublished' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER video_processing_output_guard BEFORE INSERT OR UPDATE ON sliper.video_processing_outputs
FOR EACH ROW EXECUTE FUNCTION sliper.guard_video_processing_output();
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_video_processing_job(), sliper.guard_video_processing_output() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.video_processing_jobs, sliper.video_processing_outputs FROM PUBLIC, anon, authenticated;
