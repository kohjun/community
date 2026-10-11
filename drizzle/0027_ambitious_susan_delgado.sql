ALTER TABLE "sliper"."event_admissions" ADD CONSTRAINT "admission_identity_unique" UNIQUE("application_id","post_id","user_id");
--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" ADD CONSTRAINT "verified_review_admission_identity_fk" FOREIGN KEY ("application_id","event_post_id","user_id") REFERENCES "sliper"."event_admissions"("application_id","post_id","user_id") ON DELETE restrict ON UPDATE no action;
