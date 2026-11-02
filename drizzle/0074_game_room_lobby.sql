CREATE TABLE "sliper"."game_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"identity_hash" varchar(64) NOT NULL,
	"ticket" integer NOT NULL,
	"status" varchar(12) NOT NULL,
	"nickname" varchar(16),
	"ready" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_player_status" CHECK ("sliper"."game_players"."status" in ('waiting','admitted','left','kicked')),
	CONSTRAINT "game_player_ready" CHECK (not "sliper"."game_players"."ready" or ("sliper"."game_players"."status" = 'admitted' and "sliper"."game_players"."nickname" is not null)),
	CONSTRAINT "game_player_hash" CHECK ("sliper"."game_players"."identity_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "game_player_ticket_positive" CHECK ("sliper"."game_players"."ticket" > 0)
);
--> statement-breakpoint
ALTER TABLE "sliper"."game_players" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."game_request_limits" (
	"room_id" uuid NOT NULL,
	"subject_hash" varchar(64) NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "game_request_limits_room_id_subject_hash_pk" PRIMARY KEY("room_id","subject_hash"),
	CONSTRAINT "game_limit_count" CHECK ("sliper"."game_request_limits"."count" > 0)
);
--> statement-breakpoint
ALTER TABLE "sliper"."game_request_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."game_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"title" varchar(60) NOT NULL,
	"capacity" integer NOT NULL,
	"min_players" integer NOT NULL,
	"phase" varchar(12) DEFAULT 'lobby' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"next_ticket" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_room_bounds" CHECK ("sliper"."game_rooms"."capacity" between 2 and 30 and "sliper"."game_rooms"."min_players" between 2 and "sliper"."game_rooms"."capacity" and "sliper"."game_rooms"."revision" >= 0 and "sliper"."game_rooms"."round" > 0 and "sliper"."game_rooms"."next_ticket" > 0),
	CONSTRAINT "game_room_phase" CHECK ("sliper"."game_rooms"."phase" in ('lobby','playing','finished','closed')),
	CONSTRAINT "game_room_start" CHECK ("sliper"."game_rooms"."phase" not in ('playing','finished') or "sliper"."game_rooms"."started_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "sliper"."game_rooms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."game_players" ADD CONSTRAINT "game_players_room_id_game_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "sliper"."game_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."game_request_limits" ADD CONSTRAINT "game_request_limits_room_id_game_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "sliper"."game_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."game_rooms" ADD CONSTRAINT "game_rooms_host_id_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_player_identity" ON "sliper"."game_players" USING btree ("room_id","identity_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "game_player_ticket" ON "sliper"."game_players" USING btree ("room_id","ticket");--> statement-breakpoint
CREATE UNIQUE INDEX "game_player_nickname" ON "sliper"."game_players" USING btree ("room_id",lower("nickname")) WHERE "sliper"."game_players"."status" = 'admitted' and "sliper"."game_players"."nickname" is not null;--> statement-breakpoint
CREATE INDEX "game_player_queue" ON "sliper"."game_players" USING btree ("room_id","status","ticket");--> statement-breakpoint
CREATE INDEX "game_rooms_host_created" ON "sliper"."game_rooms" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "game_rooms_expiry" ON "sliper"."game_rooms" USING btree ("expires_at");
--> statement-breakpoint
REVOKE ALL ON TABLE "sliper"."game_rooms", "sliper"."game_players", "sliper"."game_request_limits" FROM PUBLIC, anon, authenticated;
