ALTER TABLE "sliper"."event_settings" DROP CONSTRAINT "event_lightning_rules";--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD CONSTRAINT "event_lightning_rules" CHECK ("sliper"."event_settings"."meetup_type" <> 'lightning' or ("sliper"."event_settings"."capacity" between 2 and 12 and "sliper"."event_settings"."starts_at" is not null and "sliper"."event_settings"."ends_at" is not null and "sliper"."event_settings"."venue_latitude" is not null and "sliper"."event_settings"."venue_longitude" is not null and "sliper"."event_settings"."starts_at">"sliper"."event_settings"."created_at" and "sliper"."event_settings"."starts_at"<="sliper"."event_settings"."created_at"+interval '7 days' and "sliper"."event_settings"."ends_at">="sliper"."event_settings"."starts_at"+interval '15 minutes' and "sliper"."event_settings"."ends_at"<="sliper"."event_settings"."starts_at"+interval '12 hours'));
--> statement-breakpoint
CREATE FUNCTION sliper.guard_lightning_application_settings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p sliper.posts;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 IF NEW.meetup_type='lightning' AND p.application_url IS NULL AND (NEW.amount_krw<>0 OR p.event_fee IS DISTINCT FROM '무료') THEN RAISE EXCEPTION 'paid lightning requires external recruitment'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER lightning_application_settings_guard BEFORE INSERT OR UPDATE ON sliper.event_settings FOR EACH ROW EXECUTE FUNCTION sliper.guard_lightning_application_settings();
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_lightning_application_settings() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_lightning_post() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='published' AND EXISTS(SELECT 1 FROM sliper.event_settings WHERE post_id=NEW.id AND meetup_type='lightning') AND (NEW.kind<>'모집' OR (NEW.application_url IS NULL AND (NEW.event_fee IS DISTINCT FROM '무료' OR EXISTS(SELECT 1 FROM sliper.event_settings WHERE post_id=NEW.id AND amount_krw<>0)))) THEN RAISE EXCEPTION 'lightning direct recruitment must remain free'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_lightning_post() FROM PUBLIC, anon, authenticated;
