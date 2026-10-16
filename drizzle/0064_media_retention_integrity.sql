CREATE FUNCTION sliper.guard_media_retention_job() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE source record;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.asset_kind='image' THEN
   SELECT id,post_id,record_post_id,record_origin_post_id,unattached_since,object_key,storage_backend INTO source FROM sliper.media_assets WHERE id=NEW.asset_id FOR UPDATE;
  ELSIF NEW.asset_kind='video' THEN
   SELECT id,post_id,record_post_id,record_origin_post_id,unattached_since,object_key,storage_backend INTO source FROM sliper.video_assets WHERE id=NEW.asset_id FOR UPDATE;
  ELSE RAISE EXCEPTION 'Invalid cleanup kind' USING ERRCODE='23514'; END IF;
  IF source.id IS NULL OR source.post_id IS NOT NULL OR source.record_post_id IS NOT NULL OR source.record_origin_post_id IS NOT NULL OR source.unattached_since IS NULL OR source.unattached_since>statement_timestamp()-interval '30 days'
   OR NEW.object_key IS DISTINCT FROM source.object_key OR NEW.storage_backend IS DISTINCT FROM source.storage_backend OR NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.removed_at IS NOT NULL THEN
   RAISE EXCEPTION 'Cleanup requires an expired unattached source' USING ERRCODE='23514';
  END IF;
 ELSE
  IF ROW(NEW.id,NEW.asset_kind,NEW.asset_id,NEW.object_key,NEW.storage_backend,NEW.policy_version,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.asset_kind,OLD.asset_id,OLD.object_key,OLD.storage_backend,OLD.policy_version,OLD.created_at) THEN
   RAISE EXCEPTION 'Cleanup identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('failed','removed') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal cleanup is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='processing' THEN
   IF NOT (OLD.status='pending' OR (OLD.status='processing' AND OLD.lease_until<=statement_timestamp())) OR NEW.attempts<>OLD.attempts+1 OR NEW.lock_token IS NULL OR NEW.lease_until<=statement_timestamp() THEN
    RAISE EXCEPTION 'Cleanup claim requires an available lease' USING ERRCODE='23514';
   END IF;
  ELSIF OLD.status='pending' AND NEW.status<>'pending' THEN RAISE EXCEPTION 'Cleanup must be claimed first' USING ERRCODE='23514';
  ELSIF OLD.status='processing' AND NEW.attempts<>OLD.attempts THEN RAISE EXCEPTION 'Cleanup completion preserves attempts' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
-- Added column defaults give legacy rows a fresh grace period; linked rows remain excluded.
CREATE FUNCTION sliper.guard_media_retention_parent() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE kind text; reservation sliper.media_retention_jobs%ROWTYPE;
BEGIN
 kind:=CASE WHEN TG_TABLE_NAME='media_assets' THEN 'image' ELSE 'video' END;
 IF NEW.post_id IS NOT NULL OR NEW.record_post_id IS NOT NULL OR NEW.record_origin_post_id IS NOT NULL THEN NEW.unattached_since:=NULL;
 ELSIF TG_OP='UPDATE' AND (OLD.post_id IS NOT NULL OR OLD.record_post_id IS NOT NULL OR OLD.record_origin_post_id IS NOT NULL) THEN NEW.unattached_since:=clock_timestamp();
 ELSIF NEW.unattached_since IS NULL THEN NEW.unattached_since:=clock_timestamp();
 END IF;
 SELECT * INTO reservation FROM sliper.media_retention_jobs WHERE asset_kind=kind AND asset_id=NEW.id;
 IF reservation.id IS NOT NULL AND (NEW.status<>'pending' OR NEW.post_id IS NOT NULL OR NEW.record_post_id IS NOT NULL OR NEW.record_origin_post_id IS NOT NULL OR NEW.object_key IS DISTINCT FROM reservation.object_key OR NEW.storage_backend IS DISTINCT FROM reservation.storage_backend) THEN
  RAISE EXCEPTION 'Reserved cleanup media cannot be attached or revived' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER retention_job_guard BEFORE INSERT OR UPDATE ON sliper.media_retention_jobs FOR EACH ROW EXECUTE FUNCTION sliper.guard_media_retention_job();
--> statement-breakpoint
CREATE TRIGGER media_retention_parent_guard BEFORE INSERT OR UPDATE ON sliper.media_assets FOR EACH ROW EXECUTE FUNCTION sliper.guard_media_retention_parent();
--> statement-breakpoint
CREATE TRIGGER media_retention_parent_guard BEFORE INSERT OR UPDATE ON sliper.video_assets FOR EACH ROW EXECUTE FUNCTION sliper.guard_media_retention_parent();
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.media_retention_jobs FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_media_retention_job(),sliper.guard_media_retention_parent() FROM PUBLIC,anon,authenticated;
