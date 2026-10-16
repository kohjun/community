CREATE FUNCTION sliper.guard_operations_metadata() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE buyer uuid; seller uuid;
BEGIN
 IF TG_OP='INSERT' THEN NEW.revision:=1;
 ELSE
  NEW.revision:=OLD.revision+1;
  IF OLD.review_started_at IS NOT NULL AND NEW.review_started_at IS DISTINCT FROM OLD.review_started_at THEN
   RAISE EXCEPTION 'Review start is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'open' AND (ROW(NEW.review_started_at,NEW.due_at) IS DISTINCT FROM ROW(OLD.review_started_at,OLD.due_at)
    OR (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL)) THEN
   RAISE EXCEPTION 'Completed case triage is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME<>'safety_reports' AND OLD.status='open' THEN
   NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
  END IF;
 END IF;
 IF NEW.assigned_to IS NOT NULL AND (TG_OP='INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) AND
  (NOT EXISTS(SELECT 1 FROM sliper.staff_roles s WHERE s.user_id=NEW.assigned_to)
   OR EXISTS(SELECT 1 FROM sliper.member_safety ms WHERE ms.user_id=NEW.assigned_to AND (ms.status='closed' OR
    (ms.status='suspended' AND (ms.suspended_until IS NULL OR ms.suspended_until>statement_timestamp()))))) THEN
  RAISE EXCEPTION 'Assigned operator must be active staff' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='library_purchase_disputes' THEN
  SELECT p.buyer_id,p.seller_id INTO buyer,seller FROM sliper.library_purchases p WHERE p.id=NEW.purchase_id;
  IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to IN (buyer,seller) THEN
   RAISE EXCEPTION 'Transaction parties cannot triage their own dispute' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='open' AND NEW.status='resolved' AND
   (NEW.resolved_by IS NULL OR NOT EXISTS(SELECT 1 FROM sliper.staff_roles s WHERE s.user_id=NEW.resolved_by) OR NEW.resolved_by IN (buyer,seller) OR EXISTS(SELECT 1 FROM sliper.member_safety ms WHERE ms.user_id=NEW.resolved_by AND
    (ms.status='closed' OR (ms.status='suspended' AND (ms.suspended_until IS NULL OR ms.suspended_until>statement_timestamp()))))) THEN
   RAISE EXCEPTION 'Dispute resolution requires a neutral active operator' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER operations_metadata_guard BEFORE INSERT OR UPDATE ON sliper.safety_reports FOR EACH ROW EXECUTE FUNCTION sliper.guard_operations_metadata();
--> statement-breakpoint
CREATE TRIGGER operations_metadata_guard BEFORE INSERT OR UPDATE ON sliper.support_tickets FOR EACH ROW EXECUTE FUNCTION sliper.guard_operations_metadata();
--> statement-breakpoint
CREATE TRIGGER operations_metadata_guard BEFORE INSERT OR UPDATE ON sliper.library_purchase_disputes FOR EACH ROW EXECUTE FUNCTION sliper.guard_operations_metadata();
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_operations_metadata() FROM PUBLIC,anon,authenticated;
