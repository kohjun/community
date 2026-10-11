CREATE TABLE "sliper"."push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"dedupe_key" varchar(220) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"post_id" uuid,
	"comment_id" uuid,
	"title" varchar(120) NOT NULL,
	"body" varchar(300) NOT NULL,
	"url" varchar(512) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_token" uuid,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_deliveries_subscription_dedupe_unique" UNIQUE("subscription_id","dedupe_key"),
	CONSTRAINT "push_deliveries_dedupe" CHECK (char_length(btrim("sliper"."push_deliveries"."dedupe_key")) between 1 and 220),
	CONSTRAINT "push_deliveries_kind" CHECK ("sliper"."push_deliveries"."kind" in ('comment','announcement','participation','test')),
	CONSTRAINT "push_deliveries_source" CHECK (("sliper"."push_deliveries"."kind" = 'comment' and "sliper"."push_deliveries"."post_id" is not null and "sliper"."push_deliveries"."comment_id" is not null) or ("sliper"."push_deliveries"."kind" in ('announcement','participation') and "sliper"."push_deliveries"."post_id" is not null and "sliper"."push_deliveries"."comment_id" is null) or ("sliper"."push_deliveries"."kind" = 'test' and "sliper"."push_deliveries"."comment_id" is null)),
	CONSTRAINT "push_deliveries_content" CHECK (char_length(btrim("sliper"."push_deliveries"."title")) between 1 and 120 and char_length("sliper"."push_deliveries"."body") between 1 and 300),
	CONSTRAINT "push_deliveries_local_url" CHECK (char_length("sliper"."push_deliveries"."url") between 1 and 512 and left("sliper"."push_deliveries"."url",1)='/' and left("sliper"."push_deliveries"."url",2)<>'//' and strpos("sliper"."push_deliveries"."url",chr(92))=0 and "sliper"."push_deliveries"."url" !~ '[[:cntrl:]]'),
	CONSTRAINT "push_deliveries_status" CHECK ("sliper"."push_deliveries"."status" in ('pending','processing','sent','failed','cancelled')),
	CONSTRAINT "push_deliveries_attempts" CHECK ("sliper"."push_deliveries"."attempts" between 0 and 100),
	CONSTRAINT "push_deliveries_lease" CHECK (("sliper"."push_deliveries"."status" = 'processing' and "sliper"."push_deliveries"."locked_at" is not null and "sliper"."push_deliveries"."lock_token" is not null) or ("sliper"."push_deliveries"."status" <> 'processing' and "sliper"."push_deliveries"."locked_at" is null and "sliper"."push_deliveries"."lock_token" is null)),
	CONSTRAINT "push_deliveries_sent_time" CHECK (("sliper"."push_deliveries"."status" = 'sent' and "sliper"."push_deliveries"."sent_at" is not null) or ("sliper"."push_deliveries"."status" <> 'sent' and "sliper"."push_deliveries"."sent_at" is null)),
	CONSTRAINT "push_deliveries_expiration" CHECK ("sliper"."push_deliveries"."expires_at" > "sliper"."push_deliveries"."created_at")
);
--> statement-breakpoint
ALTER TABLE "sliper"."push_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."push_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"comments" boolean DEFAULT true NOT NULL,
	"announcements" boolean DEFAULT true NOT NULL,
	"participation" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sliper"."push_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" varchar(128) NOT NULL,
	"auth" varchar(128) NOT NULL,
	"vapid_public_key" varchar(100) NOT NULL,
	"expiration_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "push_subscriptions_endpoint" CHECK (char_length("sliper"."push_subscriptions"."endpoint") between 12 and 2048 and "sliper"."push_subscriptions"."endpoint" ~ '^https://' and "sliper"."push_subscriptions"."endpoint" !~ '[[:space:]]'),
	CONSTRAINT "push_subscriptions_keys" CHECK ("sliper"."push_subscriptions"."p256dh" ~ '^[A-Za-z0-9_-]{87}=?$' and "sliper"."push_subscriptions"."auth" ~ '^[A-Za-z0-9_-]{22}(==)?$' and "sliper"."push_subscriptions"."vapid_public_key" ~ '^[A-Za-z0-9_-]{87}=?$')
);
--> statement-breakpoint
ALTER TABLE "sliper"."push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."push_deliveries" ADD CONSTRAINT "push_deliveries_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."push_deliveries" ADD CONSTRAINT "push_deliveries_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."push_deliveries" ADD CONSTRAINT "push_deliveries_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "sliper"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."push_deliveries" ADD CONSTRAINT "push_deliveries_subscription_owner_fk" FOREIGN KEY ("subscription_id","recipient_id") REFERENCES "sliper"."push_subscriptions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."push_preferences" ADD CONSTRAINT "push_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_deliveries_pending_idx" ON "sliper"."push_deliveries" USING btree ("available_at","created_at","id") WHERE "sliper"."push_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "push_deliveries_processing_idx" ON "sliper"."push_deliveries" USING btree ("locked_at","id") WHERE "sliper"."push_deliveries"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "push_deliveries_recipient_idx" ON "sliper"."push_deliveries" USING btree ("recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "sliper"."push_subscriptions" USING btree ("user_id","created_at" DESC NULLS LAST);