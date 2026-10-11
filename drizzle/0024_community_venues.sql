CREATE TABLE "sliper"."community_venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"name" varchar(80) NOT NULL,
	"address" varchar(200) NOT NULL,
	"description" varchar(2000) NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"category_slug" "sliper"."category_slug" NOT NULL,
	"space_type" varchar(8) NOT NULL,
	"is_free" boolean NOT NULL,
	"fee_note" varchar(160) DEFAULT '' NOT NULL,
	"capacity" integer,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"website_url" varchar(2048),
	"version" integer DEFAULT 1 NOT NULL,
	"status" "sliper"."content_status" DEFAULT 'published' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_name_length" CHECK (char_length(btrim("sliper"."community_venues"."name")) between 2 and 80),
	CONSTRAINT "venue_address_length" CHECK (char_length(btrim("sliper"."community_venues"."address")) between 5 and 200),
	CONSTRAINT "venue_description_length" CHECK (char_length(btrim("sliper"."community_venues"."description")) between 10 and 2000),
	CONSTRAINT "venue_coordinate_range" CHECK ("sliper"."community_venues"."latitude" between -90 and 90 and "sliper"."community_venues"."longitude" between -180 and 180),
	CONSTRAINT "venue_category" CHECK ("sliper"."community_venues"."category_slug"::text in ('travel','dating','race','mind-games','survival','music','sports','cooking','party')),
	CONSTRAINT "venue_space_type" CHECK ("sliper"."community_venues"."space_type" in ('indoor','outdoor','mixed')),
	CONSTRAINT "venue_capacity" CHECK ("sliper"."community_venues"."capacity" is null or "sliper"."community_venues"."capacity" between 1 and 5000),
	CONSTRAINT "venue_tags_limit" CHECK (cardinality("sliper"."community_venues"."tags") <= 5),
	CONSTRAINT "venue_website_url" CHECK ("sliper"."community_venues"."website_url" is null or "sliper"."community_venues"."website_url" ~ '^https?://[^[:space:]]+$'),
	CONSTRAINT "venue_version" CHECK ("sliper"."community_venues"."version" > 0),
	CONSTRAINT "venue_deleted_state" CHECK (("sliper"."community_venues"."status"='deleted')=("sliper"."community_venues"."deleted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "sliper"."community_venues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."venue_recommendations" (
	"venue_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_recommendations_venue_id_user_id_pk" PRIMARY KEY("venue_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."venue_recommendations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."community_venues" ADD CONSTRAINT "community_venues_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."venue_recommendations" ADD CONSTRAINT "venue_recommendations_venue_id_community_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "sliper"."community_venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."venue_recommendations" ADD CONSTRAINT "venue_recommendations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_venues_bounds_idx" ON "sliper"."community_venues" USING btree ("latitude","longitude") WHERE "sliper"."community_venues"."status"='published';--> statement-breakpoint
CREATE INDEX "community_venues_category_idx" ON "sliper"."community_venues" USING btree ("category_slug","created_at" DESC NULLS LAST,"id") WHERE "sliper"."community_venues"."status"='published';--> statement-breakpoint
CREATE INDEX "community_venues_owner_idx" ON "sliper"."community_venues" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "venue_recommendations_user_idx" ON "sliper"."venue_recommendations" USING btree ("user_id");
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.community_venues, sliper.venue_recommendations FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION sliper.guard_community_venue() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.owner_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in contributor is required' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR (NEW.owner_id IS DISTINCT FROM OLD.owner_id AND NEW.owner_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Venue identities are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='deleted' AND NEW.status<>'deleted' THEN
    RAISE EXCEPTION 'Deleted venues cannot be republished' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER community_venues_identity_guard BEFORE INSERT OR UPDATE ON sliper.community_venues FOR EACH ROW EXECUTE FUNCTION sliper.guard_community_venue();
--> statement-breakpoint
CREATE TRIGGER community_venues_touch BEFORE UPDATE ON sliper.community_venues FOR EACH ROW EXECUTE FUNCTION sliper.touch_updated_at();
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_community_venue() FROM PUBLIC, anon, authenticated;
