CREATE TABLE "sliper"."game_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid,
	"host_id" uuid,
	"title" varchar(60) NOT NULL,
	"members" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sliper"."game_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."game_assets" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."game_runs" ADD CONSTRAINT "game_runs_room_id_game_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "sliper"."game_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."game_runs" ADD CONSTRAINT "game_runs_host_id_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_runs_expiry" ON "sliper"."game_runs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "game_runs_room" ON "sliper"."game_runs" USING btree ("room_id","ended_at");
--> statement-breakpoint
REVOKE ALL ON TABLE "sliper"."game_runs" FROM anon, authenticated;
