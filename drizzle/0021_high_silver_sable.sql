ALTER TABLE "sliper"."event_applications" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD COLUMN "questionnaire_version" varchar(80);--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD COLUMN "questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "phone_number" varchar(20);--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "profile_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "onboarding_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "age_band" varchar(20);--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD COLUMN "gender" varchar(20);--> statement-breakpoint
ALTER TABLE "sliper"."event_applications" ADD CONSTRAINT "application_answers_shape" CHECK (jsonb_typeof("sliper"."event_applications"."answers")='array' and jsonb_array_length("sliper"."event_applications"."answers")<=10);--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD CONSTRAINT "event_questions_shape" CHECK (jsonb_typeof("sliper"."event_settings"."questions")='array' and jsonb_array_length("sliper"."event_settings"."questions")<=10);--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD CONSTRAINT "profile_phone_format" CHECK ("sliper"."profiles"."phone_number" is null or "sliper"."profiles"."phone_number" ~ '^01[016789][0-9]{7,8}$');--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD CONSTRAINT "profile_phone_verification" CHECK ("sliper"."profiles"."phone_verified_at" is null or "sliper"."profiles"."phone_number" is not null);--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD CONSTRAINT "profile_completion" CHECK ("sliper"."profiles"."profile_completed_at" is null or ("sliper"."profiles"."phone_number" is not null and "sliper"."profiles"."onboarding_consent_at" is not null));--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD CONSTRAINT "profile_age_band" CHECK ("sliper"."profiles"."age_band" is null or "sliper"."profiles"."age_band" in ('20s','30s','40s','50plus'));--> statement-breakpoint
ALTER TABLE "sliper"."profiles" ADD CONSTRAINT "profile_gender" CHECK ("sliper"."profiles"."gender" is null or "sliper"."profiles"."gender" in ('female','male','other'));