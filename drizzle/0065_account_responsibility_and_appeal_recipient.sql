ALTER TABLE "sliper"."moderation_audit" ADD COLUMN "affected_user_id" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."moderation_audit" ADD CONSTRAINT "moderation_audit_affected_user_id_profiles_id_fk" FOREIGN KEY ("affected_user_id") REFERENCES "sliper"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_audit_affected_idx" ON "sliper"."moderation_audit" USING btree ("affected_user_id","created_at");--> statement-breakpoint
-- Recover only historical evidence. A crew's current owner is never used for old actions.
WITH ticket_owners AS (
 SELECT original_action_id,min(user_id::text)::uuid AS user_id FROM sliper.support_tickets
 WHERE original_action_id IS NOT NULL GROUP BY original_action_id HAVING count(DISTINCT user_id)=1
)
UPDATE sliper.moderation_audit a SET affected_user_id=t.user_id FROM ticket_owners t
WHERE a.id=t.original_action_id AND a.action IN ('warn','suspend','hide') AND a.target_type<>'crew'
 AND sliper.appeal_action_belongs_to(a.id,t.user_id);
--> statement-breakpoint
WITH evidence AS (
 SELECT a.id,coalesce(
   (SELECT min(c.actor_id::text)::uuid FROM sliper.crew_activity c
    WHERE c.crew_id=a.target_id AND c.kind='ownership_transferred' AND c.created_at=
     (SELECT min(x.created_at) FROM sliper.crew_activity x WHERE x.crew_id=a.target_id AND x.kind='ownership_transferred' AND x.created_at>a.created_at)
    HAVING count(DISTINCT c.actor_id)=1 AND bool_and(c.actor_id IS NOT NULL)),
   (SELECT min(c.actor_id::text)::uuid FROM sliper.crew_activity c
    WHERE c.crew_id=a.target_id AND c.kind='created' AND c.created_at<a.created_at
     AND NOT EXISTS(SELECT 1 FROM sliper.crew_activity x WHERE x.crew_id=a.target_id AND x.kind='ownership_transferred' AND x.created_at<=a.created_at)
    HAVING count(*)=1 AND bool_and(c.actor_id IS NOT NULL))
  ) AS recipient
 FROM sliper.moderation_audit a WHERE a.target_type='crew' AND a.action IN ('warn','suspend','hide')
)
UPDATE sliper.moderation_audit a SET affected_user_id=e.recipient FROM evidence e
WHERE a.id=e.id AND e.recipient IS NOT NULL;
--> statement-breakpoint
-- A legacy link without historical recipient evidence becomes an ordinary private inquiry.
-- Its member text and replies are preserved; it grants no access to an unverified action.
DROP TRIGGER member_appeal_ticket_guard ON sliper.support_tickets;
--> statement-breakpoint
UPDATE sliper.support_tickets t SET original_action_id=NULL
WHERE t.original_action_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM sliper.moderation_audit a WHERE a.id=t.original_action_id AND a.affected_user_id=t.user_id
);
--> statement-breakpoint
CREATE TRIGGER member_appeal_ticket_guard BEFORE INSERT OR UPDATE ON sliper.support_tickets
 FOR EACH ROW EXECUTE FUNCTION sliper.guard_member_appeal_ticket();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.appeal_action_belongs_to(action_id uuid,member_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM sliper.moderation_audit a WHERE a.id=action_id
  AND a.action IN ('warn','suspend','hide') AND a.affected_user_id=member_id);
