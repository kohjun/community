ALTER TYPE "sliper"."category_slug" ADD VALUE 'general';--> statement-breakpoint
ALTER TABLE "sliper"."categories" DROP CONSTRAINT "categories_sort_order_range";--> statement-breakpoint
ALTER TABLE "sliper"."categories" ADD CONSTRAINT "categories_sort_order_range" CHECK ("sliper"."categories"."sort_order" between 0 and 12);