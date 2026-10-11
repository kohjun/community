CREATE FUNCTION sliper.guard_lightning_post() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='published' AND EXISTS(SELECT 1 FROM sliper.event_settings WHERE post_id=NEW.id AND meetup_type='lightning') AND (NEW.kind<>'모집' OR NEW.application_url IS NOT NULL OR NEW.event_fee IS DISTINCT FROM '무료') THEN RAISE EXCEPTION 'lightning requires free internal recruitment'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_lightning_post BEFORE UPDATE ON sliper.posts FOR EACH ROW EXECUTE FUNCTION sliper.guard_lightning_post();
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_lightning_post() FROM PUBLIC, anon, authenticated;
