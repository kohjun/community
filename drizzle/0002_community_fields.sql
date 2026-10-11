CREATE TYPE "sliper"."post_kind" AS ENUM('모집', '후기', '이야기');--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "kind" "sliper"."post_kind" DEFAULT '이야기' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "location" varchar(120);--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "event_date" varchar(120);