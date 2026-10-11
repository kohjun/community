CREATE TABLE "sliper"."analytics_activity_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "analytics_activity_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "sliper"."analytics_activity_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."analytics_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleaned_day" date,
	CONSTRAINT "analytics_singleton" CHECK ("sliper"."analytics_state"."id"=1)
);
--> statement-breakpoint
ALTER TABLE "sliper"."analytics_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "analytics_excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."analytics_activity_days" ADD CONSTRAINT "analytics_activity_days_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_day_idx" ON "sliper"."analytics_activity_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "post_likes_period_idx" ON "sliper"."post_likes" USING btree ("post_id","created_at","user_id");
--> statement-breakpoint
INSERT INTO sliper.analytics_state (id) VALUES (1) ON CONFLICT DO NOTHING;
