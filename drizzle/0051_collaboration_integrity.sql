CREATE FUNCTION sliper.guard_library_suggestion() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE base sliper.library_versions%ROWTYPE; released sliper.library_versions%ROWTYPE; host uuid;
BEGIN
 SELECT * INTO base FROM sliper.library_versions WHERE id=NEW.base_version_id;
 SELECT owner_id INTO host FROM sliper.library_entries WHERE id=NEW.entry_id;
 IF base.entry_id IS DISTINCT FROM NEW.entry_id THEN RAISE EXCEPTION 'Suggestion base must belong to entry' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'pending' OR NEW.proposer_id IS NULL OR NEW.proposer_id=host OR NEW.decided_by IS NOT NULL THEN
   RAISE EXCEPTION 'Suggestions start as member proposals' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.entry_id,NEW.base_version_id,NEW.field,NEW.replacement,NEW.reason,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.entry_id,OLD.base_version_id,OLD.field,OLD.replacement,OLD.reason,OLD.created_at)
   OR (NEW.proposer_id IS DISTINCT FROM OLD.proposer_id AND NEW.proposer_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Submitted suggestion is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'pending' AND (ROW(NEW.status,NEW.decision_note,NEW.decided_at,NEW.published_version_id,NEW.updated_at)
     IS DISTINCT FROM ROW(OLD.status,OLD.decision_note,OLD.decided_at,OLD.published_version_id,OLD.updated_at)
     OR (NEW.decided_by IS DISTINCT FROM OLD.decided_by AND NEW.decided_by IS NOT NULL)) THEN
   RAISE EXCEPTION 'Final suggestion decision is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status='pending' AND NEW.status<>'pending' THEN
   IF NEW.decided_by IS NULL OR (NEW.status='withdrawn' AND NEW.decided_by IS DISTINCT FROM NEW.proposer_id)
    OR (NEW.status IN ('approved','rejected') AND NEW.decided_by IS DISTINCT FROM host) THEN
    RAISE EXCEPTION 'Suggestion decision must belong to responsible member' USING ERRCODE='23514'; END IF;
   IF NEW.status='approved' THEN
    SELECT * INTO released FROM sliper.library_versions WHERE id=NEW.published_version_id;
    IF released.entry_id IS DISTINCT FROM NEW.entry_id OR released.number IS DISTINCT FROM base.number+1
     OR released.publisher_id IS DISTINCT FROM NEW.decided_by
     OR released.content IS DISTINCT FROM jsonb_set(base.content,ARRAY[NEW.field],to_jsonb(NEW.replacement)) THEN
     RAISE EXCEPTION 'Approval must publish the exact proposed revision' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER library_suggestion_guard BEFORE INSERT OR UPDATE ON sliper.library_suggestions
 FOR EACH ROW EXECUTE FUNCTION sliper.guard_library_suggestion();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_library_discussion() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.entry_id,NEW.post_id,NEW.version_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.entry_id,OLD.post_id,OLD.version_id,OLD.created_at)
   OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN
   RAISE EXCEPTION 'Discussion source cannot change' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM sliper.library_versions v JOIN sliper.library_entries e ON e.id=v.entry_id
    JOIN sliper.posts p ON p.id=NEW.post_id WHERE v.id=NEW.version_id AND v.entry_id=NEW.entry_id
    AND p.kind='이야기' AND p.category_slug::text IN ('knowledge','lab') AND p.status='published'
    AND (NEW.created_by=p.author_id OR NEW.created_by=e.owner_id)) THEN
   RAISE EXCEPTION 'Discussion must use an exact entry edition and responsible member' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER library_discussion_guard BEFORE INSERT OR UPDATE ON sliper.library_discussion_links
 FOR EACH ROW EXECUTE FUNCTION sliper.guard_library_discussion();
--> statement-breakpoint
REVOKE ALL ON sliper.library_suggestions,sliper.library_discussion_links FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_library_suggestion(),sliper.guard_library_discussion() FROM PUBLIC,anon,authenticated;
