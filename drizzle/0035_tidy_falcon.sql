CREATE TABLE "sliper"."crew_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" varchar(32) NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crew_activity_kind" CHECK ("sliper"."crew_activity"."kind" in ('created','joined','left','removed','role_changed','ownership_transferred','updated','announcement','event_linked','event_unlinked','contribution','archived')),
	CONSTRAINT "crew_activity_message" CHECK (char_length("sliper"."crew_activity"."message") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "sliper"."crew_activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."crew_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"role" varchar(24) NOT NULL,
	"note" varchar(500) DEFAULT '' NOT NULL,
	"checked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crew_contributions_once" UNIQUE("crew_id","post_id","user_id"),
	CONSTRAINT "crew_contributions_role" CHECK ("sliper"."crew_contributions"."role" in ('MC','진행 스태프','기획 파트너','촬영·편집','디자인','공간·장비'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."crew_contributions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."crew_events" (
	"crew_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"linked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crew_events_crew_id_post_id_pk" PRIMARY KEY("crew_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."crew_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."crew_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message" varchar(500) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"decision_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crew_join_request_user" UNIQUE("crew_id","user_id"),
	CONSTRAINT "crew_join_request_status" CHECK ("sliper"."crew_join_requests"."status" in ('pending','approved','rejected','withdrawn')),
	CONSTRAINT "crew_join_message" CHECK (char_length(btrim("sliper"."crew_join_requests"."message")) between 2 and 500)
);
--> statement-breakpoint
ALTER TABLE "sliper"."crew_join_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."crew_members" (
	"crew_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(16) DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crew_members_crew_id_user_id_pk" PRIMARY KEY("crew_id","user_id"),
	CONSTRAINT "crew_members_role" CHECK ("sliper"."crew_members"."role" in ('manager','member'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."crew_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."crews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(40) NOT NULL,
	"description" text NOT NULL,
	"category_slug" "sliper"."category_slug" NOT NULL,
	"region" varchar(80) DEFAULT '' NOT NULL,
	"capacity" integer DEFAULT 20 NOT NULL,
	"recruiting" boolean DEFAULT true NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crews_content" CHECK (char_length(btrim("sliper"."crews"."name")) between 2 and 40 and char_length("sliper"."crews"."description") between 10 and 2000),
	CONSTRAINT "crews_capacity" CHECK ("sliper"."crews"."capacity" between 2 and 100),
	CONSTRAINT "crews_status" CHECK ("sliper"."crews"."status" in ('active','archived'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."crews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."crew_activity" ADD CONSTRAINT "crew_activity_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "sliper"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_activity" ADD CONSTRAINT "crew_activity_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_contributions" ADD CONSTRAINT "crew_contributions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_contributions" ADD CONSTRAINT "crew_contributions_application_id_event_results_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "sliper"."event_results"("application_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_contributions" ADD CONSTRAINT "crew_contributions_checked_by_profiles_id_fk" FOREIGN KEY ("checked_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_contributions" ADD CONSTRAINT "crew_contributions_event_fk" FOREIGN KEY ("crew_id","post_id") REFERENCES "sliper"."crew_events"("crew_id","post_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_events" ADD CONSTRAINT "crew_events_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "sliper"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_events" ADD CONSTRAINT "crew_events_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_events" ADD CONSTRAINT "crew_events_linked_by_profiles_id_fk" FOREIGN KEY ("linked_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_join_requests" ADD CONSTRAINT "crew_join_requests_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "sliper"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_join_requests" ADD CONSTRAINT "crew_join_requests_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_join_requests" ADD CONSTRAINT "crew_join_requests_decision_by_profiles_id_fk" FOREIGN KEY ("decision_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_members" ADD CONSTRAINT "crew_members_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "sliper"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crew_members" ADD CONSTRAINT "crew_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crews" ADD CONSTRAINT "crews_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "sliper"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."crews" ADD CONSTRAINT "crews_category_slug_categories_slug_fk" FOREIGN KEY ("category_slug") REFERENCES "sliper"."categories"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crew_activity_feed_idx" ON "sliper"."crew_activity" USING btree ("crew_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "crew_contributions_user_idx" ON "sliper"."crew_contributions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crew_events_post_idx" ON "sliper"."crew_events" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "crew_join_queue_idx" ON "sliper"."crew_join_requests" USING btree ("crew_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "crew_members_user_idx" ON "sliper"."crew_members" USING btree ("user_id","crew_id");--> statement-breakpoint
CREATE INDEX "crews_feed_idx" ON "sliper"."crews" USING btree ("status","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "crews_owner_idx" ON "sliper"."crews" USING btree ("owner_id");