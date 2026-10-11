DROP INDEX sliper.application_active_user_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX application_active_user_unique ON sliper.event_applications(post_id,user_id) WHERE status IN ('pending_payment','pending_approval','confirmed');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settings sliper.event_settings; occupied integer; p sliper.posts;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 SELECT * INTO settings FROM sliper.event_settings WHERE post_id=NEW.post_id;
 IF TG_OP='INSERT' THEN
   IF p.status<>'published' OR p.kind<>'모집' OR (NEW.source='site' AND NOT settings.open) OR NEW.amount_krw<>settings.amount_krw THEN RAISE EXCEPTION 'application configuration mismatch'; END IF;
   IF (NEW.source='site' AND (p.application_url IS NOT NULL OR NEW.status NOT IN ('pending_payment','confirmed'))) OR (NEW.source='external' AND (p.application_url IS NULL OR NEW.status NOT IN ('pending_approval','review'))) THEN RAISE EXCEPTION 'invalid initial application state'; END IF;
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
