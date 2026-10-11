CREATE TABLE "sliper"."question_resolutions" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"comment_id" uuid NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sliper"."question_resolutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "discussion_type" varchar(16);--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "spoiler" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "spoiler_title" varchar(120);--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD COLUMN "spoiler_summary" varchar(200);--> statement-breakpoint
ALTER TABLE "sliper"."question_resolutions" ADD CONSTRAINT "question_resolutions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."question_resolutions" ADD CONSTRAINT "question_resolutions_resolved_by_profiles_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."question_resolutions" ADD CONSTRAINT "question_answer_same_post_fk" FOREIGN KEY ("comment_id","post_id") REFERENCES "sliper"."comments"("id","post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_discussion_feed_idx" ON "sliper"."posts" USING btree ("discussion_type","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "sliper"."posts"."status"='published';--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD CONSTRAINT "posts_discussion_type" CHECK ("sliper"."posts"."discussion_type" is null or ("sliper"."posts"."kind"='이야기' and "sliper"."posts"."discussion_type" in ('free','question','tip','analysis')));--> statement-breakpoint
ALTER TABLE "sliper"."posts" ADD CONSTRAINT "posts_spoiler_title" CHECK (not "sliper"."posts"."spoiler" or ("sliper"."posts"."kind"<>'모집' and "sliper"."posts"."spoiler_title" is not null and char_length(btrim("sliper"."posts"."spoiler_title")) between 1 and 120));
--> statement-breakpoint
REVOKE ALL ON sliper.question_resolutions FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION sliper.guard_question_answer() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  -- Allow the FK's anonymization when a member is permanently removed.
  IF TG_OP='UPDATE' AND NEW.resolved_by IS NULL AND OLD.resolved_by IS NOT NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM sliper.posts p JOIN sliper.comments c ON c.post_id=p.id AND c.id=NEW.comment_id
    WHERE p.id=NEW.post_id AND p.status='published' AND p.kind='이야기' AND p.discussion_type='question'
      AND p.author_id=NEW.resolved_by AND c.status='published' AND c.author_id IS NOT NULL AND c.author_id<>p.author_id) THEN
    RAISE EXCEPTION 'Only the question author can select another member answer in this question' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER question_answer_guard BEFORE INSERT OR UPDATE ON sliper.question_resolutions FOR EACH ROW EXECUTE FUNCTION sliper.guard_question_answer();
