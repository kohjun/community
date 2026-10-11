CREATE OR REPLACE FUNCTION sliper.guard_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settings sliper.event_settings; occupied integer; p sliper.posts;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 SELECT * INTO settings FROM sliper.event_settings WHERE post_id=NEW.post_id;
 IF TG_OP='INSERT' THEN
   NEW.event_starts_at:=settings.starts_at; NEW.refund_policy:=settings.refund_policy;
   IF NEW.refund_consent_at IS NOT NULL THEN NEW.refund_consent_at:=statement_timestamp(); END IF;
   IF NEW.source='site' AND NEW.amount_krw>0 AND NEW.event_starts_at IS NOT NULL AND NEW.refund_consent_at IS NULL THEN RAISE EXCEPTION 'refund consent required'; END IF;
   IF p.status<>'published' OR p.kind<>'모집' OR (NEW.source='site' AND NOT settings.open) OR NEW.amount_krw<>settings.amount_krw THEN RAISE EXCEPTION 'application configuration mismatch'; END IF;
   IF (NEW.source='site' AND (p.application_url IS NOT NULL OR NEW.status NOT IN ('pending_payment','confirmed'))) OR (NEW.source='external' AND (p.application_url IS NULL OR NEW.status NOT IN ('pending_approval','review'))) THEN RAISE EXCEPTION 'invalid initial application state'; END IF;
 ELSE
   IF (NEW.id,NEW.post_id,NEW.user_id,NEW.amount_krw,NEW.expires_at,NEW.attendee_name,NEW.contact,NEW.note,NEW.source,NEW.external_reference,NEW.event_starts_at,NEW.refund_policy,NEW.refund_consent_at) IS DISTINCT FROM (OLD.id,OLD.post_id,OLD.user_id,OLD.amount_krw,OLD.expires_at,OLD.attendee_name,OLD.contact,OLD.note,OLD.source,OLD.external_reference,OLD.event_starts_at,OLD.refund_policy,OLD.refund_consent_at) THEN RAISE EXCEPTION 'immutable application'; END IF;
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
 IF TG_OP='UPDATE' AND (NEW.starts_at,NEW.ends_at,NEW.refund_policy) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at,OLD.refund_policy) AND EXISTS(SELECT 1 FROM sliper.event_applications WHERE post_id=NEW.post_id) THEN RAISE EXCEPTION 'event schedule is committed'; END IF;
 IF NEW.capacity < occupied THEN RAISE EXCEPTION 'capacity below current reservations'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
UPDATE sliper.payment_orders SET refunded_amount_krw=amount_krw WHERE state='refunded' AND refunded_amount_krw IS NULL;
--> statement-breakpoint
UPDATE sliper.external_receipts SET refunded_amount_krw=amount_krw WHERE state='refunded' AND refunded_amount_krw IS NULL;
--> statement-breakpoint
ALTER TABLE sliper.payment_orders ADD CONSTRAINT order_refund_amount CHECK ((state='refunded' AND refunded_amount_krw BETWEEN 0 AND amount_krw) OR (state<>'refunded' AND refunded_amount_krw IS NULL));
--> statement-breakpoint
ALTER TABLE sliper.external_receipts ADD CONSTRAINT receipt_refund_amount CHECK ((state='refunded' AND refunded_amount_krw BETWEEN 0 AND amount_krw) OR (state<>'refunded' AND refunded_amount_krw IS NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_external_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE app sliper.event_applications;
BEGIN
 SELECT * INTO app FROM sliper.event_applications WHERE id=NEW.application_id;
 PERFORM 1 FROM sliper.posts WHERE id=app.post_id FOR UPDATE;
 IF app.source<>'external' OR app.post_id<>NEW.post_id OR app.external_reference<>NEW.reference OR app.amount_krw<>NEW.amount_krw THEN RAISE EXCEPTION 'external receipt mismatch'; END IF;
 IF TG_OP='INSERT' AND NEW.verification='manual' AND (NEW.verified_by IS NULL OR NOT (EXISTS(SELECT 1 FROM sliper.posts WHERE id=NEW.post_id AND author_id=NEW.verified_by) OR EXISTS(SELECT 1 FROM sliper.room_managers WHERE post_id=NEW.post_id AND user_id=NEW.verified_by))) THEN RAISE EXCEPTION 'only managers verify external payments'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.application_id,NEW.post_id,NEW.reference,NEW.amount_krw,NEW.provider,NEW.verification) IS DISTINCT FROM (OLD.application_id,OLD.post_id,OLD.reference,OLD.amount_krw,OLD.provider,OLD.verification) OR (OLD.state='refunded' AND NEW.state<>'refunded')) THEN RAISE EXCEPTION 'immutable external receipt'; END IF;
 IF TG_OP='UPDATE' AND OLD.state='refunded' AND NEW.refunded_amount_krw IS DISTINCT FROM OLD.refunded_amount_krw THEN RAISE EXCEPTION 'immutable refund amount'; END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION sliper.guard_refund_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE app sliper.event_applications; d integer; verified_amount integer;
