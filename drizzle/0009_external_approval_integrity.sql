DROP INDEX sliper.application_active_user_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX application_active_user_unique ON sliper.event_applications(post_id,user_id) WHERE status IN ('pending_payment','pending_approval','confirmed') OR (source='external' AND status='review');
--> statement-breakpoint
ALTER TABLE sliper.event_applications ADD CONSTRAINT application_source CHECK ((source='site' AND external_reference IS NULL AND expires_at IS NOT NULL) OR (source='external' AND external_reference IS NOT NULL AND char_length(btrim(external_reference)) BETWEEN 3 AND 160 AND expires_at IS NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settings sliper.event_settings; occupied integer; p sliper.posts;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 SELECT * INTO settings FROM sliper.event_settings WHERE post_id=NEW.post_id;
 IF TG_OP='INSERT' THEN
   IF p.status<>'published' OR p.kind<>'모집' OR (NEW.source='site' AND NOT settings.open) OR NEW.amount_krw<>settings.amount_krw THEN RAISE EXCEPTION 'application configuration mismatch'; END IF;
   IF (NEW.source='site' AND (p.application_url IS NOT NULL OR NEW.status NOT IN ('pending_payment','confirmed'))) OR (NEW.source='external' AND (p.application_url IS NULL OR NEW.status<>'pending_approval')) THEN RAISE EXCEPTION 'invalid initial application state'; END IF;
 ELSE
   IF (NEW.id,NEW.post_id,NEW.user_id,NEW.amount_krw,NEW.expires_at,NEW.attendee_name,NEW.contact,NEW.note,NEW.source,NEW.external_reference) IS DISTINCT FROM (OLD.id,OLD.post_id,OLD.user_id,OLD.amount_krw,OLD.expires_at,OLD.attendee_name,OLD.contact,OLD.note,OLD.source,OLD.external_reference) THEN RAISE EXCEPTION 'immutable application'; END IF;
   IF NEW.status<>OLD.status AND NOT (
     (OLD.status='pending_payment' AND NEW.status IN ('confirmed','cancelled','expired','review','refunded')) OR
     (OLD.status='confirmed' AND (NEW.status='refunded' OR (NEW.status='cancelled' AND OLD.amount_krw=0))) OR
     (OLD.status IN ('cancelled','expired','rejected') AND NEW.status IN ('review','refunded')) OR
     (OLD.status='review' AND (NEW.status='refunded' OR (NEW.source='external' AND NEW.status='confirmed'))) OR
     (OLD.status='pending_approval' AND NEW.status IN ('confirmed','rejected','cancelled','review','refunded'))
   ) THEN RAISE EXCEPTION 'invalid application transition'; END IF;
 END IF;
 IF NEW.status='confirmed' THEN
   IF NEW.source='external' AND NOT EXISTS(SELECT 1 FROM sliper.external_receipts WHERE application_id=NEW.id AND state='paid' AND amount_krw=NEW.amount_krw) THEN RAISE EXCEPTION 'external payment not verified'; END IF;
   IF NEW.source='site' AND NEW.amount_krw>0 AND NOT EXISTS (SELECT 1 FROM sliper.payment_orders WHERE application_id=NEW.id AND state='paid' AND amount_krw=NEW.amount_krw) THEN RAISE EXCEPTION 'payment not confirmed'; END IF;
   IF NEW.confirmed_at IS NULL THEN RAISE EXCEPTION 'confirmation time required'; END IF;
 END IF;
 IF NEW.status IN ('pending_payment','confirmed') THEN
   SELECT count(*) INTO occupied FROM sliper.event_applications WHERE post_id=NEW.post_id AND id<>NEW.id AND (status='confirmed' OR (status='pending_payment' AND expires_at>statement_timestamp()));
   IF occupied>=settings.capacity THEN RAISE EXCEPTION 'event full'; END IF;
 END IF;
 IF NEW.source='external' AND NEW.status='refunded' AND NOT EXISTS(SELECT 1 FROM sliper.external_receipts WHERE application_id=NEW.id AND state='refunded') THEN RAISE EXCEPTION 'external refund not verified'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_event_settings() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE OR REPLACE FUNCTION sliper.guard_active_event_post() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.status='deleted' OR NEW.kind<>'모집' OR ((NEW.application_url IS NULL)<>(OLD.application_url IS NULL))) AND EXISTS (SELECT 1 FROM sliper.event_applications WHERE post_id=OLD.id AND (status IN ('confirmed','review','pending_approval') OR (status='pending_payment' AND expires_at>statement_timestamp()))) THEN RAISE EXCEPTION 'active event cannot be deleted or reclassified'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint

CREATE FUNCTION sliper.guard_external_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE app sliper.event_applications;
BEGIN
 SELECT * INTO app FROM sliper.event_applications WHERE id=NEW.application_id;
 PERFORM 1 FROM sliper.posts WHERE id=app.post_id FOR UPDATE;
 IF app.source<>'external' OR app.post_id<>NEW.post_id OR app.external_reference<>NEW.reference OR app.amount_krw<>NEW.amount_krw THEN RAISE EXCEPTION 'external receipt mismatch'; END IF;
 IF TG_OP='INSERT' AND NEW.verification='manual' AND (NEW.verified_by IS NULL OR NOT (EXISTS(SELECT 1 FROM sliper.posts WHERE id=NEW.post_id AND author_id=NEW.verified_by) OR EXISTS(SELECT 1 FROM sliper.room_managers WHERE post_id=NEW.post_id AND user_id=NEW.verified_by))) THEN RAISE EXCEPTION 'only managers verify external payments'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.application_id,NEW.post_id,NEW.reference,NEW.amount_krw,NEW.provider,NEW.verification) IS DISTINCT FROM (OLD.application_id,OLD.post_id,OLD.reference,OLD.amount_krw,OLD.provider,OLD.verification) OR (OLD.state='refunded' AND NEW.state<>'refunded')) THEN RAISE EXCEPTION 'immutable external receipt'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER external_receipt_guard BEFORE INSERT OR UPDATE ON sliper.external_receipts FOR EACH ROW EXECUTE FUNCTION sliper.guard_external_receipt();
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA sliper FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA sliper FROM PUBLIC,anon,authenticated;
