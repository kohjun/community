REVOKE ALL ON TABLE sliper.saved_searches,sliper.event_waitlist,sliper.event_ideas,sliper.idea_interests,sliper.idea_events,sliper.event_reflections FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
CREATE FUNCTION sliper.guard_reunion_media() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.reunion_origin_post_id IS NOT NULL AND NEW.reunion_origin_post_id IS DISTINCT FROM OLD.reunion_origin_post_id THEN
  RAISE EXCEPTION 'Private reunion origin is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.reunion_origin_post_id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM sliper.media_retention_jobs WHERE asset_kind='image' AND asset_id=NEW.id) THEN RAISE EXCEPTION 'Cleanup asset cannot join reunion' USING ERRCODE='23514'; END IF;
  NEW.unattached_since:=NULL;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER z_reunion_media_guard BEFORE INSERT OR UPDATE ON sliper.media_assets FOR EACH ROW EXECUTE FUNCTION sliper.guard_reunion_media();
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_reunion_media() FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sliper_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON sliper.saved_searches,sliper.event_waitlist,sliper.event_ideas,sliper.idea_interests,sliper.idea_events,sliper.event_reflections TO sliper_app;
  GRANT EXECUTE ON FUNCTION sliper.guard_reunion_media() TO sliper_app;
 END IF;
END $$;

--> statement-breakpoint
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
  ELSIF NEW.kind='participation' AND NEW.dedupe_key LIKE 'waitlist:%' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.event_waitlist w WHERE w.id=NEW.source_id AND w.post_id=NEW.post_id AND w.user_id=NEW.recipient_id AND w.state='offered' AND w.offer_until>statement_timestamp() AND NEW.dedupe_key LIKE 'waitlist:'||w.id::text||':%') INTO valid_source;
  ELSIF NEW.kind='participation' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.event_applications a WHERE a.id=NEW.source_id AND a.post_id=NEW.post_id
      AND a.user_id=NEW.recipient_id AND NEW.dedupe_key IN ('application:'||a.id::text||':confirmed',
        'application:'||a.id::text||':refunded','application:'||a.id::text||':rejected','application:'||a.id::text||':cancelled',
        'application:'||a.id::text||':pending_approval','application:'||a.id::text||':review'))
    INTO valid_source;
  ELSIF NEW.kind='subscriptions' AND NEW.dedupe_key LIKE 'saved:%' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.saved_searches s JOIN sliper.posts p ON p.id=NEW.post_id WHERE s.id=NEW.source_id AND s.user_id=NEW.recipient_id AND s.settings->>'frequency'<>'off' AND p.kind='모집' AND NOT p.sample AND p.author_id<>NEW.recipient_id AND p.created_at>=s.created_at AND NEW.dedupe_key='saved:'||p.id::text) INTO valid_source;
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

