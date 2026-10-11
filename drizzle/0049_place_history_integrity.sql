-- Completed event-place attribution cannot be retroactively attached, removed or changed.
CREATE FUNCTION sliper.guard_event_venue_link() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target uuid; finished timestamptz;
BEGIN
 target := CASE WHEN TG_OP='DELETE' THEN OLD.post_id ELSE NEW.post_id END;
 IF TG_OP='UPDATE' AND NEW.post_id IS DISTINCT FROM OLD.post_id THEN
  RAISE EXCEPTION 'Event place identity cannot be moved' USING ERRCODE='23514';
 END IF;
 PERFORM 1 FROM sliper.posts WHERE id=target FOR UPDATE;
 SELECT completed_at INTO finished FROM sliper.event_settings WHERE post_id=target;
 IF finished IS NOT NULL AND (TG_OP<>'UPDATE' OR NEW IS DISTINCT FROM OLD) THEN
  RAISE EXCEPTION 'Completed event place is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER event_venue_link_guard BEFORE INSERT OR UPDATE OR DELETE ON sliper.event_venue_links
 FOR EACH ROW EXECUTE FUNCTION sliper.guard_event_venue_link();
--> statement-breakpoint
-- Bindings and settings are written in one transaction, so validate their final state.
CREATE FUNCTION sliper.guard_event_venue_coordinates() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target uuid;
BEGIN
 target:=NEW.post_id;
 IF EXISTS(SELECT 1 FROM sliper.event_venue_links l LEFT JOIN sliper.event_settings s ON s.post_id=l.post_id
  WHERE l.post_id=target AND (s.post_id IS NULL OR
    s.venue_latitude IS DISTINCT FROM (l.snapshot->>'latitude')::double precision OR
    s.venue_longitude IS DISTINCT FROM (l.snapshot->>'longitude')::double precision)) THEN
  RAISE EXCEPTION 'Registered place coordinates must match event settings' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER event_venue_coordinates_guard AFTER INSERT OR UPDATE ON sliper.event_venue_links
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sliper.guard_event_venue_coordinates();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER event_settings_venue_coordinates_guard AFTER INSERT OR UPDATE ON sliper.event_settings
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sliper.guard_event_venue_coordinates();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_record_venue_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE selected jsonb;
BEGIN
 SELECT snapshot INTO selected FROM sliper.event_venue_links WHERE post_id=NEW.post_id;
 IF (NEW.snapshot->'venue' IS DISTINCT FROM selected) AND NOT
  (selected IS NULL AND (NEW.snapshot->'venue' IS NULL OR NEW.snapshot->'venue'='null'::jsonb)) THEN
  RAISE EXCEPTION 'Record place must match the event selection snapshot' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER record_venue_snapshot_guard BEFORE INSERT ON sliper.event_records
 FOR EACH ROW EXECUTE FUNCTION sliper.guard_record_venue_snapshot();
--> statement-breakpoint
REVOKE ALL ON sliper.event_venue_links FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_event_venue_link(),sliper.guard_event_venue_coordinates(),sliper.guard_record_venue_snapshot() FROM PUBLIC,anon,authenticated;
