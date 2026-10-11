CREATE SCHEMA "sliper";
--> statement-breakpoint
CREATE TYPE "sliper"."category_slug" AS ENUM('travel', 'dating', 'race', 'mind-games', 'survival', 'music', 'sports', 'cooking', 'party');--> statement-breakpoint
CREATE TYPE "sliper"."content_status" AS ENUM('published', 'deleted');--> statement-breakpoint
CREATE TYPE "sliper"."notification_kind" AS ENUM('post_comment', 'comment_reply');--> statement-breakpoint
CREATE TYPE "sliper"."upload_status" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TABLE "sliper"."bookmarks" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."bookmarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."categories" (
	"slug" "sliper"."category_slug" PRIMARY KEY NOT NULL,
	"name" varchar(24) NOT NULL,
	"sort_order" smallint NOT NULL,
	CONSTRAINT "categories_sort_order_unique" UNIQUE("sort_order"),
	CONSTRAINT "categories_sort_order_range" CHECK ("sliper"."categories"."sort_order" between 0 and 8)
);
--> statement-breakpoint
ALTER TABLE "sliper"."categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" uuid,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"body_markdown" text NOT NULL,
	"status" "sliper"."content_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "comments_id_post_unique" UNIQUE("id","post_id"),
	CONSTRAINT "comments_not_self_parent" CHECK ("sliper"."comments"."parent_id" is null or "sliper"."comments"."parent_id" <> "sliper"."comments"."id"),
	CONSTRAINT "comments_body_length" CHECK (char_length("sliper"."comments"."body_markdown") <= 5000 and ("sliper"."comments"."status" = 'deleted' or char_length(btrim("sliper"."comments"."body_markdown")) > 0)),
	CONSTRAINT "comments_deletion_state" CHECK (("sliper"."comments"."status" = 'deleted') = ("sliper"."comments"."deleted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "sliper"."comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploader_id" uuid,
	"post_id" uuid,
	"object_key" varchar(64) NOT NULL,
	"content_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"status" "sliper"."upload_status" DEFAULT 'pending' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "media_assets_post_order_unique" UNIQUE("post_id","sort_order"),
	CONSTRAINT "media_assets_size_range" CHECK ("sliper"."media_assets"."byte_size" between 1 and 10485760),
	CONSTRAINT "media_assets_order_range" CHECK ("sliper"."media_assets"."sort_order" between 0 and 9),
	CONSTRAINT "media_assets_content_type" CHECK ("sliper"."media_assets"."content_type" in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
	CONSTRAINT "media_assets_object_key" CHECK ("sliper"."media_assets"."object_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp|gif)$')
);
--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"kind" "sliper"."notification_kind" NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_recipient_comment_unique" UNIQUE("recipient_id","comment_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."post_daily_views" (
	"post_id" uuid NOT NULL,
	"visitor_hash" varchar(64) NOT NULL,
	"viewed_on" date DEFAULT (statement_timestamp() at time zone 'Asia/Seoul')::date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_daily_views_post_id_visitor_hash_viewed_on_pk" PRIMARY KEY("post_id","visitor_hash","viewed_on"),
	CONSTRAINT "post_daily_views_hash_format" CHECK ("sliper"."post_daily_views"."visitor_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "sliper"."post_daily_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."post_likes" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_likes_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."post_likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_slug" "sliper"."category_slug" NOT NULL,
	"author_id" uuid,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"title" varchar(120) NOT NULL,
	"body_markdown" text NOT NULL,
	"status" "sliper"."content_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "posts_title_length" CHECK (char_length(btrim("sliper"."posts"."title")) between 1 and 120),
	CONSTRAINT "posts_body_length" CHECK (char_length("sliper"."posts"."body_markdown") <= 30000 and ("sliper"."posts"."status" = 'deleted' or char_length(btrim("sliper"."posts"."body_markdown")) > 0)),
	CONSTRAINT "posts_deletion_state" CHECK (("sliper"."posts"."status" = 'deleted') = ("sliper"."posts"."deleted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "sliper"."posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"nickname" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "profiles_nickname_length" CHECK (char_length(btrim("sliper"."profiles"."nickname")) between 2 and 24)
);
--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."bookmarks" ADD CONSTRAINT "bookmarks_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."bookmarks" ADD CONSTRAINT "bookmarks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."comments" ADD CONSTRAINT "comments_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."comments" ADD CONSTRAINT "comments_parent_same_post_fk" FOREIGN KEY ("parent_id","post_id") REFERENCES "sliper"."comments"("id","post_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD CONSTRAINT "media_assets_uploader_id_profiles_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."media_assets" ADD CONSTRAINT "media_assets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."notifications" ADD CONSTRAINT "notifications_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."notifications" ADD CONSTRAINT "notifications_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."notifications" ADD CONSTRAINT "notifications_comment_post_fk" FOREIGN KEY ("comment_id","post_id") REFERENCES "sliper"."comments"("id","post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."post_daily_views" ADD CONSTRAINT "post_daily_views_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."post_likes" ADD CONSTRAINT "post_likes_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD CONSTRAINT "posts_category_slug_categories_slug_fk" FOREIGN KEY ("category_slug") REFERENCES "sliper"."categories"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD CONSTRAINT "posts_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookmarks_user_feed_idx" ON "sliper"."bookmarks" USING btree ("user_id","created_at" DESC NULLS LAST,"post_id");--> statement-breakpoint
CREATE INDEX "comments_thread_idx" ON "sliper"."comments" USING btree ("post_id","parent_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "sliper"."comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "sliper"."comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "media_assets_uploader_idx" ON "sliper"."media_assets" USING btree ("uploader_id");--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "sliper"."notifications" USING btree ("recipient_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "sliper"."notifications" USING btree ("recipient_id","created_at" DESC NULLS LAST) WHERE "sliper"."notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_comment_idx" ON "sliper"."notifications" USING btree ("comment_id","post_id");--> statement-breakpoint
CREATE INDEX "notifications_post_idx" ON "sliper"."notifications" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_daily_views_date_idx" ON "sliper"."post_daily_views" USING btree ("viewed_on");--> statement-breakpoint
CREATE INDEX "post_likes_user_idx" ON "sliper"."post_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "posts_category_feed_idx" ON "sliper"."posts" USING btree ("category_slug","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "sliper"."posts"."status" = 'published';--> statement-breakpoint
CREATE INDEX "posts_latest_idx" ON "sliper"."posts" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "sliper"."posts"."status" = 'published';--> statement-breakpoint
CREATE INDEX "posts_author_idx" ON "sliper"."posts" USING btree ("author_id");