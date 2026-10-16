ALTER TABLE "sliper"."library_purchase_disputes" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_disputes" ADD COLUMN "review_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_disputes" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_disputes" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ADD COLUMN "review_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."support_tickets" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "sliper"."support_tickets" ADD COLUMN "review_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."support_tickets" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."support_tickets" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_disputes" ADD CONSTRAINT "library_purchase_disputes_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ADD CONSTRAINT "safety_reports_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_disputes" ADD CONSTRAINT "dispute_operation_revision" CHECK ("sliper"."library_purchase_disputes"."revision">0);--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ADD CONSTRAINT "report_operation_revision" CHECK ("sliper"."safety_reports"."revision">0);--> statement-breakpoint
ALTER TABLE "sliper"."support_tickets" ADD CONSTRAINT "support_operation_revision" CHECK ("sliper"."support_tickets"."revision">0);