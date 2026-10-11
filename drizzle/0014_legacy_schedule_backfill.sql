CREATE OR REPLACE FUNCTION sliper.guard_event_settings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p sliper.posts; occupied integer;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 IF p.kind <> '모집' OR p.status <> 'published' THEN RAISE EXCEPTION 'event requires a published recruitment'; END IF;
 IF TG_OP='UPDATE' AND NEW.post_id <> OLD.post_id THEN RAISE EXCEPTION 'immutable event'; END IF;
 SELECT count(*) INTO occupied FROM sliper.event_applications WHERE post_id=NEW.post_id AND (status='confirmed' OR (status='pending_payment' AND expires_at>statement_timestamp()));
 IF TG_OP='UPDATE' AND OLD.starts_at IS NOT NULL AND (NEW.starts_at,NEW.ends_at,NEW.refund_policy) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at,OLD.refund_policy) AND EXISTS(SELECT 1 FROM sliper.event_applications WHERE post_id=NEW.post_id) THEN RAISE EXCEPTION 'event schedule is committed'; END IF;
 IF NEW.capacity < occupied THEN RAISE EXCEPTION 'capacity below current reservations'; END IF;
 RETURN NEW;
END $$;


--> statement-breakpoint
ALTER TABLE sliper.payment_orders ADD CONSTRAINT order_refund_recorded CHECK (state<>'refunded' OR refunded_amount_krw IS NOT NULL);
--> statement-breakpoint
ALTER TABLE sliper.external_receipts ADD CONSTRAINT receipt_refund_recorded CHECK (state<>'refunded' OR refunded_amount_krw IS NOT NULL);
