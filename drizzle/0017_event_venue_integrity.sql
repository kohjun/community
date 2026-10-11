CREATE OR REPLACE FUNCTION sliper.guard_event_settings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p sliper.posts; occupied integer;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 IF p.kind <> '모집' OR p.status <> 'published' THEN RAISE EXCEPTION 'event requires a published recruitment'; END IF;
 IF TG_OP='UPDATE' AND NEW.post_id <> OLD.post_id THEN RAISE EXCEPTION 'immutable event'; END IF;
 IF TG_OP='UPDATE' AND NEW.meetup_type <> OLD.meetup_type THEN RAISE EXCEPTION 'immutable meetup type'; END IF;
 IF TG_OP='UPDATE' AND OLD.venue_latitude IS NOT NULL AND (NEW.venue_latitude,NEW.venue_longitude) IS DISTINCT FROM (OLD.venue_latitude,OLD.venue_longitude) AND EXISTS(SELECT 1 FROM sliper.event_applications WHERE post_id=NEW.post_id) THEN RAISE EXCEPTION 'event venue is committed'; END IF;
 SELECT count(*) INTO occupied FROM sliper.event_applications WHERE post_id=NEW.post_id AND (status='confirmed' OR (status='pending_payment' AND expires_at>statement_timestamp()));
 IF TG_OP='UPDATE' AND OLD.starts_at IS NOT NULL AND (NEW.starts_at,NEW.ends_at,NEW.refund_policy) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at,OLD.refund_policy) AND EXISTS(SELECT 1 FROM sliper.event_applications WHERE post_id=NEW.post_id) THEN RAISE EXCEPTION 'event schedule is committed'; END IF;
 IF NEW.capacity < occupied THEN RAISE EXCEPTION 'capacity below current reservations'; END IF;
 RETURN NEW;
END $$;



--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_event_settings() FROM PUBLIC, anon, authenticated;
