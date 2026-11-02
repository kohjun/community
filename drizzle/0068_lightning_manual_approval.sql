-- Direct lightning applications now wait for a manager, without a payment order.
-- Existing external receipts, paid applications and their transitions are preserved.
-- Keep application_source unchanged: site rows retain their required non-null time anchor.
-- For lightning the anchor is the event end, not a payment reservation or payment expiry.
CREATE OR REPLACE FUNCTION sliper.guard_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settings sliper.event_settings; occupied integer; p sliper.posts;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 SELECT * INTO settings FROM sliper.event_settings WHERE post_id=NEW.post_id;
 IF TG_OP='INSERT' THEN
   IF EXISTS(SELECT 1 FROM sliper.event_lifecycle l WHERE l.post_id=NEW.post_id AND l.cancelled_at IS NOT NULL) AND NOT (NEW.source='external' AND NEW.status='review') THEN RAISE EXCEPTION 'cancelled event cannot accept applications'; END IF;
   NEW.event_starts_at:=settings.starts_at; NEW.refund_policy:=settings.refund_policy;
   IF NEW.refund_consent_at IS NOT NULL THEN NEW.refund_consent_at:=statement_timestamp(); END IF;
   IF NEW.source='site' AND NEW.amount_krw>0 AND NEW.event_starts_at IS NOT NULL AND NEW.refund_consent_at IS NULL THEN RAISE EXCEPTION 'refund consent required'; END IF;
   IF p.status<>'published' OR p.kind<>'모집' OR (NEW.source='site' AND NOT settings.open) OR NEW.amount_krw<>settings.amount_krw THEN RAISE EXCEPTION 'application configuration mismatch'; END IF;
   IF NEW.source='site' AND settings.meetup_type='lightning' AND p.application_url IS NULL THEN
     IF NEW.amount_krw<>0 OR NEW.status<>'pending_approval' OR NEW.expires_at IS NULL OR NEW.expires_at IS DISTINCT FROM settings.ends_at OR NEW.confirmed_at IS NOT NULL THEN RAISE EXCEPTION 'lightning requires pending manual approval without prepayment'; END IF;
   ELSIF (NEW.source='site' AND (p.application_url IS NOT NULL OR NEW.status NOT IN ('pending_payment','confirmed'))) OR (NEW.source='external' AND (p.application_url IS NULL OR NEW.status NOT IN ('pending_approval','review'))) THEN
     RAISE EXCEPTION 'invalid initial application state';
   END IF;
 ELSE
   IF (NEW.id,NEW.post_id,NEW.user_id,NEW.amount_krw,NEW.expires_at,NEW.source,NEW.external_reference,NEW.event_starts_at,NEW.refund_policy) IS DISTINCT FROM (OLD.id,OLD.post_id,OLD.user_id,OLD.amount_krw,OLD.expires_at,OLD.source,OLD.external_reference,OLD.event_starts_at,OLD.refund_policy) THEN RAISE EXCEPTION 'immutable application'; END IF;
   IF (NEW.attendee_name,NEW.contact,NEW.note,NEW.refund_consent_at,NEW.answers,NEW.questionnaire_version) IS DISTINCT FROM (OLD.attendee_name,OLD.contact,OLD.note,OLD.refund_consent_at,OLD.answers,OLD.questionnaire_version) AND NOT (OLD.source='external' AND OLD.questionnaire_version IS NULL AND OLD.status IN ('pending_approval','review') AND NEW.questionnaire_version IS NOT NULL) THEN RAISE EXCEPTION 'immutable application responses'; END IF;
   IF NEW.status<>OLD.status AND NOT (
     (OLD.status='pending_payment' AND NEW.status IN ('confirmed','cancelled','expired','review','refunded')) OR
     (OLD.status='confirmed' AND (NEW.status='refunded' OR (NEW.status='cancelled' AND OLD.amount_krw=0))) OR
     (OLD.status IN ('cancelled','expired','rejected') AND NEW.status IN ('review','refunded')) OR
     (OLD.status='review' AND (NEW.status='refunded' OR (NEW.source='external' AND NEW.status='confirmed'))) OR
     (OLD.status='pending_approval' AND NEW.status IN ('confirmed','rejected','cancelled','review','refunded'))
   ) THEN RAISE EXCEPTION 'invalid application transition'; END IF;
 END IF;
 IF NEW.status='confirmed' THEN
   IF EXISTS(SELECT 1 FROM sliper.event_lifecycle l WHERE l.post_id=NEW.post_id AND l.cancelled_at IS NOT NULL) AND (TG_OP='INSERT' OR OLD.status<>'confirmed') THEN RAISE EXCEPTION 'cancelled event cannot confirm'; END IF;
   IF NEW.questionnaire_version IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(settings.questions) q WHERE q->>'required'='true') THEN RAISE EXCEPTION 'application answers required before confirmation'; END IF;
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
REVOKE ALL ON FUNCTION sliper.guard_application() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_lightning_application_settings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p sliper.posts;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 IF NEW.meetup_type='lightning' AND p.application_url IS NULL THEN
   IF NEW.amount_krw<>0 OR coalesce(p.event_fee,'') NOT IN ('무료','현장 정산') THEN RAISE EXCEPTION 'direct lightning does not collect prepayment'; END IF;
   -- Leave historical settings unchanged until edited, but never create or enable automatic direct approval.
   IF (TG_OP='INSERT' OR NEW.approval_mode IS DISTINCT FROM OLD.approval_mode) AND NEW.approval_mode<>'manual' THEN RAISE EXCEPTION 'direct lightning requires manual approval'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_lightning_application_settings() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_lightning_post() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='published' AND EXISTS(SELECT 1 FROM sliper.event_settings WHERE post_id=NEW.id AND meetup_type='lightning') THEN
   IF OLD.application_url IS NULL AND NEW.application_url IS NOT NULL THEN RAISE EXCEPTION 'direct lightning cannot enable external prepayment'; END IF;
   IF NEW.kind<>'모집' OR (NEW.application_url IS NULL AND (coalesce(NEW.event_fee,'') NOT IN ('무료','현장 정산') OR EXISTS(SELECT 1 FROM sliper.event_settings WHERE post_id=NEW.id AND amount_krw<>0))) THEN RAISE EXCEPTION 'direct lightning must remain without prepayment'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_lightning_post() FROM PUBLIC, anon, authenticated;
