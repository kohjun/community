ALTER TYPE "sliper"."category_slug" ADD VALUE 'knowledge';--> statement-breakpoint
ALTER TYPE "sliper"."category_slug" ADD VALUE 'lab';--> statement-breakpoint
ALTER TYPE "sliper"."category_slug" ADD VALUE 'crew';--> statement-breakpoint
ALTER TYPE "sliper"."post_kind" ADD VALUE '투표';--> statement-breakpoint
CREATE TABLE "sliper"."activity_events" (
	"user_id" uuid NOT NULL,
	"source_key" varchar(100) NOT NULL,
	"reason" varchar(16) NOT NULL,
	"points" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_events_user_id_source_key_pk" PRIMARY KEY("user_id","source_key"),
	CONSTRAINT "activity_positive_points" CHECK ("sliper"."activity_events"."points" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "sliper"."activity_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."poll_votes" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option_index" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_post_id_user_id_pk" PRIMARY KEY("post_id","user_id"),
	CONSTRAINT "poll_votes_option_range" CHECK ("sliper"."poll_votes"."option_index" between 0 and 7)
);
--> statement-breakpoint
ALTER TABLE "sliper"."poll_votes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."categories" DROP CONSTRAINT "categories_sort_order_range";--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "event_fee" varchar(120);--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "contact_info" varchar(300);--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "topic" varchar(64);--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "poll" jsonb;--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "bio" varchar(300) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "region" varchar(80) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "avatar" varchar(16) DEFAULT 'spark' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "interests" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."activity_events" ADD CONSTRAINT "activity_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."poll_votes" ADD CONSTRAINT "poll_votes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."poll_votes" ADD CONSTRAINT "poll_votes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user_date_idx" ON "sliper"."activity_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "poll_votes_user_idx" ON "sliper"."poll_votes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "posts_topic_feed_idx" ON "sliper"."posts" USING btree ("category_slug","topic","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "sliper"."posts"."status" = 'published';--> statement-breakpoint
ALTER TABLE "sliper"."categories" ADD CONSTRAINT "categories_sort_order_range" CHECK ("sliper"."categories"."sort_order" between 0 and 11);--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD CONSTRAINT "posts_poll_kind" CHECK ("sliper"."posts"."status" = 'deleted' or (("sliper"."posts"."kind"::text = '투표') = ("sliper"."posts"."poll" is not null)));--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD CONSTRAINT "posts_tags_limit" CHECK (cardinality("sliper"."posts"."tags") <= 5);