$$;
--> statement-breakpoint
CREATE FUNCTION sliper.guard_moderation_recipient() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE recipient uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.affected_user_id IS DISTINCT FROM OLD.affected_user_id THEN
   RAISE EXCEPTION 'Original moderation recipient is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.action IN ('warn','suspend','hide') THEN
  CASE NEW.target_type
   WHEN 'post' THEN SELECT p.author_id INTO recipient FROM sliper.posts p WHERE p.id=NEW.target_id FOR SHARE;
   WHEN 'comment' THEN SELECT c.author_id INTO recipient FROM sliper.comments c WHERE c.id=NEW.target_id FOR SHARE;
   WHEN 'venue' THEN SELECT v.owner_id INTO recipient FROM sliper.community_venues v WHERE v.id=NEW.target_id FOR SHARE;
   WHEN 'player' THEN SELECT p.id INTO recipient FROM sliper.profiles p WHERE p.public_id=NEW.target_id FOR SHARE;
   WHEN 'crew' THEN SELECT c.owner_id INTO recipient FROM sliper.crews c WHERE c.id=NEW.target_id FOR SHARE;
   WHEN 'record' THEN SELECT r.owner_id INTO recipient FROM sliper.event_records r WHERE r.post_id=NEW.target_id FOR SHARE;
   WHEN 'library' THEN SELECT l.owner_id INTO recipient FROM sliper.library_entries l WHERE l.id=NEW.target_id FOR SHARE;
   ELSE recipient:=NULL;
  END CASE;
  IF NEW.affected_user_id IS NOT NULL AND NEW.affected_user_id IS DISTINCT FROM recipient THEN
   RAISE EXCEPTION 'Moderation recipient changed; reload original target' USING ERRCODE='23514';
  END IF;
  NEW.affected_user_id:=recipient;
 ELSIF NEW.affected_user_id IS NOT NULL THEN
  RAISE EXCEPTION 'Only original member actions have an affected recipient' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER moderation_recipient_guard BEFORE INSERT OR UPDATE ON sliper.moderation_audit
 FOR EACH ROW EXECUTE FUNCTION sliper.guard_moderation_recipient();
--> statement-breakpoint
-- This is separate from recruitment visibility. An ended event may retain paid attendance.
CREATE FUNCTION sliper.member_has_host_responsibility(member_id uuid) RETURNS boolean LANGUAGE sql VOLATILE SET search_path='' AS $$
 WITH events AS (
  SELECT p.id,p.status,p.kind,e.open,e.starts_at,e.ends_at,e.completed_at,l.cancelled_at,
   EXISTS(SELECT 1 FROM sliper.event_applications a WHERE a.post_id=p.id
    AND (a.status IN ('confirmed','review','pending_approval') OR (a.status='pending_payment' AND a.expires_at>statement_timestamp()))) AS participants,
   (EXISTS(SELECT 1 FROM sliper.event_applications a JOIN sliper.payment_orders o ON o.application_id=a.id
     WHERE a.post_id=p.id AND o.amount_krw>0 AND (o.state='paid' OR (o.state='refunded' AND coalesce(o.refunded_amount_krw,0)<o.amount_krw)))
    OR EXISTS(SELECT 1 FROM sliper.external_receipts r WHERE r.post_id=p.id AND r.amount_krw>0
     AND (r.state='paid' OR (r.state='refunded' AND coalesce(r.refunded_amount_krw,0)<r.amount_krw)))) AS unpaid
  FROM sliper.posts p JOIN sliper.event_settings e ON e.post_id=p.id
  LEFT JOIN sliper.event_lifecycle l ON l.post_id=p.id WHERE p.author_id=member_id
 )
 SELECT EXISTS(SELECT 1 FROM events e WHERE
   (e.cancelled_at IS NOT NULL AND e.unpaid)
   OR (e.cancelled_at IS NULL AND e.completed_at IS NULL AND (e.ends_at IS NULL OR e.ends_at>statement_timestamp())
    AND ((e.status='published' AND e.kind='모집' AND (e.open OR e.starts_at IS NOT NULL)) OR e.participants OR e.unpaid))
 ) OR EXISTS(
  SELECT 1 FROM sliper.refund_requests r JOIN sliper.posts p ON p.id=r.post_id
  WHERE p.author_id=member_id AND r.state='pending'
 );
$$;
--> statement-breakpoint
CREATE FUNCTION sliper.guard_host_account_closure() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.status='closed' AND (TG_OP='INSERT' OR OLD.status<>'closed') THEN
  PERFORM 1 FROM sliper.profiles p WHERE p.id=NEW.user_id FOR UPDATE;
  IF sliper.member_has_host_responsibility(NEW.user_id) THEN
   RAISE EXCEPTION 'Host must settle ongoing events and refunds before withdrawal' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER host_account_closure_guard BEFORE INSERT OR UPDATE ON sliper.member_safety
 FOR EACH ROW EXECUTE FUNCTION sliper.guard_host_account_closure();
