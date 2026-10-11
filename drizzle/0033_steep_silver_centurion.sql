ALTER TABLE "sliper"."posts" DROP CONSTRAINT "posts_body_document_shape";--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD CONSTRAINT "posts_body_document_shape" CHECK ("sliper"."posts"."body_document" is null or coalesce((jsonb_typeof("sliper"."posts"."body_document") = 'object' and "sliper"."posts"."body_document"->>'version' = '1' and "sliper"."posts"."body_document"->>'type' = 'doc' and jsonb_typeof("sliper"."posts"."body_document"->'content') = 'array' and octet_length("sliper"."posts"."body_document"::text) <= 262144), false));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_content() RETURNS trigger
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
      NEW.body_document := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
UPDATE sliper.posts SET body_document = NULL WHERE status = 'deleted' AND body_document IS NOT NULL;
