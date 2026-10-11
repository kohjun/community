-- Public search reads use a parameterized literal pattern over the same indexed expression.
CREATE OR REPLACE FUNCTION sliper.search_tags(value text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT SET search_path = ''
AS $$ SELECT pg_catalog.array_to_string(value, ' ') $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.search_tags(text[]) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DO $$
DECLARE trigram_schema text;
BEGIN
  -- PGlite fixtures without pg_trgm registration retain functional ILIKE search.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_available_extensions WHERE name = 'pg_trgm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    SELECT n.nspname INTO trigram_schema
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm';
    EXECUTE pg_catalog.format(
      'CREATE INDEX posts_search_trgm_idx ON sliper.posts USING gin ((title || '' '' || body_markdown || '' '' || sliper.search_tags(tags)) %I.gin_trgm_ops) WHERE status = ''published''',
      trigram_schema
    );
    EXECUTE pg_catalog.format(
      'CREATE INDEX library_search_trgm_idx ON sliper.library_entries USING gin ((title || '' '' || summary || '' '' || sliper.search_tags(tags)) %I.gin_trgm_ops) WHERE status = ''published''',
      trigram_schema
    );
  END IF;
END;
$$;
