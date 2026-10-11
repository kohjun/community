CREATE TABLE "sliper"."video_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploader_id" uuid,
	"post_id" uuid,
	"object_key" varchar(40) NOT NULL,
	"storage_backend" varchar(16) DEFAULT 'local' NOT NULL,
	"content_type" varchar(32) DEFAULT 'video/mp4' NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_seconds" double precision NOT NULL,
	"status" "sliper"."upload_status" DEFAULT 'pending' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_assets_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "video_assets_post_order_unique" UNIQUE("post_id","sort_order"),
	CONSTRAINT "video_assets_object_key" CHECK ("sliper"."video_assets"."object_key" = "sliper"."video_assets"."id"::text || '.mp4'),
	CONSTRAINT "video_assets_storage_backend" CHECK ("sliper"."video_assets"."storage_backend" in ('local','supabase')),
	CONSTRAINT "video_assets_content_type" CHECK ("sliper"."video_assets"."content_type" = 'video/mp4'),
	CONSTRAINT "video_assets_size_range" CHECK ("sliper"."video_assets"."byte_size" between 1 and 26214400),
	CONSTRAINT "video_assets_dimensions" CHECK ("sliper"."video_assets"."width" between 1 and 1920 and "sliper"."video_assets"."height" between 1 and 1920),
	CONSTRAINT "video_assets_duration" CHECK ("sliper"."video_assets"."duration_seconds" > 0 and "sliper"."video_assets"."duration_seconds" <= 180),
	CONSTRAINT "video_assets_order_range" CHECK ("sliper"."video_assets"."sort_order" between 0 and 2),
	CONSTRAINT "video_assets_attachment_ready" CHECK ("sliper"."video_assets"."post_id" is null or "sliper"."video_assets"."status" = 'ready')
);
--> statement-breakpoint
ALTER TABLE "sliper"."video_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."video_assets" ADD CONSTRAINT "video_assets_uploader_id_profiles_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."video_assets" ADD CONSTRAINT "video_assets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_assets_uploader_idx" ON "sliper"."video_assets" USING btree ("uploader_id");
--> statement-breakpoint
CREATE FUNCTION sliper.guard_video_ownership() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.uploader_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in uploader is required' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.object_key IS DISTINCT FROM OLD.object_key OR NEW.storage_backend IS DISTINCT FROM OLD.storage_backend
      OR NEW.content_type IS DISTINCT FROM OLD.content_type OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
      OR NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds THEN
      RAISE EXCEPTION 'Video identity and derivative metadata cannot change' USING ERRCODE = '23514';
    END IF;
    IF NEW.uploader_id IS DISTINCT FROM OLD.uploader_id AND NEW.uploader_id IS NOT NULL THEN
      RAISE EXCEPTION 'Video ownership cannot be reassigned' USING ERRCODE = '23514';
    END IF;
    IF NEW.uploader_id IS NULL AND NEW.post_id IS DISTINCT FROM OLD.post_id THEN
      RAISE EXCEPTION 'Orphaned video cannot be attached to another post' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.post_id IS NOT NULL AND NEW.uploader_id IS NOT NULL THEN
    PERFORM 1 FROM sliper.posts WHERE id = NEW.post_id AND author_id = NEW.uploader_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Video must belong to the post author' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER video_assets_owner_guard BEFORE INSERT OR UPDATE ON sliper.video_assets
FOR EACH ROW EXECUTE FUNCTION sliper.guard_video_ownership();
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_video_ownership() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.video_assets FROM PUBLIC, anon, authenticated;
