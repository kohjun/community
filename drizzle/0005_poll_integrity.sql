CREATE FUNCTION sliper.guard_poll_vote() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE config jsonb; state text; content_kind text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'Vote identity is immutable' USING ERRCODE='23514'; END IF;
 SELECT poll,status::text,kind::text INTO config,state,content_kind FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 IF state IS DISTINCT FROM 'published' OR content_kind IS DISTINCT FROM '투표' OR config IS NULL OR NEW.option_index >= jsonb_array_length(config->'options') THEN RAISE EXCEPTION 'Invalid poll option' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER poll_votes_guard BEFORE INSERT OR UPDATE ON sliper.poll_votes FOR EACH ROW EXECUTE FUNCTION sliper.guard_poll_vote();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_poll_content() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.status='deleted' THEN NEW.poll:=NULL; NEW.location:=NULL; NEW.event_date:=NULL; NEW.event_fee:=NULL; NEW.contact_info:=NULL; NEW.topic:=NULL; NEW.tags:=ARRAY[]::text[]; RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.poll IS DISTINCT FROM OLD.poll AND EXISTS(SELECT 1 FROM sliper.poll_votes WHERE post_id=OLD.id) THEN RAISE EXCEPTION 'Voted polls are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.poll IS NOT NULL THEN
  IF jsonb_typeof(NEW.poll) IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.poll->'question') IS DISTINCT FROM 'string' OR char_length(btrim(NEW.poll->>'question')) NOT BETWEEN 2 AND 200 OR jsonb_typeof(NEW.poll->'options') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid poll configuration' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(NEW.poll->'options') NOT BETWEEN 2 AND 8 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.poll->'options') x WHERE jsonb_typeof(x) <> 'string' OR char_length(btrim(x #>> '{}')) NOT BETWEEN 1 AND 80) OR (SELECT count(DISTINCT lower(btrim(x #>> '{}'))) FROM jsonb_array_elements(NEW.poll->'options') x) <> jsonb_array_length(NEW.poll->'options') THEN RAISE EXCEPTION 'Invalid poll options' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER posts_poll_guard BEFORE INSERT OR UPDATE ON sliper.posts FOR EACH ROW EXECUTE FUNCTION sliper.guard_poll_content();
--> statement-breakpoint
REVOKE ALL ON sliper.poll_votes, sliper.activity_events FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_poll_vote(), sliper.guard_poll_content() FROM PUBLIC, anon, authenticated;
