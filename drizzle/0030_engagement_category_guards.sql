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
