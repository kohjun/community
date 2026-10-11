-- Public data is served through Next.js DTOs, not PostgREST.
-- The owner connection is trusted; RLS does not authorize an owner connection.
REVOKE ALL ON SCHEMA sliper FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA sliper FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA sliper REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION sliper.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER profiles_touch BEFORE UPDATE ON sliper.profiles
FOR EACH ROW EXECUTE FUNCTION sliper.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER posts_touch BEFORE UPDATE ON sliper.posts
FOR EACH ROW EXECUTE FUNCTION sliper.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER comments_touch BEFORE UPDATE ON sliper.comments
FOR EACH ROW EXECUTE FUNCTION sliper.touch_updated_at();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_content() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.author_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in author is required' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Content identity and creation date are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.author_id IS DISTINCT FROM OLD.author_id AND NEW.author_id IS NOT NULL THEN
      RAISE EXCEPTION 'Content ownership cannot be reassigned' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'deleted' AND NEW.status <> 'deleted' THEN
      RAISE EXCEPTION 'Deleted content cannot be republished' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'deleted' THEN
    NEW.body_markdown := '';
    NEW.deleted_at := coalesce(NEW.deleted_at, statement_timestamp());
    IF TG_TABLE_NAME = 'posts' THEN
      NEW.title := '삭제된 게시글';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER posts_guard BEFORE INSERT OR UPDATE ON sliper.posts
FOR EACH ROW EXECUTE FUNCTION sliper.guard_content();
--> statement-breakpoint
CREATE TRIGGER comments_guard BEFORE INSERT OR UPDATE ON sliper.comments
FOR EACH ROW EXECUTE FUNCTION sliper.guard_content();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_comment_tree() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
      RAISE EXCEPTION 'Comment post and parent are immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.parent_id IS NOT NULL THEN
    -- Parents must already exist and edges cannot be moved later. This produces
    -- an acyclic tree even for multi-row INSERTs and concurrent requests, with
    -- no product depth limit or recursive scan of every ancestor.
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'A comment cannot reply to itself' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM sliper.comments
      WHERE id = NEW.parent_id AND post_id = NEW.post_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent must already exist in the same post' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER comments_tree_guard BEFORE INSERT OR UPDATE ON sliper.comments
FOR EACH ROW EXECUTE FUNCTION sliper.guard_comment_tree();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_media_ownership() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.uploader_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in uploader is required' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.object_key IS DISTINCT FROM OLD.object_key THEN
      RAISE EXCEPTION 'Media identity cannot change' USING ERRCODE = '23514';
    END IF;
    IF NEW.uploader_id IS DISTINCT FROM OLD.uploader_id AND NEW.uploader_id IS NOT NULL THEN
      RAISE EXCEPTION 'Media ownership cannot be reassigned' USING ERRCODE = '23514';
    END IF;
    IF NEW.uploader_id IS NULL AND NEW.post_id IS DISTINCT FROM OLD.post_id THEN
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
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_assets_owner_guard BEFORE INSERT OR UPDATE ON sliper.media_assets
FOR EACH ROW EXECUTE FUNCTION sliper.guard_media_ownership();
--> statement-breakpoint
CREATE FUNCTION sliper.stamp_daily_view() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Daily view identities are immutable' USING ERRCODE = '23514';
  END IF;
  NEW.viewed_on := (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  NEW.created_at := statement_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER post_daily_views_stamp BEFORE INSERT OR UPDATE ON sliper.post_daily_views
FOR EACH ROW EXECUTE FUNCTION sliper.stamp_daily_view();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_comment_notification() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  source_comment sliper.comments%ROWTYPE;
  expected_recipient uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
       OR NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.comment_id IS DISTINCT FROM OLD.comment_id
       OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Only notification read state can change' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO source_comment FROM sliper.comments WHERE id = NEW.comment_id AND post_id = NEW.post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification comment must belong to its post' USING ERRCODE = '23503';
  END IF;
  IF NEW.recipient_id = source_comment.author_id THEN
    RAISE EXCEPTION 'Self notifications are not allowed' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'comment_reply' THEN
    SELECT author_id INTO expected_recipient FROM sliper.comments WHERE id = source_comment.parent_id;
  ELSE
    SELECT author_id INTO expected_recipient FROM sliper.posts WHERE id = NEW.post_id;
  END IF;
  IF expected_recipient IS NULL OR NEW.recipient_id <> expected_recipient THEN
    RAISE EXCEPTION 'Notification recipient does not match the source' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notifications_source_guard BEFORE INSERT OR UPDATE ON sliper.notifications
FOR EACH ROW EXECUTE FUNCTION sliper.guard_comment_notification();
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sliper FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA sliper REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
