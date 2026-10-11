CREATE TABLE "sliper"."event_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attendee_name" varchar(60) NOT NULL,
	"contact" varchar(100) NOT NULL,
	"note" varchar(500) DEFAULT '' NOT NULL,
	"amount_krw" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending_payment' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_identity_unique" UNIQUE("id","post_id","user_id"),
	CONSTRAINT "application_status" CHECK ("sliper"."event_applications"."status" in ('pending_payment','confirmed','cancelled','expired','refunded','review')),
	CONSTRAINT "application_amount" CHECK ("sliper"."event_applications"."amount_krw" between 0 and 10000000),
	CONSTRAINT "application_name" CHECK (char_length(btrim("sliper"."event_applications"."attendee_name")) between 1 and 60),
	CONSTRAINT "application_contact" CHECK (char_length(btrim("sliper"."event_applications"."contact")) between 3 and 100)
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_settings" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"amount_krw" integer NOT NULL,
	"capacity" integer NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_amount_range" CHECK ("sliper"."event_settings"."amount_krw" between 0 and 10000000),
	CONSTRAINT "event_capacity_range" CHECK ("sliper"."event_settings"."capacity" between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."payment_events" (
	"provider" varchar(40) NOT NULL,
	"event_id" varchar(160) NOT NULL,
	"order_id" uuid NOT NULL,
	"digest" varchar(64) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_provider_event_id_pk" PRIMARY KEY("provider","event_id"),
	CONSTRAINT "payment_event_kind" CHECK ("sliper"."payment_events"."kind" in ('paid','refunded'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"amount_krw" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'KRW' NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"payment_id" varchar(160),
	"checkout_url" varchar(2048),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_application_id_unique" UNIQUE("application_id"),
	CONSTRAINT "provider_payment_unique" UNIQUE("provider","payment_id"),
	CONSTRAINT "payment_amount" CHECK ("sliper"."payment_orders"."amount_krw" between 1 and 10000000 and "sliper"."payment_orders"."currency" = 'KRW'),
	CONSTRAINT "payment_state" CHECK ("sliper"."payment_orders"."state" in ('pending','paid','refunded'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."payment_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."room_managers" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_managers_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."room_managers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."room_members" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "room_members_post_id_user_id_pk" PRIMARY KEY("post_id","user_id"),
	CONSTRAINT "room_members_application_id_unique" UNIQUE("application_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."room_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."room_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_message_length" CHECK (char_length(btrim("sliper"."room_messages"."body")) between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "sliper"."room_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD CONSTRAINT "event_applications_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD CONSTRAINT "event_applications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD CONSTRAINT "event_settings_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."payment_events" ADD CONSTRAINT "payment_events_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "sliper"."payment_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."payment_orders" ADD CONSTRAINT "payment_orders_application_id_event_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "sliper"."event_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."room_managers" ADD CONSTRAINT "room_managers_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."room_managers" ADD CONSTRAINT "room_managers_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."room_members" ADD CONSTRAINT "room_members_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."room_members" ADD CONSTRAINT "room_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."room_members" ADD CONSTRAINT "room_application_identity_fk" FOREIGN KEY ("application_id","post_id","user_id") REFERENCES "sliper"."event_applications"("id","post_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."room_messages" ADD CONSTRAINT "room_messages_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."room_messages" ADD CONSTRAINT "room_messages_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_user_idx" ON "sliper"."event_applications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "application_event_idx" ON "sliper"."event_applications" USING btree ("post_id","status");--> statement-breakpoint
CREATE INDEX "payment_events_order_idx" ON "sliper"."payment_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "room_members_user_idx" ON "sliper"."room_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "room_messages_page_idx" ON "sliper"."room_messages" USING btree ("post_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);