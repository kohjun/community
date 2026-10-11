CREATE TABLE "sliper"."library_discussion_links" (
	"entry_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_discussion_links_entry_id_post_id_version_id_pk" PRIMARY KEY("entry_id","post_id","version_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."library_discussion_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."library_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"base_version_id" uuid NOT NULL,
	"proposer_id" uuid,
	"field" varchar(16) NOT NULL,
	"replacement" text NOT NULL,
	"reason" varchar(1000) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"decision_note" varchar(1000) DEFAULT '' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"published_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_suggestion_field" CHECK ("sliper"."library_suggestions"."field" in ('title','summary','scenario','rules','hostGuide')),
	CONSTRAINT "library_suggestion_state" CHECK ("sliper"."library_suggestions"."status" in ('pending','approved','rejected','withdrawn') and ("sliper"."library_suggestions"."status"='pending')=("sliper"."library_suggestions"."decided_at" is null) and ("sliper"."library_suggestions"."status"='approved')=("sliper"."library_suggestions"."published_version_id" is not null)),
	CONSTRAINT "library_suggestion_size" CHECK (char_length("sliper"."library_suggestions"."replacement") between 2 and 10000 and char_length(btrim("sliper"."library_suggestions"."reason")) between 10 and 1000)
);
--> statement-breakpoint
ALTER TABLE "sliper"."library_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."library_discussion_links" ADD CONSTRAINT "library_discussion_links_entry_id_library_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "sliper"."library_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_discussion_links" ADD CONSTRAINT "library_discussion_links_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_discussion_links" ADD CONSTRAINT "library_discussion_links_version_id_library_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "sliper"."library_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_discussion_links" ADD CONSTRAINT "library_discussion_links_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_suggestions" ADD CONSTRAINT "library_suggestions_entry_id_library_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "sliper"."library_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_suggestions" ADD CONSTRAINT "library_suggestions_base_version_id_library_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "sliper"."library_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_suggestions" ADD CONSTRAINT "library_suggestions_proposer_id_profiles_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_suggestions" ADD CONSTRAINT "library_suggestions_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_suggestions" ADD CONSTRAINT "library_suggestions_published_version_id_library_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "sliper"."library_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_discussion_post_idx" ON "sliper"."library_discussion_links" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "library_suggestions_queue_idx" ON "sliper"."library_suggestions" USING btree ("entry_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_pending_suggestion_unique" ON "sliper"."library_suggestions" USING btree ("entry_id","base_version_id","proposer_id","field") WHERE "sliper"."library_suggestions"."status"='pending';