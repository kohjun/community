ALTER TABLE "sliper"."event_settings" ADD COLUMN "approval_mode" varchar(16) DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE sliper.event_settings ADD CONSTRAINT approval_mode_values CHECK(approval_mode IN ('manual','automatic'));
