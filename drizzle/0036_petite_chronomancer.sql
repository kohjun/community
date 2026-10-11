ALTER TABLE "sliper"."content_restrictions" DROP CONSTRAINT "restriction_target_type";--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" DROP CONSTRAINT "report_target_type";--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD COLUMN "storage_backend" varchar(16) DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."profile_photos" ADD COLUMN "storage_backend" varchar(16) DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."event_results" ADD CONSTRAINT "player_event_result_application_identity" UNIQUE("application_id","post_id","user_id");--> statement-breakpoint
ALTER TABLE "sliper"."crew_contributions" ADD CONSTRAINT "crew_contribution_result_identity_fk" FOREIGN KEY ("application_id","post_id","user_id") REFERENCES "sliper"."event_results"("application_id","post_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_contributions" ADD CONSTRAINT "crew_contribution_admission_identity_fk" FOREIGN KEY ("application_id","post_id","user_id") REFERENCES "sliper"."event_admissions"("application_id","post_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD CONSTRAINT "media_assets_storage_backend" CHECK ("sliper"."media_assets"."storage_backend" in ('local','supabase'));--> statement-breakpoint
ALTER TABLE "sliper"."profile_photos" ADD CONSTRAINT "profile_photo_storage_backend" CHECK ("sliper"."profile_photos"."storage_backend" in ('local','supabase'));--> statement-breakpoint
ALTER TABLE "sliper"."content_restrictions" ADD CONSTRAINT "restriction_target_type" CHECK ("sliper"."content_restrictions"."target_type" in ('post','comment','venue','crew'));--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ADD CONSTRAINT "report_target_type" CHECK ("sliper"."safety_reports"."target_type" in ('post','comment','venue','crew','player','crew'));--> statement-breakpoint
ALTER TABLE "sliper"."crew_contributions" ADD CONSTRAINT "crew_contribution_no_self" CHECK ("sliper"."crew_contributions"."checked_by" is null or "sliper"."crew_contributions"."checked_by"<>"sliper"."crew_contributions"."user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_media_ownership() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.uploader_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in uploader is required' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.object_key IS DISTINCT FROM OLD.object_key OR NEW.storage_backend IS DISTINCT FROM OLD.storage_backend THEN
      RAISE EXCEPTION 'Media identity cannot change' USING ERRCODE = '23514';
    END IF;
    IF NEW.uploader_id IS DISTINCT FROM OLD.uploader_id AND NEW.uploader_id IS NOT NULL THEN
      RAISE EXCEPTION 'Media ownership cannot be reassigned' USING ERRCODE = '23514';
    END IF;
    IF NEW.uploader_id IS NULL AND NEW.post_id IS DISTINCT FROM OLD.post_id THEN
      RAISE EXCEPTION 'Orphaned media cannot be attached to another post' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Null ownership is permitted after profile deletion (ON DELETE SET NULL).
  IF NEW.post_id IS NOT NULL AND NEW.uploader_id IS NOT NULL THEN
    PERFORM 1 FROM sliper.posts WHERE id = NEW.post_id AND author_id = NEW.uploader_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Media must belong to the post author' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_media_ownership() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.crews, sliper.crew_members, sliper.crew_join_requests, sliper.crew_activity, sliper.crew_events, sliper.crew_contributions FROM PUBLIC, anon, authenticated;
