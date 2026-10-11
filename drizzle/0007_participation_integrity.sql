CREATE UNIQUE INDEX application_active_user_unique ON sliper.event_applications(post_id,user_id) WHERE status IN ('pending_payment','confirmed');
--> statement-breakpoint
CREATE FUNCTION sliper.guard_event_settings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p sliper.posts; occupied integer;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 IF p.kind <> '모집' OR p.status <> 'published' THEN RAISE EXCEPTION 'event requires a published recruitment'; END IF;
 IF TG_OP='UPDATE' AND NEW.post_id <> OLD.post_id THEN RAISE EXCEPTION 'immutable event'; END IF;
 SELECT count(*) INTO occupied FROM sliper.event_applications WHERE post_id=NEW.post_id AND (status='confirmed' OR (status='pending_payment' AND expires_at>statement_timestamp()));
 IF NEW.capacity < occupied THEN RAISE EXCEPTION 'capacity below current reservations'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER event_settings_guard BEFORE INSERT OR UPDATE ON sliper.event_settings FOR EACH ROW EXECUTE FUNCTION sliper.guard_event_settings();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settings sliper.event_settings; occupied integer; p sliper.posts;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 SELECT * INTO settings FROM sliper.event_settings WHERE post_id=NEW.post_id;
 IF TG_OP='INSERT' THEN
   IF p.status<>'published' OR p.kind<>'모집' OR NOT settings.open OR NEW.amount_krw<>settings.amount_krw THEN RAISE EXCEPTION 'application configuration mismatch'; END IF;
   IF NEW.status NOT IN ('pending_payment','confirmed') THEN RAISE EXCEPTION 'invalid initial application state'; END IF;
 ELSE
   IF (NEW.id,NEW.post_id,NEW.user_id,NEW.amount_krw,NEW.expires_at,NEW.attendee_name,NEW.contact,NEW.note) IS DISTINCT FROM (OLD.id,OLD.post_id,OLD.user_id,OLD.amount_krw,OLD.expires_at,OLD.attendee_name,OLD.contact,OLD.note) THEN RAISE EXCEPTION 'immutable application'; END IF;
   IF NEW.status<>OLD.status AND NOT (
     (OLD.status='pending_payment' AND NEW.status IN ('confirmed','cancelled','expired','review','refunded')) OR
     (OLD.status='confirmed' AND (NEW.status='refunded' OR (NEW.status='cancelled' AND OLD.amount_krw=0))) OR
     (OLD.status IN ('cancelled','expired') AND NEW.status IN ('review','refunded')) OR
     (OLD.status='review' AND NEW.status='refunded')
   ) THEN RAISE EXCEPTION 'invalid application transition'; END IF;
 END IF;
 IF NEW.status='confirmed' THEN
   IF NEW.amount_krw>0 AND NOT EXISTS (SELECT 1 FROM sliper.payment_orders WHERE application_id=NEW.id AND state='paid' AND amount_krw=NEW.amount_krw) THEN RAISE EXCEPTION 'payment not confirmed'; END IF;
   IF NEW.confirmed_at IS NULL THEN RAISE EXCEPTION 'confirmation time required'; END IF;
 END IF;
 IF NEW.status IN ('pending_payment','confirmed') THEN
   SELECT count(*) INTO occupied FROM sliper.event_applications WHERE post_id=NEW.post_id AND id<>NEW.id AND (status='confirmed' OR (status='pending_payment' AND expires_at>statement_timestamp()));
   IF occupied>=settings.capacity THEN RAISE EXCEPTION 'event full'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER application_guard BEFORE INSERT OR UPDATE ON sliper.event_applications FOR EACH ROW EXECUTE FUNCTION sliper.guard_application();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_payment_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM sliper.event_applications WHERE id=NEW.application_id AND amount_krw=NEW.amount_krw AND amount_krw>0) THEN RAISE EXCEPTION 'invalid payment amount'; END IF;
 IF TG_OP='UPDATE' THEN
   IF (NEW.id,NEW.application_id,NEW.amount_krw,NEW.provider,NEW.currency) IS DISTINCT FROM (OLD.id,OLD.application_id,OLD.amount_krw,OLD.provider,OLD.currency) THEN RAISE EXCEPTION 'immutable payment identity'; END IF;
   IF (OLD.state='refunded' AND NEW.state<>'refunded') OR (OLD.state='paid' AND NEW.state='pending') OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id) THEN RAISE EXCEPTION 'invalid payment transition'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_order_guard BEFORE INSERT OR UPDATE ON sliper.payment_orders FOR EACH ROW EXECUTE FUNCTION sliper.guard_payment_order();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_room_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM sliper.event_applications WHERE id=NEW.application_id AND post_id=NEW.post_id AND user_id=NEW.user_id AND status='confirmed') THEN RAISE EXCEPTION 'only confirmed applicants may join'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER room_member_guard BEFORE INSERT OR UPDATE ON sliper.room_members FOR EACH ROW EXECUTE FUNCTION sliper.guard_room_member();
--> statement-breakpoint
CREATE FUNCTION sliper.sync_application_room() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='confirmed' THEN
   INSERT INTO sliper.room_members(post_id,user_id,application_id) VALUES(NEW.post_id,NEW.user_id,NEW.id)
     ON CONFLICT(post_id,user_id) DO UPDATE SET application_id=EXCLUDED.application_id,revoked_at=NULL,created_at=statement_timestamp();
 ELSE
   UPDATE sliper.room_members SET revoked_at=statement_timestamp() WHERE application_id=NEW.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER application_room_sync AFTER INSERT OR UPDATE OF status ON sliper.event_applications FOR EACH ROW EXECUTE FUNCTION sliper.sync_application_room();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_room_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF (NEW.id,NEW.post_id,NEW.body,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.post_id,OLD.body,OLD.created_at) OR NEW.author_id IS NOT NULL THEN RAISE EXCEPTION 'announcements are immutable'; END IF;
 ELSE
   PERFORM 1 FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
   IF NEW.author_id IS NULL OR NOT (
     EXISTS (SELECT 1 FROM sliper.posts WHERE id=NEW.post_id AND author_id=NEW.author_id AND status='published') OR
     EXISTS (SELECT 1 FROM sliper.room_managers WHERE post_id=NEW.post_id AND user_id=NEW.author_id)
   ) THEN RAISE EXCEPTION 'only event managers may publish'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER room_message_guard BEFORE INSERT OR UPDATE ON sliper.room_messages FOR EACH ROW EXECUTE FUNCTION sliper.guard_room_message();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_active_event_post() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.status='deleted' OR NEW.kind<>'모집') AND EXISTS (SELECT 1 FROM sliper.event_applications WHERE post_id=OLD.id AND (status IN ('confirmed','review') OR (status='pending_payment' AND expires_at>statement_timestamp()))) THEN RAISE EXCEPTION 'active event cannot be deleted or reclassified'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER active_event_post_guard BEFORE UPDATE ON sliper.posts FOR EACH ROW EXECUTE FUNCTION sliper.guard_active_event_post();
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA sliper FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA sliper FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
