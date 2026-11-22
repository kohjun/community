ALTER TABLE "sliper"."verified_event_reviews" DROP CONSTRAINT "verified_event_reviews_application_id_event_admissions_application_id_fk";
--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" DROP CONSTRAINT "verified_review_admission_identity_fk";
--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" ADD CONSTRAINT "verified_event_reviews_application_id_event_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "sliper"."event_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."verified_event_reviews" ADD CONSTRAINT "verified_review_application_identity_fk" FOREIGN KEY ("application_id","event_post_id","user_id") REFERENCES "sliper"."event_applications"("id","post_id","user_id") ON DELETE restrict ON UPDATE no action;