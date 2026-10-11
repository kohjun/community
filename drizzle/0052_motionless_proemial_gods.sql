CREATE TABLE "sliper"."library_purchase_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" varchar(40) NOT NULL,
	"note" varchar(1000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."library_purchase_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"requester_id" uuid,
	"kind" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"seller_response" text DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"outcome" varchar(20),
	"resolution_note" varchar(1000) DEFAULT '' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_dispute_kind" CHECK ("sliper"."library_purchase_disputes"."kind" in ('delivery','terms','payment','other')),
	CONSTRAINT "library_dispute_state" CHECK ("sliper"."library_purchase_disputes"."status" in ('open','resolved','withdrawn') and ("sliper"."library_purchase_disputes"."status"='open')=("sliper"."library_purchase_disputes"."resolved_at" is null) and ("sliper"."library_purchase_disputes"."status"='resolved')=("sliper"."library_purchase_disputes"."outcome" is not null)),
	CONSTRAINT "library_dispute_outcome" CHECK ("sliper"."library_purchase_disputes"."outcome" in ('no_action','revoke','refund_confirmed')),
	CONSTRAINT "library_dispute_body_size" CHECK (char_length(btrim("sliper"."library_purchase_disputes"."body")) between 10 and 3000 and char_length("sliper"."library_purchase_disputes"."seller_response") <= 3000)
);
--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_disputes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."library_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"buyer_id" uuid,
	"seller_id" uuid,
	"snapshot" jsonb NOT NULL,
	"external_reference" varchar(160) NOT NULL,
	"note" varchar(500) DEFAULT '' NOT NULL,
	"amount_krw" integer NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"provider" varchar(80),
	"payment_id" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_order_reference_unique" UNIQUE("entry_id","external_reference"),
	CONSTRAINT "library_order_price" CHECK ("sliper"."library_purchases"."amount_krw" between 1 and 1000000),
	CONSTRAINT "library_order_status" CHECK ("sliper"."library_purchases"."status" in ('pending','paid','rejected','revoked','refunded')),
	CONSTRAINT "library_order_payment_pair" CHECK (("sliper"."library_purchases"."provider" is null)=("sliper"."library_purchases"."payment_id" is null)),
	CONSTRAINT "library_order_reference_size" CHECK (char_length(btrim("sliper"."library_purchases"."external_reference")) between 3 and 160)
);
--> statement-breakpoint
ALTER TABLE "sliper"."library_purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."library_webhook_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(80) NOT NULL,
	"event_id" varchar(160) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"purchase_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_webhook_event_unique" UNIQUE("provider","event_id"),
	CONSTRAINT "library_receipt_hash" CHECK ("sliper"."library_webhook_receipts"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "sliper"."library_webhook_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_audit" ADD CONSTRAINT "library_purchase_audit_purchase_id_library_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "sliper"."library_purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_audit" ADD CONSTRAINT "library_purchase_audit_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_disputes" ADD CONSTRAINT "library_purchase_disputes_purchase_id_library_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "sliper"."library_purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_disputes" ADD CONSTRAINT "library_purchase_disputes_requester_id_profiles_id_fk" FOREIGN KEY ("requester_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchase_disputes" ADD CONSTRAINT "library_purchase_disputes_resolved_by_profiles_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchases" ADD CONSTRAINT "library_purchases_entry_id_library_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "sliper"."library_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchases" ADD CONSTRAINT "library_purchases_version_id_library_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "sliper"."library_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchases" ADD CONSTRAINT "library_purchases_buyer_id_profiles_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_purchases" ADD CONSTRAINT "library_purchases_seller_id_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."library_webhook_receipts" ADD CONSTRAINT "library_webhook_receipts_purchase_id_library_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "sliper"."library_purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_order_audit_idx" ON "sliper"."library_purchase_audit" USING btree ("purchase_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_order_open_dispute_unique" ON "sliper"."library_purchase_disputes" USING btree ("purchase_id") WHERE "sliper"."library_purchase_disputes"."status"='open';--> statement-breakpoint
CREATE INDEX "library_dispute_queue_idx" ON "sliper"."library_purchase_disputes" USING btree ("status","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_order_active_unique" ON "sliper"."library_purchases" USING btree ("entry_id","buyer_id") WHERE "sliper"."library_purchases"."status" in ('pending','paid');--> statement-breakpoint
CREATE UNIQUE INDEX "library_order_payment_unique" ON "sliper"."library_purchases" USING btree ("provider","payment_id") WHERE "sliper"."library_purchases"."payment_id" is not null;--> statement-breakpoint
CREATE INDEX "library_order_buyer_idx" ON "sliper"."library_purchases" USING btree ("buyer_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "library_order_seller_idx" ON "sliper"."library_purchases" USING btree ("seller_id","created_at" DESC NULLS LAST,"id");