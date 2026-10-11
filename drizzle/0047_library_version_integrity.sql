-- Capture current legacy editions without inventing historical releases.
INSERT INTO sliper.library_versions(entry_id,number,content,change_summary,publisher_id,legacy,source_version_id,source_record_post_id)
 SELECT e.id,1,jsonb_build_object(
  'kind',e.kind,'categorySlug',e.category_slug,'title',e.title,'summary',e.summary,
  'scenario',e.scenario,'rules',e.rules,'hostGuide',e.host_guide,'materials',e.materials,
  'rounds',e.rounds,'tags',e.tags,'minPlayers',e.min_players,'maxPlayers',e.max_players,
  'durationMinutes',e.duration_minutes,'priceKRW',e.price_krw,'purchaseUrl',e.purchase_url,
  'usageTerms',e.usage_terms,'allowDerivatives',e.allow_derivatives,'allowCommercialUse',e.allow_commercial_use
 ),'기존 자료 기준본',e.owner_id,true,e.source_version_id,e.source_record_post_id
 FROM sliper.library_entries e WHERE e.status IN ('published','deleted') AND e.published_version=0
 AND NOT EXISTS(SELECT 1 FROM sliper.library_versions v WHERE v.entry_id=e.id)
 ON CONFLICT(entry_id,number) DO NOTHING;
--> statement-breakpoint
UPDATE sliper.library_entries e SET published_version=1
 WHERE e.published_version=0 AND e.status IN ('published','deleted')
 AND EXISTS(SELECT 1 FROM sliper.library_versions v WHERE v.entry_id=e.id AND v.number=1);
--> statement-breakpoint
CREATE FUNCTION sliper.guard_library_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.entry_id,NEW.number,NEW.content,NEW.change_summary,NEW.source_version_id,NEW.source_record_post_id,NEW.published_at,NEW.legacy)
    IS DISTINCT FROM ROW(OLD.id,OLD.entry_id,OLD.number,OLD.content,OLD.change_summary,OLD.source_version_id,OLD.source_record_post_id,OLD.published_at,OLD.legacy)
    OR (NEW.publisher_id IS DISTINCT FROM OLD.publisher_id AND NEW.publisher_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Published library editions are immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  IF jsonb_typeof(NEW.content)<>'object' OR char_length(btrim(NEW.change_summary))<2 OR NOT EXISTS(
   SELECT 1 FROM sliper.library_entries e WHERE e.id=NEW.entry_id AND e.kind=NEW.content->>'kind'
   AND e.source_version_id IS NOT DISTINCT FROM NEW.source_version_id
   AND e.source_record_post_id IS NOT DISTINCT FROM NEW.source_record_post_id
  ) THEN RAISE EXCEPTION 'Library edition must preserve entry kind and provenance' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER library_version_guard BEFORE INSERT OR UPDATE ON sliper.library_versions FOR EACH ROW EXECUTE FUNCTION sliper.guard_library_version();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_library_origin() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.source_version_id IS DISTINCT FROM OLD.source_version_id OR NEW.source_record_post_id IS DISTINCT FROM OLD.source_record_post_id) THEN
  RAISE EXCEPTION 'Library origin cannot be rewritten' USING ERRCODE='23514';
 END IF;
 IF NEW.source_record_post_id IS NOT NULL AND NEW.owner_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM sliper.event_records r JOIN sliper.posts p ON p.id=r.post_id
  WHERE r.post_id=NEW.source_record_post_id AND r.owner_id=NEW.owner_id AND p.author_id=NEW.owner_id
 ) THEN RAISE EXCEPTION 'Record-derived material must belong to its host' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER library_origin_guard BEFORE INSERT OR UPDATE ON sliper.library_entries FOR EACH ROW EXECUTE FUNCTION sliper.guard_library_origin();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_template_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.post_id,NEW.version_id,NEW.snapshot,NEW.created_at) IS DISTINCT FROM ROW(OLD.post_id,OLD.version_id,OLD.snapshot,OLD.created_at)
   OR (NEW.entry_id IS DISTINCT FROM OLD.entry_id AND NEW.entry_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Event operating edition is immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.version_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM sliper.library_versions v WHERE v.id=NEW.version_id AND v.entry_id=NEW.entry_id
   AND NEW.snapshot->>'versionId'=v.id::text AND NEW.snapshot->>'versionNumber'=v.number::text
  ) THEN RAISE EXCEPTION 'Event must reference an exact library edition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER template_version_guard BEFORE INSERT OR UPDATE ON sliper.template_provenance FOR EACH ROW EXECUTE FUNCTION sliper.guard_template_version();
--> statement-breakpoint
REVOKE ALL ON sliper.library_versions FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_library_version(),sliper.guard_library_origin(),sliper.guard_template_version() FROM PUBLIC,anon,authenticated;
