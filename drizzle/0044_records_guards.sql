CREATE OR REPLACE FUNCTION sliper.guard_engagement_inbox() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE valid_source boolean := false;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.recipient_id,NEW.dedupe_key,NEW.kind,NEW.post_id,NEW.source_id,NEW.title,NEW.body,NEW.url,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.recipient_id,OLD.dedupe_key,OLD.kind,OLD.post_id,OLD.source_id,OLD.title,OLD.body,OLD.url,OLD.created_at)
      OR (NEW.actor_id IS DISTINCT FROM OLD.actor_id AND NEW.actor_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Inbox source and payload are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind='comments' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.notifications n WHERE n.recipient_id=NEW.recipient_id
      AND n.post_id=NEW.post_id AND n.comment_id=NEW.source_id AND NEW.dedupe_key='comment:'||n.comment_id::text)
    INTO valid_source;
  ELSIF NEW.kind='announcements' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.room_messages message WHERE message.id=NEW.source_id
      AND message.post_id=NEW.post_id AND NEW.dedupe_key='room:'||message.id::text)
    INTO valid_source;
  ELSIF NEW.kind='participation' AND NEW.dedupe_key LIKE 'event-change:%' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.event_change_recipients r WHERE r.user_id=NEW.recipient_id
      AND r.post_id=NEW.post_id AND r.change_id=NEW.source_id AND NEW.dedupe_key='event-change:'||r.change_id::text)
    INTO valid_source;
  ELSIF NEW.kind='participation' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.event_applications a WHERE a.id=NEW.source_id AND a.post_id=NEW.post_id
      AND a.user_id=NEW.recipient_id AND NEW.dedupe_key IN ('application:'||a.id::text||':confirmed',
        'application:'||a.id::text||':refunded','application:'||a.id::text||':rejected','application:'||a.id::text||':cancelled',
        'application:'||a.id::text||':pending_approval','application:'||a.id::text||':review'))
    INTO valid_source;
  ELSIF NEW.kind='subscriptions' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.posts p WHERE p.id=NEW.post_id AND NEW.source_id=p.id
      AND NEW.dedupe_key='subscription:'||p.id::text AND p.kind='모집' AND NOT p.sample
      AND p.author_id IS DISTINCT FROM NEW.recipient_id AND (
        EXISTS(SELECT 1 FROM sliper.category_subscriptions c WHERE c.user_id=NEW.recipient_id AND c.category_slug=p.category_slug::text AND c.created_at<=p.created_at)
        OR (NOT p.is_anonymous AND EXISTS(SELECT 1 FROM sliper.host_subscriptions h WHERE h.user_id=NEW.recipient_id AND h.host_id=p.author_id AND h.created_at<=p.created_at))))
    INTO valid_source;
  ELSIF NEW.kind='credits' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.event_credits c WHERE c.id=NEW.source_id AND c.post_id=NEW.post_id
      AND c.user_id=NEW.recipient_id AND NEW.dedupe_key LIKE 'credit:'||c.id::text||':%') INTO valid_source;
  ELSIF NEW.kind='records' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.event_records r JOIN sliper.event_settings es ON es.post_id=r.post_id
      WHERE r.post_id=NEW.post_id AND NEW.source_id=r.post_id AND es.completed_at IS NOT NULL
      AND NEW.dedupe_key='record:published:'||r.post_id::text AND (
        EXISTS(SELECT 1 FROM sliper.event_results er WHERE er.post_id=r.post_id AND er.user_id=NEW.recipient_id AND er.presence='attended')
        OR EXISTS(SELECT 1 FROM sliper.event_credits ec WHERE ec.post_id=r.post_id AND ec.user_id=NEW.recipient_id AND ec.status='accepted'))) INTO valid_source;
  ELSIF NEW.kind='reminders' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.event_applications a WHERE a.id=NEW.source_id
      AND a.user_id=NEW.recipient_id AND a.post_id=NEW.post_id
      AND NEW.dedupe_key LIKE 'reminder:'||a.id::text||':%')
    INTO valid_source;
  END IF;
  IF NOT valid_source THEN RAISE EXCEPTION 'Inbox recipient must match source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION sliper.guard_record_media_privacy() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.record_origin_post_id IS NOT NULL AND NEW.record_origin_post_id IS DISTINCT FROM OLD.record_origin_post_id THEN
    RAISE EXCEPTION 'Record media remains member-only after detaching' USING ERRCODE='23514';
  END IF;
  IF NEW.record_post_id IS NOT NULL THEN
    IF NEW.record_origin_post_id IS NULL THEN NEW.record_origin_post_id:=NEW.record_post_id; END IF;
    IF NEW.record_origin_post_id<>NEW.record_post_id THEN RAISE EXCEPTION 'Record media cannot move to another record' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.record_origin_post_id IS NOT NULL AND NEW.post_id IS NOT NULL THEN
    RAISE EXCEPTION 'Record media cannot move to a public post' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER record_media_privacy_guard BEFORE INSERT OR UPDATE ON sliper.media_assets FOR EACH ROW EXECUTE FUNCTION sliper.guard_record_media_privacy();
--> statement-breakpoint
CREATE TRIGGER record_video_privacy_guard BEFORE INSERT OR UPDATE ON sliper.video_assets FOR EACH ROW EXECUTE FUNCTION sliper.guard_record_media_privacy();
--> statement-breakpoint
UPDATE sliper.media_assets SET record_origin_post_id=record_post_id WHERE record_post_id IS NOT NULL;
--> statement-breakpoint
UPDATE sliper.video_assets SET record_origin_post_id=record_post_id WHERE record_post_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION sliper.guard_event_completion() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.completed_at IS NOT NULL AND (NEW.completed_at IS DISTINCT FROM OLD.completed_at OR (NEW.completed_by IS DISTINCT FROM OLD.completed_by AND NEW.completed_by IS NOT NULL)) THEN
   RAISE EXCEPTION 'Event completion evidence is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.completed_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.completed_at IS NULL) THEN
   IF NEW.ends_at IS NULL OR NEW.completed_at<NEW.ends_at OR NEW.completed_by IS NULL OR NOT (
     EXISTS(SELECT 1 FROM sliper.posts p WHERE p.id=NEW.post_id AND p.author_id=NEW.completed_by)
     OR EXISTS(SELECT 1 FROM sliper.room_managers rm WHERE rm.post_id=NEW.post_id AND rm.user_id=NEW.completed_by)
   ) THEN RAISE EXCEPTION 'Completion requires ended event and responsible manager' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER event_completion_guard BEFORE INSERT OR UPDATE ON sliper.event_settings FOR EACH ROW EXECUTE FUNCTION sliper.guard_event_completion();
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_record_media_privacy(), sliper.guard_event_completion(), sliper.guard_engagement_inbox() FROM PUBLIC,anon,authenticated;

--> statement-breakpoint
INSERT INTO sliper.inbox_items(recipient_id,dedupe_key,kind,post_id,source_id,actor_id,title,body,url)
 SELECT user_id,'credit:'||id::text||':legacy','credits',post_id,id,confirmed_by,'제작진 경력 확인 요청','이전 행사 기여 기록을 확인하고 수락해주세요.','/players/me/credits'
 FROM sliper.event_credits WHERE legacy_contribution_id IS NOT NULL
 ON CONFLICT(recipient_id,dedupe_key) DO NOTHING;
