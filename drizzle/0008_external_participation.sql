CREATE TABLE "sliper"."external_receipts" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"reference" varchar(160) NOT NULL,
	"amount_krw" integer NOT NULL,
	"provider" varchar(40) NOT NULL,
	"verification" varchar(16) NOT NULL,
	"verified_by" uuid,
	"state" varchar(16) DEFAULT 'paid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_external_receipt_unique" UNIQUE("post_id","reference"),
	CONSTRAINT "external_receipt_amount" CHECK ("sliper"."external_receipts"."amount_krw" between 0 and 10000000),
	CONSTRAINT "external_receipt_state" CHECK ("sliper"."external_receipts"."state" in ('paid','refunded')),
	CONSTRAINT "external_receipt_verification" CHECK ("sliper"."external_receipts"."verification" in ('manual','integration'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."external_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."external_webhook_events" (
	"provider" varchar(40) NOT NULL,
	"event_id" varchar(160) NOT NULL,
	"post_id" uuid NOT NULL,
	"digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_webhook_events_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."external_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" DROP CONSTRAINT "application_status";--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD COLUMN "source" varchar(16) DEFAULT 'site' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD COLUMN "external_reference" varchar(160);--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD COLUMN "decision_note" varchar(500) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."external_receipts" ADD CONSTRAINT "external_receipts_application_id_event_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "sliper"."event_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."external_receipts" ADD CONSTRAINT "external_receipts_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."external_receipts" ADD CONSTRAINT "external_receipts_verified_by_profiles_id_fk" FOREIGN KEY ("verified_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."external_webhook_events" ADD CONSTRAINT "external_webhook_events_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD CONSTRAINT "application_status" CHECK ("sliper"."event_applications"."status" in ('pending_payment','pending_approval','confirmed','cancelled','expired','refunded','review','rejected'));