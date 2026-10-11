CREATE TABLE "sliper"."admission_tickets" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_tickets_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "ticket_hash_format" CHECK ("sliper"."admission_tickets"."code_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "sliper"."admission_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_admissions" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"checked_by" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_event_member" UNIQUE("post_id","user_id"),
	CONSTRAINT "admission_no_self" CHECK ("sliper"."event_admissions"."checked_by" is null or "sliper"."event_admissions"."checked_by"<>"sliper"."event_admissions"."user_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_admissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_payment_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"note" varchar(1000) NOT NULL,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_review_note" CHECK (char_length(btrim("sliper"."event_payment_reviews"."note")) between 5 and 1000)
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_payment_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."verified_event_reviews" (
	"review_post_id" uuid PRIMARY KEY NOT NULL,
	"event_post_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"host_id" uuid,
	"template_entry_id" uuid,
	"event_title" varchar(120) NOT NULL,
	"rating" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verified_event_reviews_application_id_unique" UNIQUE("application_id"),
	CONSTRAINT "verified_review_event_member" UNIQUE("event_post_id","user_id"),
	CONSTRAINT "verified_review_rating" CHECK ("sliper"."verified_event_reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."admission_tickets" ADD CONSTRAINT "admission_tickets_application_id_event_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "sliper"."event_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_admissions" ADD CONSTRAINT "event_admissions_checked_by_profiles_id_fk" FOREIGN KEY ("checked_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_admissions" ADD CONSTRAINT "admission_application_identity_fk" FOREIGN KEY ("application_id","post_id","user_id") REFERENCES "sliper"."event_applications"("id","post_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_payment_reviews" ADD CONSTRAINT "event_payment_reviews_application_id_event_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "sliper"."event_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_payment_reviews" ADD CONSTRAINT "event_payment_reviews_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" ADD CONSTRAINT "verified_event_reviews_review_post_id_posts_id_fk" FOREIGN KEY ("review_post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" ADD CONSTRAINT "verified_event_reviews_event_post_id_event_settings_post_id_fk" FOREIGN KEY ("event_post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" ADD CONSTRAINT "verified_event_reviews_application_id_event_admissions_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "sliper"."event_admissions"("application_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" ADD CONSTRAINT "verified_event_reviews_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" ADD CONSTRAINT "verified_event_reviews_host_id_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" ADD CONSTRAINT "verified_event_reviews_template_entry_id_library_entries_id_fk" FOREIGN KEY ("template_entry_id") REFERENCES "sliper"."library_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_event_time_idx" ON "sliper"."event_admissions" USING btree ("post_id","checked_at");--> statement-breakpoint
CREATE INDEX "payment_review_application_idx" ON "sliper"."event_payment_reviews" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "verified_review_event_idx" ON "sliper"."verified_event_reviews" USING btree ("event_post_id","created_at");
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.admission_tickets, sliper.event_admissions, sliper.event_payment_reviews, sliper.verified_event_reviews FROM anon, authenticated;
