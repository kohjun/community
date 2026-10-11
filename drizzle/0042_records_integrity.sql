CREATE OR REPLACE FUNCTION sliper.guard_media_ownership() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.uploader_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in uploader is required' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.object_key IS DISTINCT FROM OLD.object_key OR NEW.storage_backend IS DISTINCT FROM OLD.storage_backend THEN
      RAISE EXCEPTION 'Media identity cannot change' USING ERRCODE = '23514';
    END IF;
    IF NEW.uploader_id IS DISTINCT FROM OLD.uploader_id AND NEW.uploader_id IS NOT NULL THEN
      RAISE EXCEPTION 'Media ownership cannot be reassigned' USING ERRCODE = '23514';
    END IF;
    IF NEW.uploader_id IS NULL AND (NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.record_post_id IS DISTINCT FROM OLD.record_post_id) THEN
      RAISE EXCEPTION 'Orphaned media cannot be attached to another post' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Null ownership is permitted after profile deletion (ON DELETE SET NULL).
  IF NEW.post_id IS NOT NULL AND NEW.uploader_id IS NOT NULL THEN
    PERFORM 1 FROM sliper.posts WHERE id = NEW.post_id AND author_id = NEW.uploader_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Media must belong to the post author' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.record_post_id IS NOT NULL AND NEW.uploader_id IS NOT NULL THEN
    PERFORM 1 FROM sliper.event_records WHERE post_id=NEW.record_post_id AND owner_id=NEW.uploader_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Media must belong to the record author' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_video_ownership() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.uploader_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in uploader is required' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.object_key IS DISTINCT FROM OLD.object_key OR NEW.storage_backend IS DISTINCT FROM OLD.storage_backend
      OR NEW.content_type IS DISTINCT FROM OLD.content_type OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
      OR NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds THEN
      RAISE EXCEPTION 'Video identity and derivative metadata cannot change' USING ERRCODE = '23514';
    END IF;
    IF NEW.uploader_id IS DISTINCT FROM OLD.uploader_id AND NEW.uploader_id IS NOT NULL THEN
      RAISE EXCEPTION 'Video ownership cannot be reassigned' USING ERRCODE = '23514';
    END IF;
    IF NEW.uploader_id IS NULL AND (NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.record_post_id IS DISTINCT FROM OLD.record_post_id) THEN
      RAISE EXCEPTION 'Orphaned video cannot be attached to another post' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.post_id IS NOT NULL AND NEW.uploader_id IS NOT NULL THEN
    PERFORM 1 FROM sliper.posts WHERE id = NEW.post_id AND author_id = NEW.uploader_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Video must belong to the post author' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.record_post_id IS NOT NULL AND NEW.uploader_id IS NOT NULL THEN
    PERFORM 1 FROM sliper.event_records WHERE post_id=NEW.record_post_id AND owner_id=NEW.uploader_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Video must belong to the record author' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION sliper.guard_event_record_identity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
 OR (NEW.owner_id IS DISTINCT FROM OLD.owner_id AND NEW.owner_id IS NOT NULL) THEN
 RAISE EXCEPTION 'Event record snapshot and identity are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER event_record_identity_guard BEFORE UPDATE ON sliper.event_records FOR EACH ROW EXECUTE FUNCTION sliper.guard_event_record_identity();
--> statement-breakpoint
CREATE FUNCTION sliper.audit_event_result() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.presence IS NOT DISTINCT FROM OLD.presence AND NEW.outcome IS NOT DISTINCT FROM OLD.outcome
 AND NEW.observed_role IS NOT DISTINCT FROM OLD.observed_role AND NEW.reason IS NOT DISTINCT FROM OLD.reason THEN RETURN NEW; END IF;
 INSERT INTO sliper.event_result_revisions(application_id,post_id,user_id,recorder_id,"before","after",reason)
 VALUES(NEW.application_id,NEW.post_id,NEW.user_id,NEW.recorder_id,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW),NEW.reason);
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER event_result_audit AFTER INSERT OR UPDATE ON sliper.event_results FOR EACH ROW EXECUTE FUNCTION sliper.audit_event_result();
--> statement-breakpoint
INSERT INTO sliper.event_result_revisions(application_id,post_id,user_id,recorder_id,"before","after",reason,legacy,created_at)
 SELECT application_id,post_id,user_id,recorder_id,NULL,to_jsonb(result),reason,true,updated_at FROM sliper.event_results result;
--> statement-breakpoint
CREATE FUNCTION sliper.guard_result_revision() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Result revisions cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-'recorder_id') IS DISTINCT FROM (to_jsonb(OLD)-'recorder_id') OR NEW.recorder_id IS NOT NULL THEN
 RAISE EXCEPTION 'Result revisions are append-only' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER result_revision_guard BEFORE UPDATE OR DELETE ON sliper.event_result_revisions FOR EACH ROW EXECUTE FUNCTION sliper.guard_result_revision();
--> statement-breakpoint
INSERT INTO sliper.event_credits(post_id,user_id,role,note,confirmed_by,status,legacy_contribution_id,created_at)
 SELECT post_id,user_id,CASE WHEN role='기획 파트너' THEN '기획자' ELSE role END,note,checked_by,'pending',id,created_at
 FROM sliper.crew_contributions WHERE checked_by IS NOT NULL AND checked_by<>user_id
 ON CONFLICT(post_id,user_id,role) DO NOTHING;
--> statement-breakpoint
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.event_records,sliper.event_credits,sliper.event_record_links,sliper.event_result_revisions,sliper.portfolio_preferences FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_event_record_identity(),sliper.audit_event_result(),sliper.guard_result_revision() FROM PUBLIC,anon,authenticated;
