CREATE TABLE "sliper"."content_restrictions" (
	"target_type" varchar(16) NOT NULL,
	"target_id" uuid NOT NULL,
	"hidden" boolean DEFAULT true NOT NULL,
	"reason" varchar(1000) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_restrictions_target_type_target_id_pk" PRIMARY KEY("target_type","target_id"),
	CONSTRAINT "restriction_target_type" CHECK ("sliper"."content_restrictions"."target_type" in ('post','comment','venue'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."content_restrictions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."member_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"display_label" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_member_pair" UNIQUE("blocker_id","blocked_id"),
	CONSTRAINT "block_not_self" CHECK ("sliper"."member_blocks"."blocker_id"<>"sliper"."member_blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."member_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."member_safety" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"reason" varchar(1000) DEFAULT '' NOT NULL,
	"suspended_until" timestamp with time zone,
	"policy_version" varchar(20),
	"consent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_safety_status" CHECK ("sliper"."member_safety"."status" in ('active','suspended','closed'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."member_safety" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."moderation_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(24) NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" varchar(1000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sliper"."moderation_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."request_limits" (
	"user_id" uuid NOT NULL,
	"action" varchar(24) NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "request_limits_user_id_action_pk" PRIMARY KEY("user_id","action"),
	CONSTRAINT "request_limit_count" CHECK ("sliper"."request_limits"."count">0)
);
--> statement-breakpoint
ALTER TABLE "sliper"."request_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."safety_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" varchar(24) NOT NULL,
	"detail" varchar(2000) DEFAULT '' NOT NULL,
	"snapshot" text NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"resolution" varchar(1000) DEFAULT '' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_member_target" UNIQUE("reporter_id","target_type","target_id"),
	CONSTRAINT "report_target_type" CHECK ("sliper"."safety_reports"."target_type" in ('post','comment','venue','player')),
	CONSTRAINT "report_status" CHECK ("sliper"."safety_reports"."status" in ('open','actioned','dismissed'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."staff_roles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_role_values" CHECK ("sliper"."staff_roles"."role" in ('moderator','admin'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."staff_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."support_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid,
	"body" varchar(3000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sliper"."support_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" varchar(16) NOT NULL,
	"subject" varchar(100) NOT NULL,
	"body" varchar(3000) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_status" CHECK ("sliper"."support_tickets"."status" in ('open','answered','closed'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."support_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."content_restrictions" ADD CONSTRAINT "content_restrictions_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."member_blocks" ADD CONSTRAINT "member_blocks_blocker_id_profiles_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."member_blocks" ADD CONSTRAINT "member_blocks_blocked_id_profiles_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."member_safety" ADD CONSTRAINT "member_safety_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."moderation_audit" ADD CONSTRAINT "moderation_audit_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."request_limits" ADD CONSTRAINT "request_limits_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ADD CONSTRAINT "safety_reports_reporter_id_profiles_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."safety_reports" ADD CONSTRAINT "safety_reports_resolved_by_profiles_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."staff_roles" ADD CONSTRAINT "staff_roles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."support_replies" ADD CONSTRAINT "support_replies_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "sliper"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."support_replies" ADD CONSTRAINT "support_replies_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."support_tickets" ADD CONSTRAINT "support_tickets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_audit_target_idx" ON "sliper"."moderation_audit" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "report_queue_idx" ON "sliper"."safety_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "support_reply_ticket_idx" ON "sliper"."support_replies" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "support_queue_idx" ON "sliper"."support_tickets" USING btree ("status","created_at");
--> statement-breakpoint
REVOKE ALL ON TABLE sliper.content_restrictions, sliper.member_blocks, sliper.member_safety, sliper.moderation_audit, sliper.request_limits, sliper.safety_reports, sliper.staff_roles, sliper.support_replies, sliper.support_tickets FROM anon, authenticated;
