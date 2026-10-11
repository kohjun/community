CREATE FUNCTION sliper.guard_library_purchase() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE base sliper.library_versions%ROWTYPE; seller uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO base FROM sliper.library_versions WHERE id=NEW.version_id;
  SELECT owner_id INTO seller FROM sliper.library_entries WHERE id=NEW.entry_id;
  IF base.entry_id IS DISTINCT FROM NEW.entry_id OR NEW.buyer_id IS NULL OR NEW.seller_id IS DISTINCT FROM seller
   OR NEW.seller_id IS NULL OR NEW.buyer_id=NEW.seller_id OR NEW.status<>'pending' OR NEW.provider IS NOT NULL
   OR NEW.amount_krw IS DISTINCT FROM (base.content->>'priceKRW')::integer
   OR NEW.snapshot IS DISTINCT FROM jsonb_build_object('title',base.content->'title','versionNumber',base.number,
    'priceKRW',base.content->'priceKRW','usageTerms',base.content->'usageTerms',
    'allowDerivatives',base.content->'allowDerivatives','allowCommercialUse',base.content->'allowCommercialUse',
    'purchaseUrl',base.content->'purchaseUrl') THEN
   RAISE EXCEPTION 'Purchase must preserve its exact paid edition and responsible members' USING ERRCODE='23514';
  END IF;
 ELSE
  IF ROW(NEW.id,NEW.entry_id,NEW.version_id,NEW.snapshot,NEW.external_reference,NEW.note,NEW.amount_krw,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.entry_id,OLD.version_id,OLD.snapshot,OLD.external_reference,OLD.note,OLD.amount_krw,OLD.created_at)
   OR (NEW.buyer_id IS DISTINCT FROM OLD.buyer_id AND NEW.buyer_id IS NOT NULL)
   OR (NEW.seller_id IS DISTINCT FROM OLD.seller_id AND NEW.seller_id IS NOT NULL)
   OR (OLD.provider IS NOT NULL AND ROW(NEW.provider,NEW.payment_id) IS DISTINCT FROM ROW(OLD.provider,OLD.payment_id)) THEN
   RAISE EXCEPTION 'Purchase identity, terms and payment mapping are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status<>OLD.status AND NOT (
   (OLD.status='pending' AND NEW.status IN ('paid','rejected','revoked','refunded')) OR
   (OLD.status='paid' AND NEW.status IN ('revoked','refunded')) OR
   (OLD.status IN ('rejected','revoked') AND NEW.status='refunded')) THEN
   RAISE EXCEPTION 'Terminal purchases cannot be reactivated' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER library_purchase_guard BEFORE INSERT OR UPDATE ON sliper.library_purchases FOR EACH ROW EXECUTE FUNCTION sliper.guard_library_purchase();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_library_purchase_audit() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF ROW(NEW.id,NEW.purchase_id,NEW.action,NEW.note,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.purchase_id,OLD.action,OLD.note,OLD.created_at)
  OR (NEW.actor_id IS DISTINCT FROM OLD.actor_id AND NEW.actor_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Purchase audit is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER library_purchase_audit_guard BEFORE UPDATE ON sliper.library_purchase_audit FOR EACH ROW EXECUTE FUNCTION sliper.guard_library_purchase_audit();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_library_purchase_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Webhook receipt is immutable' USING ERRCODE='23514';
END; $$;
--> statement-breakpoint
CREATE TRIGGER library_purchase_receipt_guard BEFORE UPDATE ON sliper.library_webhook_receipts FOR EACH ROW EXECUTE FUNCTION sliper.guard_library_purchase_receipt();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_library_purchase_dispute() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE buyer uuid; purchase_status varchar;
BEGIN
 SELECT buyer_id,status INTO buyer,purchase_status FROM sliper.library_purchases WHERE id=NEW.purchase_id;
 IF TG_OP='INSERT' THEN
  IF NEW.requester_id IS NULL OR NEW.requester_id IS DISTINCT FROM buyer OR NEW.status<>'open'
    OR NEW.seller_response<>'' OR NEW.resolved_by IS NOT NULL OR NEW.resolution_note<>'' THEN
   RAISE EXCEPTION 'Disputes start as buyer claims' USING ERRCODE='23514';
  END IF;
 ELSE
  IF ROW(NEW.id,NEW.purchase_id,NEW.kind,NEW.body,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.purchase_id,OLD.kind,OLD.body,OLD.created_at)
   OR (NEW.requester_id IS DISTINCT FROM OLD.requester_id AND NEW.requester_id IS NOT NULL)
   OR (OLD.seller_response<>'' AND NEW.seller_response IS DISTINCT FROM OLD.seller_response) THEN
   RAISE EXCEPTION 'Submitted dispute and seller response are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'open' AND (ROW(NEW.status,NEW.seller_response,NEW.outcome,NEW.resolution_note,NEW.resolved_at,NEW.updated_at)
    IS DISTINCT FROM ROW(OLD.status,OLD.seller_response,OLD.outcome,OLD.resolution_note,OLD.resolved_at,OLD.updated_at)
    OR (NEW.resolved_by IS DISTINCT FROM OLD.resolved_by AND NEW.resolved_by IS NOT NULL)) THEN
   RAISE EXCEPTION 'Final dispute is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='open' AND NEW.status<>'open' THEN
   IF NEW.resolved_by IS NULL OR (NEW.status='withdrawn' AND NEW.resolved_by IS DISTINCT FROM NEW.requester_id)
    OR (NEW.status='resolved' AND NOT EXISTS(SELECT 1 FROM sliper.staff_roles s WHERE s.user_id=NEW.resolved_by))
    OR (NEW.outcome='refund_confirmed' AND purchase_status<>'refunded')
    OR (NEW.outcome='revoke' AND purchase_status IN ('pending','paid')) THEN
    RAISE EXCEPTION 'Dispute resolution must match the responsible actor and purchase' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER library_purchase_dispute_guard BEFORE INSERT OR UPDATE ON sliper.library_purchase_disputes FOR EACH ROW EXECUTE FUNCTION sliper.guard_library_purchase_dispute();
--> statement-breakpoint
REVOKE ALL ON sliper.library_purchases,sliper.library_purchase_audit,sliper.library_webhook_receipts,sliper.library_purchase_disputes FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_library_purchase(),sliper.guard_library_purchase_audit(),sliper.guard_library_purchase_receipt(),sliper.guard_library_purchase_dispute() FROM PUBLIC,anon,authenticated;
