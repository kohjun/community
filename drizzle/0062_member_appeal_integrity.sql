CREATE FUNCTION sliper.appeal_action_belongs_to(action_id uuid,member_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM sliper.moderation_audit a WHERE a.id=action_id AND a.action IN ('warn','suspend','hide') AND (
  (a.target_type='post' AND EXISTS(SELECT 1 FROM sliper.posts p WHERE p.id=a.target_id AND p.author_id=member_id)) OR
  (a.target_type='comment' AND EXISTS(SELECT 1 FROM sliper.comments c WHERE c.id=a.target_id AND c.author_id=member_id)) OR
  (a.target_type='venue' AND EXISTS(SELECT 1 FROM sliper.community_venues v WHERE v.id=a.target_id AND v.owner_id=member_id)) OR
  (a.target_type='player' AND EXISTS(SELECT 1 FROM sliper.profiles p WHERE p.public_id=a.target_id AND p.id=member_id)) OR
  (a.target_type='crew' AND EXISTS(SELECT 1 FROM sliper.crews c WHERE c.id=a.target_id AND c.owner_id=member_id)) OR
  (a.target_type='record' AND EXISTS(SELECT 1 FROM sliper.event_records r WHERE r.post_id=a.target_id AND r.owner_id=member_id)) OR
  (a.target_type='library' AND EXISTS(SELECT 1 FROM sliper.library_entries l WHERE l.id=a.target_id AND l.owner_id=member_id))
 ));
$$;
--> statement-breakpoint
CREATE FUNCTION sliper.guard_member_appeal_ticket() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE original_actor uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.original_action_id IS DISTINCT FROM OLD.original_action_id THEN
  RAISE EXCEPTION 'Appeal original action is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.original_action_id IS NOT NULL THEN
  IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
   RAISE EXCEPTION 'Appeal recipient is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.category<>'account' THEN RAISE EXCEPTION 'Appeal uses account support' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (NOT sliper.appeal_action_belongs_to(NEW.original_action_id,NEW.user_id)
   OR EXISTS(SELECT 1 FROM sliper.member_safety ms WHERE ms.user_id=NEW.user_id AND ms.status='closed')) THEN
   RAISE EXCEPTION 'Appeal requires its non-closed affected member' USING ERRCODE='23514';
  END IF;
  SELECT a.actor_id INTO original_actor FROM sliper.moderation_audit a WHERE a.id=NEW.original_action_id;
  IF NEW.assigned_to IS NOT NULL AND (NEW.assigned_to=original_actor OR NEW.assigned_to=NEW.user_id) THEN
   RAISE EXCEPTION 'Appeal assignment requires a neutral operator' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER member_appeal_ticket_guard BEFORE INSERT OR UPDATE ON sliper.support_tickets FOR EACH ROW EXECUTE FUNCTION sliper.guard_member_appeal_ticket();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_member_appeal_reply() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ticket sliper.support_tickets%ROWTYPE; original_actor uuid;
BEGIN
 SELECT * INTO ticket FROM sliper.support_tickets WHERE id=NEW.ticket_id;
 IF ticket.original_action_id IS NOT NULL THEN
  IF NEW.author_id IS NULL THEN RAISE EXCEPTION 'Appeal reply requires its verified sender' USING ERRCODE='23514'; END IF;
  SELECT a.actor_id INTO original_actor FROM sliper.moderation_audit a WHERE a.id=ticket.original_action_id;
  IF NEW.author_id=ticket.user_id THEN
   IF EXISTS(SELECT 1 FROM sliper.member_safety ms WHERE ms.user_id=NEW.author_id AND ms.status='closed') THEN
    RAISE EXCEPTION 'Closed member cannot append an appeal' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.author_id=original_actor OR NOT EXISTS(SELECT 1 FROM sliper.staff_roles s WHERE s.user_id=NEW.author_id)
   OR EXISTS(SELECT 1 FROM sliper.member_safety ms WHERE ms.user_id=NEW.author_id AND (ms.status='closed' OR
    (ms.status='suspended' AND (ms.suspended_until IS NULL OR ms.suspended_until>statement_timestamp())))) THEN
   RAISE EXCEPTION 'Appeal reply requires a neutral active operator' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER member_appeal_reply_guard BEFORE INSERT ON sliper.support_replies FOR EACH ROW EXECUTE FUNCTION sliper.guard_member_appeal_reply();
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.appeal_action_belongs_to(uuid,uuid),sliper.guard_member_appeal_ticket(),sliper.guard_member_appeal_reply() FROM PUBLIC,anon,authenticated;
