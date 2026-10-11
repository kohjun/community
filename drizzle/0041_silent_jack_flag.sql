ALTER TABLE "sliper"."content_restrictions" DROP CONSTRAINT "restriction_target_type";--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" DROP CONSTRAINT "report_target_type";--> statement-breakpoint
ALTER TABLE "sliper"."inbox_items" DROP CONSTRAINT "inbox_kind";--> statement-breakpoint
ALTER TABLE "sliper"."content_restrictions" ADD CONSTRAINT "restriction_target_type" CHECK ("sliper"."content_restrictions"."target_type" in ('post','comment','venue','crew','record','library'));--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ADD CONSTRAINT "report_target_type" CHECK ("sliper"."safety_reports"."target_type" in ('post','comment','venue','crew','player','record','library'));--> statement-breakpoint
ALTER TABLE "sliper"."inbox_items" ADD CONSTRAINT "inbox_kind" CHECK ("sliper"."inbox_items"."kind" in ('comments','announcements','participation','subscriptions','reminders','credits','records'));