CREATE TABLE "sliper"."refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"policy_version" varchar(24) DEFAULT 'sliper-v1' NOT NULL,
	"event_starts_at" timestamp with time zone NOT NULL,
	"amount_krw" integer NOT NULL,
	"rate" integer NOT NULL,
	"refundable_krw" integer NOT NULL,
	"reason" varchar(500) NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"actual_refund_krw" integer,
	"processed_by" uuid,
	"decision_note" varchar(500) DEFAULT '' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "refund_state" CHECK ("sliper"."refund_requests"."state" in ('pending','completed','rejected')),
	CONSTRAINT "refund_policy" CHECK ("sliper"."refund_requests"."policy_version"='sliper-v1'),
	CONSTRAINT "refund_amounts" CHECK ("sliper"."refund_requests"."amount_krw" between 0 and 10000000 and "sliper"."refund_requests"."rate" in (0,20,40,60,80,100) and "sliper"."refund_requests"."refundable_krw"=floor("sliper"."refund_requests"."amount_krw"::numeric*"sliper"."refund_requests"."rate"/100) and ("sliper"."refund_requests"."actual_refund_krw" is null or "sliper"."refund_requests"."actual_refund_krw" between 0 and "sliper"."refund_requests"."amount_krw")),
	CONSTRAINT "refund_completion" CHECK (("sliper"."refund_requests"."state"='pending' and "sliper"."refund_requests"."processed_at" is null and "sliper"."refund_requests"."actual_refund_krw" is null) or ("sliper"."refund_requests"."state"<>'pending' and "sliper"."refund_requests"."processed_at" is not null and ("sliper"."refund_requests"."state"<>'completed' or "sliper"."refund_requests"."actual_refund_krw" is not null)))
);
--> statement-breakpoint
ALTER TABLE "sliper"."refund_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."library_access_requests" (
	"entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"external_reference" varchar(160) NOT NULL,
	"amount_krw" integer NOT NULL,
	"note" varchar(500) DEFAULT '' NOT NULL,
	"decision_note" varchar(500) DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_access_requests_entry_id_user_id_pk" PRIMARY KEY("entry_id","user_id"),
	CONSTRAINT "library_purchase_reference_unique" UNIQUE("entry_id","external_reference"),
	CONSTRAINT "library_access_status" CHECK ("sliper"."library_access_requests"."status" in ('pending','approved','rejected','revoked')),
	CONSTRAINT "library_access_price" CHECK ("sliper"."library_access_requests"."amount_krw" between 1 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "sliper"."library_access_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."library_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"kind" varchar(16) NOT NULL,
	"category_slug" "sliper"."category_slug" NOT NULL,
	"title" varchar(120) NOT NULL,
	"summary" varchar(600) NOT NULL,
	"scenario" text NOT NULL,
	"rules" text NOT NULL,
	"host_guide" text NOT NULL,
	"materials" text[] NOT NULL,
	"rounds" jsonb NOT NULL,
	"tags" text[] NOT NULL,
	"min_players" integer NOT NULL,
	"max_players" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"price_krw" integer DEFAULT 0 NOT NULL,
	"purchase_url" varchar(2048),
	"sample" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_kind" CHECK ("sliper"."library_entries"."kind" in ('rulebook','template')),
	CONSTRAINT "library_status" CHECK ("sliper"."library_entries"."status" in ('published','deleted')),
	CONSTRAINT "library_players" CHECK ("sliper"."library_entries"."min_players" between 1 and 5000 and "sliper"."library_entries"."max_players" between "sliper"."library_entries"."min_players" and 5000),
	CONSTRAINT "library_duration" CHECK ("sliper"."library_entries"."duration_minutes" between 5 and 1440),
	CONSTRAINT "library_content_size" CHECK (char_length(btrim("sliper"."library_entries"."title")) between 2 and 120 and char_length("sliper"."library_entries"."scenario") between 20 and 10000 and char_length("sliper"."library_entries"."rules") between 10 and 8000 and char_length("sliper"."library_entries"."host_guide") between 10 and 8000),
	CONSTRAINT "library_arrays" CHECK (cardinality("sliper"."library_entries"."materials") <= 40 and cardinality("sliper"."library_entries"."tags") <= 5 and jsonb_typeof("sliper"."library_entries"."rounds") = 'array' and jsonb_array_length("sliper"."library_entries"."rounds") between 1 and 20),
	CONSTRAINT "library_distribution" CHECK ("sliper"."library_entries"."price_krw" between 0 and 1000000 and (("sliper"."library_entries"."price_krw" = 0 and "sliper"."library_entries"."purchase_url" is null) or ("sliper"."library_entries"."price_krw" > 0 and "sliper"."library_entries"."purchase_url" is not null and "sliper"."library_entries"."purchase_url" ~ '^https?://[^[:space:]]+$')))
);
--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."template_provenance" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sliper"."template_provenance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_results" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"recorder_id" uuid,
	"presence" varchar(16) NOT NULL,
	"outcome" varchar(16) DEFAULT 'participated' NOT NULL,
	"observed_role" varchar(16),
	"reason" varchar(500) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_event_result_identity" UNIQUE("post_id","user_id"),
	CONSTRAINT "player_result_presence" CHECK ("sliper"."event_results"."presence" in ('attended','no_show')),
	CONSTRAINT "player_result_outcome" CHECK ("sliper"."event_results"."outcome" in ('participated','won')),
	CONSTRAINT "player_result_role" CHECK ("sliper"."event_results"."observed_role" is null or "sliper"."event_results"."observed_role" in ('brain','physical','strategist','trickster')),
	CONSTRAINT "player_result_no_show" CHECK ("sliper"."event_results"."presence"='attended' or ("sliper"."event_results"."outcome"='participated' and "sliper"."event_results"."observed_role" is null)),
	CONSTRAINT "player_result_no_self" CHECK ("sliper"."event_results"."recorder_id" is null or "sliper"."event_results"."recorder_id" <> "sliper"."event_results"."user_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."manner_reviews" (
	"post_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"sentiment" varchar(12) NOT NULL,
	"tags" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manner_reviews_post_id_reviewer_id_target_id_pk" PRIMARY KEY("post_id","reviewer_id","target_id"),
	CONSTRAINT "manner_review_no_self" CHECK ("sliper"."manner_reviews"."reviewer_id" <> "sliper"."manner_reviews"."target_id"),
	CONSTRAINT "manner_review_sentiment" CHECK ("sliper"."manner_reviews"."sentiment" in ('positive','negative')),
	CONSTRAINT "manner_review_tags" CHECK (cardinality("sliper"."manner_reviews"."tags") between 1 and 2 and (("sliper"."manner_reviews"."sentiment"='positive' and "sliper"."manner_reviews"."tags"<@ARRAY['규칙 준수','배려']::text[]) or ("sliper"."manner_reviews"."sentiment"='negative' and "sliper"."manner_reviews"."tags"=ARRAY['진행 방해']::text[])))
);
--> statement-breakpoint
ALTER TABLE "sliper"."manner_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."player_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preferred_role" varchar(16),
	"matching_visible" boolean DEFAULT false NOT NULL,
	"history_public" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_preference_role" CHECK ("sliper"."player_preferences"."preferred_role" is null or "sliper"."player_preferences"."preferred_role" in ('brain','physical','strategist','trickster'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."player_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD COLUMN "event_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD COLUMN "refund_policy" varchar(24) DEFAULT 'sliper-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD COLUMN "refund_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD COLUMN "refund_policy" varchar(24) DEFAULT 'sliper-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."external_receipts" ADD COLUMN "refunded_amount_krw" integer;--> statement-breakpoint
