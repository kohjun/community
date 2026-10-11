CREATE TABLE "sliper"."library_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"content" jsonb NOT NULL,
	"change_summary" varchar(1000) NOT NULL,
	"source_version_id" uuid,
	"source_record_post_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"publisher_id" uuid,
	"legacy" boolean DEFAULT false NOT NULL,
	CONSTRAINT "library_version_number_unique" UNIQUE("entry_id","number"),
	CONSTRAINT "library_version_number" CHECK ("sliper"."library_versions"."number" > 0)
);
--> statement-breakpoint
ALTER TABLE "sliper"."library_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" DROP CONSTRAINT "library_status";--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD COLUMN "published_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD COLUMN "draft_content" jsonb;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD COLUMN "source_version_id" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD COLUMN "source_record_post_id" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD COLUMN "allow_derivatives" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD COLUMN "allow_commercial_use" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD COLUMN "usage_terms" varchar(2000) DEFAULT '작성자의 이용 조건을 확인해주세요.' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."template_provenance" ADD COLUMN "version_id" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."library_versions" ADD CONSTRAINT "library_versions_entry_id_library_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "sliper"."library_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_versions" ADD CONSTRAINT "library_versions_source_version_id_library_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "sliper"."library_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_versions" ADD CONSTRAINT "library_versions_source_record_post_id_event_records_post_id_fk" FOREIGN KEY ("source_record_post_id") REFERENCES "sliper"."event_records"("post_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_versions" ADD CONSTRAINT "library_versions_publisher_id_profiles_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_version_source_idx" ON "sliper"."library_versions" USING btree ("source_version_id");--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD CONSTRAINT "library_entries_source_version_id_library_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "sliper"."library_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD CONSTRAINT "library_entries_source_record_post_id_event_records_post_id_fk" FOREIGN KEY ("source_record_post_id") REFERENCES "sliper"."event_records"("post_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."template_provenance" ADD CONSTRAINT "template_provenance_version_id_library_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "sliper"."library_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD CONSTRAINT "library_status" CHECK ("sliper"."library_entries"."status" in ('draft','published','deleted'));