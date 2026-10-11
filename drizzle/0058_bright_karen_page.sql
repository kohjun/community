ALTER TABLE "sliper"."library_entries" ADD COLUMN "discovery_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "sliper"."library_entries" ADD CONSTRAINT "library_discovery_metadata" CHECK ("sliper"."library_entries"."discovery_metadata" is null or coalesce((jsonb_typeof("sliper"."library_entries"."discovery_metadata") = 'object'
          and "sliper"."library_entries"."discovery_metadata" ?& array['preparationDifficulty','environment','requiredStaff']
          and ("sliper"."library_entries"."discovery_metadata" - array['preparationDifficulty','environment','requiredStaff']) = '{}'::jsonb
          and ("sliper"."library_entries"."discovery_metadata"->'preparationDifficulty' = 'null'::jsonb or "sliper"."library_entries"."discovery_metadata"->>'preparationDifficulty' in ('easy','standard','advanced'))
          and ("sliper"."library_entries"."discovery_metadata"->'environment' = 'null'::jsonb or "sliper"."library_entries"."discovery_metadata"->>'environment' in ('indoor','outdoor','mixed'))
          and ("sliper"."library_entries"."discovery_metadata"->'requiredStaff' = 'null'::jsonb or (jsonb_typeof("sliper"."library_entries"."discovery_metadata"->'requiredStaff') = 'number'
            and "sliper"."library_entries"."discovery_metadata"->'requiredStaff' >= '0'::jsonb and "sliper"."library_entries"."discovery_metadata"->'requiredStaff' <= '100'::jsonb
            and "sliper"."library_entries"."discovery_metadata"->>'requiredStaff' ~ '^[0-9]+$'))), false));