ALTER TABLE "sliper"."payment_orders" ADD COLUMN "refunded_amount_krw" integer;--> statement-breakpoint
ALTER TABLE "sliper"."refund_requests" ADD CONSTRAINT "refund_requests_processed_by_profiles_id_fk" FOREIGN KEY ("processed_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."refund_requests" ADD CONSTRAINT "refund_application_identity_fk" FOREIGN KEY ("application_id","post_id","user_id") REFERENCES "sliper"."event_applications"("id","post_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_access_requests" ADD CONSTRAINT "library_access_requests_entry_id_library_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "sliper"."library_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_access_requests" ADD CONSTRAINT "library_access_requests_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD CONSTRAINT "library_entries_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD CONSTRAINT "library_entries_category_slug_categories_slug_fk" FOREIGN KEY ("category_slug") REFERENCES "sliper"."categories"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."template_provenance" ADD CONSTRAINT "template_provenance_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."template_provenance" ADD CONSTRAINT "template_provenance_entry_id_library_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "sliper"."library_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_results" ADD CONSTRAINT "event_results_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_results" ADD CONSTRAINT "event_results_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_results" ADD CONSTRAINT "event_results_recorder_id_profiles_id_fk" FOREIGN KEY ("recorder_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_results" ADD CONSTRAINT "player_application_identity_fk" FOREIGN KEY ("application_id","post_id","user_id") REFERENCES "sliper"."event_applications"("id","post_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."manner_reviews" ADD CONSTRAINT "manner_reviewer_result_fk" FOREIGN KEY ("post_id","reviewer_id") REFERENCES "sliper"."event_results"("post_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."manner_reviews" ADD CONSTRAINT "manner_target_result_fk" FOREIGN KEY ("post_id","target_id") REFERENCES "sliper"."event_results"("post_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."player_preferences" ADD CONSTRAINT "player_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_refund_unique" ON "sliper"."refund_requests" USING btree ("application_id") WHERE "sliper"."refund_requests"."state"='pending';--> statement-breakpoint
CREATE INDEX "refund_event_idx" ON "sliper"."refund_requests" USING btree ("post_id","requested_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "library_access_user_idx" ON "sliper"."library_access_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_feed_idx" ON "sliper"."library_entries" USING btree ("kind","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "library_owner_idx" ON "sliper"."library_entries" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "template_source_idx" ON "sliper"."template_provenance" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "player_result_user_idx" ON "sliper"."event_results" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "manner_reviews_target_idx" ON "sliper"."manner_reviews" USING btree ("target_id");--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD CONSTRAINT "event_schedule" CHECK ("sliper"."event_settings"."ends_at" is null or ("sliper"."event_settings"."starts_at" is not null and "sliper"."event_settings"."ends_at">"sliper"."event_settings"."starts_at"));--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD CONSTRAINT "event_refund_policy" CHECK ("sliper"."event_settings"."refund_policy"='sliper-v1');