--> statement-breakpoint
-- At commit, serialize any newly created responsibility with the same host profile lock as withdrawal.
-- Safe settlements remain possible for a closed host; a new ongoing event or unpaid refund cannot commit.
CREATE FUNCTION sliper.guard_host_responsibility_write() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE event_id uuid; host_id uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  CASE TG_TABLE_NAME
   WHEN 'posts' THEN
    IF NEW.author_id IS NOT DISTINCT FROM OLD.author_id AND NEW.kind=OLD.kind AND NEW.status=OLD.status THEN RETURN NULL; END IF;
   WHEN 'event_settings' THEN
    IF NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at AND NEW.ends_at IS NOT DISTINCT FROM OLD.ends_at
     AND NEW.open=OLD.open AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN RETURN NULL; END IF;
   WHEN 'event_applications' THEN
    IF NEW.post_id=OLD.post_id AND NEW.status=OLD.status AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at THEN RETURN NULL; END IF;
   -- Parent identities/amounts are already immutable under 0007/0013/0028 source guards.
   WHEN 'payment_orders' THEN
    IF NEW.state=OLD.state AND NEW.refunded_amount_krw IS NOT DISTINCT FROM OLD.refunded_amount_krw THEN RETURN NULL; END IF;
   WHEN 'external_receipts' THEN
    IF NEW.state=OLD.state AND NEW.refunded_amount_krw IS NOT DISTINCT FROM OLD.refunded_amount_krw THEN RETURN NULL; END IF;
   WHEN 'refund_requests' THEN
    IF NEW.state=OLD.state THEN RETURN NULL; END IF;
   WHEN 'event_lifecycle' THEN
    IF NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at THEN RETURN NULL; END IF;
   ELSE NULL;
  END CASE;
 END IF;
 IF TG_TABLE_NAME='posts' THEN event_id:=NEW.id;
 ELSIF TG_TABLE_NAME='payment_orders' THEN
  SELECT a.post_id INTO event_id FROM sliper.event_applications a WHERE a.id=NEW.application_id;
 ELSE event_id:=NEW.post_id;
 END IF;
 SELECT p.author_id INTO host_id FROM sliper.posts p WHERE p.id=event_id;
 IF host_id IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM sliper.profiles p WHERE p.id=host_id FOR SHARE;
 IF EXISTS(SELECT 1 FROM sliper.member_safety s WHERE s.user_id=host_id AND s.status='closed')
  AND sliper.member_has_host_responsibility(host_id) THEN
  RAISE EXCEPTION 'Closed host cannot acquire ongoing event responsibility' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END; $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER host_responsibility_guard AFTER INSERT OR UPDATE ON sliper.posts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sliper.guard_host_responsibility_write();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER host_responsibility_guard AFTER INSERT OR UPDATE ON sliper.event_settings
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sliper.guard_host_responsibility_write();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER host_responsibility_guard AFTER INSERT OR UPDATE ON sliper.event_lifecycle
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sliper.guard_host_responsibility_write();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER host_responsibility_guard AFTER INSERT OR UPDATE ON sliper.event_applications
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sliper.guard_host_responsibility_write();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER host_responsibility_guard AFTER INSERT OR UPDATE ON sliper.payment_orders
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sliper.guard_host_responsibility_write();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER host_responsibility_guard AFTER INSERT OR UPDATE ON sliper.external_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sliper.guard_host_responsibility_write();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER host_responsibility_guard AFTER INSERT OR UPDATE ON sliper.refund_requests
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sliper.guard_host_responsibility_write();
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_moderation_recipient(),sliper.member_has_host_responsibility(uuid),sliper.guard_host_account_closure(),sliper.guard_host_responsibility_write() FROM PUBLIC,anon,authenticated;