BEGIN
 PERFORM 1 FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 SELECT * INTO app FROM sliper.event_applications WHERE id=NEW.application_id;
 IF TG_OP='INSERT' THEN
   IF app.user_id<>NEW.user_id OR app.post_id<>NEW.post_id OR app.status<>'confirmed' OR app.amount_krw<=0 OR app.event_starts_at IS NULL OR NEW.state<>'pending' THEN RAISE EXCEPTION 'invalid refund request'; END IF;
   NEW.event_starts_at:=app.event_starts_at; NEW.amount_krw:=app.amount_krw; NEW.policy_version:=app.refund_policy;
   NEW.requested_at:=statement_timestamp();
   d:=(app.event_starts_at AT TIME ZONE 'Asia/Seoul')::date-(NEW.requested_at AT TIME ZONE 'Asia/Seoul')::date;
   NEW.rate:=GREATEST(0,LEAST(5,d))*20;
   NEW.refundable_krw:=floor(NEW.amount_krw::numeric*NEW.rate/100);
 ELSE
   IF (NEW.id,NEW.application_id,NEW.post_id,NEW.user_id,NEW.policy_version,NEW.event_starts_at,NEW.amount_krw,NEW.rate,NEW.refundable_krw,NEW.reason,NEW.requested_at) IS DISTINCT FROM (OLD.id,OLD.application_id,OLD.post_id,OLD.user_id,OLD.policy_version,OLD.event_starts_at,OLD.amount_krw,OLD.rate,OLD.refundable_krw,OLD.reason,OLD.requested_at) THEN RAISE EXCEPTION 'immutable refund quote'; END IF;
   IF OLD.state<>'pending' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'refund already processed'; END IF;
   IF NEW.state<>OLD.state THEN
     IF NEW.state NOT IN ('completed','rejected') THEN RAISE EXCEPTION 'invalid refund transition'; END IF;
     IF NEW.processed_by IS NOT NULL AND NOT (EXISTS(SELECT 1 FROM sliper.posts WHERE id=NEW.post_id AND author_id=NEW.processed_by) OR EXISTS(SELECT 1 FROM sliper.room_managers WHERE post_id=NEW.post_id AND user_id=NEW.processed_by)) THEN RAISE EXCEPTION 'only event managers process refunds'; END IF;
     IF NEW.state='rejected' AND NEW.processed_by IS NULL THEN RAISE EXCEPTION 'rejection requires a manager'; END IF;
     IF NEW.state='completed' THEN
       IF app.status<>'refunded' THEN RAISE EXCEPTION 'refund application not closed'; END IF;
       IF app.source='external' THEN SELECT refunded_amount_krw INTO verified_amount FROM sliper.external_receipts WHERE application_id=app.id AND state='refunded';
       ELSE SELECT refunded_amount_krw INTO verified_amount FROM sliper.payment_orders WHERE application_id=app.id AND state='refunded'; END IF;
       IF verified_amount IS NULL OR verified_amount<>NEW.actual_refund_krw THEN RAISE EXCEPTION 'refund amount not verified'; END IF;
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refund_request_guard BEFORE INSERT OR UPDATE ON sliper.refund_requests FOR EACH ROW EXECUTE FUNCTION sliper.guard_refund_request();
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA sliper FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA sliper FROM PUBLIC,anon,authenticated;
