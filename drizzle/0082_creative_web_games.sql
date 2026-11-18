CREATE TABLE "sliper"."game_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid,
	"uploader_hash" varchar(64) NOT NULL,
	"phase_id" uuid,
	"kind" varchar(12) NOT NULL,
	"status" varchar(12) NOT NULL,
	"storage_backend" varchar(12) NOT NULL,
	"object_key" varchar(48) NOT NULL,
	"source_key" varchar(48),
	"content_type" varchar(40) NOT NULL,
	"byte_size" integer NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lock_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_assets_kind" CHECK ("sliper"."game_assets"."kind" in ('drawing','photo','audio','video')),
	CONSTRAINT "game_assets_status" CHECK ("sliper"."game_assets"."status" in ('ready','queued','processing','failed')),
	CONSTRAINT "game_assets_backend" CHECK ("sliper"."game_assets"."storage_backend" in ('local','supabase')),
	CONSTRAINT "game_assets_size" CHECK ("sliper"."game_assets"."byte_size">0 and "sliper"."game_assets"."byte_size"<=26214400 and "sliper"."game_assets"."attempts">=0),
	CONSTRAINT "game_assets_owner" CHECK ("sliper"."game_assets"."uploader_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "sliper"."game_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."game_rooms" ADD COLUMN "drawing" jsonb;--> statement-breakpoint
ALTER TABLE "sliper"."game_rooms" ADD COLUMN "clue" jsonb;--> statement-breakpoint
ALTER TABLE "sliper"."game_assets" ADD CONSTRAINT "game_assets_room_id_game_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "sliper"."game_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_assets_room_owner" ON "sliper"."game_assets" USING btree ("room_id","uploader_hash");--> statement-breakpoint
CREATE INDEX "game_assets_cleanup" ON "sliper"."game_assets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "game_assets_jobs" ON "sliper"."game_assets" USING btree ("status","created_at");
--> statement-breakpoint
REVOKE ALL ON TABLE "sliper"."game_assets" FROM anon, authenticated;
