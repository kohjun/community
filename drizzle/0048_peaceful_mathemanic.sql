CREATE TABLE "sliper"."event_venue_links" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"venue_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "event_venue_snapshot_identity" CHECK (jsonb_typeof("sliper"."event_venue_links"."snapshot")='object' and coalesce("sliper"."event_venue_links"."snapshot"->>'id'="sliper"."event_venue_links"."venue_id"::text,false))
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_venue_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."event_records" ADD COLUMN "venue_tips" varchar(2000) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."event_venue_links" ADD CONSTRAINT "event_venue_links_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_venue_links" ADD CONSTRAINT "event_venue_links_venue_id_community_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "sliper"."community_venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_venue_links_venue_idx" ON "sliper"."event_venue_links" USING btree ("venue_id","post_id");