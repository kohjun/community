CREATE TABLE "sliper"."category_subscriptions" (
	"user_id" uuid NOT NULL,
	"category_slug" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_subscriptions_user_id_category_slug_pk" PRIMARY KEY("user_id","category_slug"),
	CONSTRAINT "category_subscription_slug" CHECK ("sliper"."category_subscriptions"."category_slug" in ('travel','dating','race','mind-games','survival','music','sports','cooking','party','knowledge','lab','crew'))
);
--> statement-breakpoint
ALTER TABLE "sliper"."category_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."engagement_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(24) NOT NULL,
	"source_key" varchar(220) NOT NULL,
	"post_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(100),
	"recipient_cursor" uuid,
	CONSTRAINT "engagement_jobs_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "engagement_job_kind" CHECK ("sliper"."engagement_jobs"."kind" in ('comment','announcement','participation','event-change','subscription')),
	CONSTRAINT "engagement_job_attempts" CHECK ("sliper"."engagement_jobs"."attempts" between 0 and 100),
	CONSTRAINT "engagement_job_payload" CHECK (jsonb_typeof("sliper"."engagement_jobs"."payload")='object')
);
--> statement-breakpoint
ALTER TABLE "sliper"."engagement_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."host_subscriptions" (
	"user_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_subscriptions_user_id_host_id_pk" PRIMARY KEY("user_id","host_id"),
	CONSTRAINT "host_subscription_not_self" CHECK ("sliper"."host_subscriptions"."user_id"<>"sliper"."host_subscriptions"."host_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."host_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"dedupe_key" varchar(220) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"post_id" uuid NOT NULL,
	"source_id" uuid,
	"actor_id" uuid,
	"title" varchar(120) NOT NULL,
	"body" varchar(500) DEFAULT '' NOT NULL,
	"url" varchar(2048) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "inbox_recipient_dedupe" UNIQUE("recipient_id","dedupe_key"),
	CONSTRAINT "inbox_kind" CHECK ("sliper"."inbox_items"."kind" in ('comments','announcements','participation','subscriptions','reminders')),
	CONSTRAINT "inbox_internal_url" CHECK ("sliper"."inbox_items"."url" ~ '^/[^/]' and "sliper"."inbox_items"."url" !~ '[[:cntrl:]]')
);
--> statement-breakpoint
ALTER TABLE "sliper"."inbox_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."push_deliveries" DROP CONSTRAINT "push_deliveries_kind";--> statement-breakpoint
ALTER TABLE "sliper"."push_deliveries" DROP CONSTRAINT "push_deliveries_source";--> statement-breakpoint
ALTER TABLE "sliper"."push_preferences" ADD COLUMN "subscriptions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."push_preferences" ADD COLUMN "reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."category_subscriptions" ADD CONSTRAINT "category_subscriptions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."engagement_jobs" ADD CONSTRAINT "engagement_jobs_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."host_subscriptions" ADD CONSTRAINT "host_subscriptions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."host_subscriptions" ADD CONSTRAINT "host_subscriptions_host_id_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."inbox_items" ADD CONSTRAINT "inbox_items_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "sliper"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."inbox_items" ADD CONSTRAINT "inbox_items_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."inbox_items" ADD CONSTRAINT "inbox_items_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_subscription_fanout_idx" ON "sliper"."category_subscriptions" USING btree ("category_slug","user_id");--> statement-breakpoint
CREATE INDEX "engagement_due_jobs_idx" ON "sliper"."engagement_jobs" USING btree ("available_at","created_at","id") WHERE "sliper"."engagement_jobs"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "host_subscription_fanout_idx" ON "sliper"."host_subscriptions" USING btree ("host_id","user_id");--> statement-breakpoint
CREATE INDEX "inbox_recipient_page_idx" ON "sliper"."inbox_items" USING btree ("recipient_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inbox_unread_idx" ON "sliper"."inbox_items" USING btree ("recipient_id","created_at" DESC NULLS LAST) WHERE "sliper"."inbox_items"."read_at" is null;--> statement-breakpoint
CREATE INDEX "inbox_source_idx" ON "sliper"."inbox_items" USING btree ("kind","source_id","recipient_id");--> statement-breakpoint
ALTER TABLE "sliper"."push_deliveries" ADD CONSTRAINT "push_deliveries_kind" CHECK ("sliper"."push_deliveries"."kind" in ('comment','announcement','participation','subscription','reminder','test'));--> statement-breakpoint
ALTER TABLE "sliper"."push_deliveries" ADD CONSTRAINT "push_deliveries_source" CHECK (("sliper"."push_deliveries"."kind" = 'comment' and "sliper"."push_deliveries"."post_id" is not null and "sliper"."push_deliveries"."comment_id" is not null) or ("sliper"."push_deliveries"."kind" in ('announcement','participation','subscription','reminder') and "sliper"."push_deliveries"."post_id" is not null and "sliper"."push_deliveries"."comment_id" is null) or ("sliper"."push_deliveries"."kind" = 'test' and "sliper"."push_deliveries"."comment_id" is null));
--> statement-breakpoint
-- Transactional ingress: publish and operational changes never depend on push permission.
CREATE FUNCTION sliper.enqueue_engagement_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE source_post sliper.posts%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='posts' THEN
    IF NEW.status='published' AND NEW.kind='모집' AND NOT NEW.sample
      AND (TG_OP='INSERT' OR OLD.status<>'published') THEN
      INSERT INTO sliper.engagement_jobs(kind,source_key,post_id,source_id,created_at)
      VALUES('subscription','subscription:'||NEW.id::text,NEW.id,NEW.id,NEW.created_at)
      ON CONFLICT(source_key) DO NOTHING;
    END IF;
  ELSIF TG_TABLE_NAME='event_settings' THEN
    SELECT * INTO source_post FROM sliper.posts WHERE id=NEW.post_id;
    IF NEW.open AND source_post.status='published' AND source_post.kind='모집' AND NOT source_post.sample
      AND (TG_OP='INSERT' OR NOT OLD.open) THEN
      INSERT INTO sliper.engagement_jobs(kind,source_key,post_id,source_id,created_at)
      VALUES('subscription','subscription:'||NEW.post_id::text,NEW.post_id,NEW.post_id,source_post.created_at)
      ON CONFLICT(source_key) DO UPDATE SET completed_at=NULL,available_at=statement_timestamp(),lease_until=NULL
      WHERE sliper.engagement_jobs.recipient_cursor IS NULL;
    END IF;
  ELSIF TG_TABLE_NAME='notifications' THEN
    INSERT INTO sliper.engagement_jobs(kind,source_key,post_id,source_id,payload,created_at)
    VALUES('comment','comment:'||NEW.comment_id::text||':'||NEW.recipient_id::text,NEW.post_id,NEW.comment_id,
      jsonb_build_object('recipientId',NEW.recipient_id::text),NEW.created_at)
    ON CONFLICT(source_key) DO NOTHING;
  ELSIF TG_TABLE_NAME='room_messages' THEN
    INSERT INTO sliper.engagement_jobs(kind,source_key,post_id,source_id,created_at)
    VALUES('announcement','room:'||NEW.id::text,NEW.post_id,NEW.id,NEW.created_at)
    ON CONFLICT(source_key) DO NOTHING;
  ELSIF TG_TABLE_NAME='event_applications' THEN
    IF NEW.status IN ('confirmed','refunded','rejected','cancelled','pending_approval','review')
      AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      INSERT INTO sliper.engagement_jobs(kind,source_key,post_id,source_id,payload,created_at)
      VALUES('participation','application:'||NEW.id::text||':'||NEW.status||':'||NEW.updated_at::text,
        NEW.post_id,NEW.id,jsonb_build_object('recipientId',NEW.user_id::text,'status',NEW.status),NEW.updated_at)
      ON CONFLICT(source_key) DO NOTHING;
    END IF;
  ELSIF TG_TABLE_NAME='event_change_recipients' THEN
    INSERT INTO sliper.engagement_jobs(kind,source_key,post_id,source_id,payload,created_at)
    VALUES('event-change','event-change:'||NEW.change_id::text||':'||NEW.user_id::text,NEW.post_id,NEW.change_id,
      jsonb_build_object('recipientId',NEW.user_id::text),NEW.created_at)
    ON CONFLICT(source_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER engagement_post_ingress AFTER INSERT OR UPDATE OF status ON sliper.posts
FOR EACH ROW EXECUTE FUNCTION sliper.enqueue_engagement_event();
--> statement-breakpoint
CREATE TRIGGER engagement_config_ingress AFTER INSERT OR UPDATE OF open ON sliper.event_settings
FOR EACH ROW EXECUTE FUNCTION sliper.enqueue_engagement_event();
--> statement-breakpoint
CREATE TRIGGER engagement_comment_ingress AFTER INSERT ON sliper.notifications
FOR EACH ROW EXECUTE FUNCTION sliper.enqueue_engagement_event();
--> statement-breakpoint
CREATE TRIGGER engagement_room_ingress AFTER INSERT ON sliper.room_messages
FOR EACH ROW EXECUTE FUNCTION sliper.enqueue_engagement_event();
--> statement-breakpoint
CREATE TRIGGER engagement_application_ingress AFTER INSERT OR UPDATE OF status ON sliper.event_applications
FOR EACH ROW EXECUTE FUNCTION sliper.enqueue_engagement_event();
--> statement-breakpoint
CREATE TRIGGER engagement_change_ingress AFTER INSERT ON sliper.event_change_recipients
FOR EACH ROW EXECUTE FUNCTION sliper.enqueue_engagement_event();
--> statement-breakpoint
-- Both old entry points and the unified inbox share one durable read receipt.
CREATE FUNCTION sliper.sync_engagement_read() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.read_at IS NULL OR NEW.read_at IS NOT DISTINCT FROM OLD.read_at THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='inbox_items' THEN
    IF NEW.kind='comments' THEN
      UPDATE sliper.notifications SET read_at=NEW.read_at
      WHERE recipient_id=NEW.recipient_id AND comment_id=NEW.source_id AND read_at IS NULL;
    ELSIF NEW.kind='participation' AND NEW.dedupe_key LIKE 'event-change:%' THEN
      UPDATE sliper.event_change_recipients SET read_at=NEW.read_at
      WHERE user_id=NEW.recipient_id AND change_id=NEW.source_id AND read_at IS NULL;
    END IF;
  ELSIF TG_TABLE_NAME='notifications' THEN
    UPDATE sliper.inbox_items SET read_at=NEW.read_at
    WHERE recipient_id=NEW.recipient_id AND kind='comments' AND source_id=NEW.comment_id AND read_at IS NULL;
  ELSIF TG_TABLE_NAME='event_change_recipients' THEN
    UPDATE sliper.inbox_items SET read_at=NEW.read_at
    WHERE recipient_id=NEW.user_id AND kind='participation' AND source_id=NEW.change_id
      AND dedupe_key LIKE 'event-change:%' AND read_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER engagement_read_bridge AFTER UPDATE OF read_at ON sliper.inbox_items
FOR EACH ROW EXECUTE FUNCTION sliper.sync_engagement_read();
--> statement-breakpoint
CREATE TRIGGER engagement_comment_read_bridge AFTER UPDATE OF read_at ON sliper.notifications
FOR EACH ROW EXECUTE FUNCTION sliper.sync_engagement_read();
--> statement-breakpoint
CREATE TRIGGER engagement_change_read_bridge AFTER UPDATE OF read_at ON sliper.event_change_recipients
FOR EACH ROW EXECUTE FUNCTION sliper.sync_engagement_read();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_engagement_inbox() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE valid_source boolean := false;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.recipient_id,NEW.dedupe_key,NEW.kind,NEW.post_id,NEW.source_id,NEW.title,NEW.body,NEW.url,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.recipient_id,OLD.dedupe_key,OLD.kind,OLD.post_id,OLD.source_id,OLD.title,OLD.body,OLD.url,OLD.created_at)
      OR (NEW.actor_id IS DISTINCT FROM OLD.actor_id AND NEW.actor_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Inbox source and payload are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind='comments' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.notifications n WHERE n.recipient_id=NEW.recipient_id
      AND n.post_id=NEW.post_id AND n.comment_id=NEW.source_id AND NEW.dedupe_key='comment:'||n.comment_id::text)
    INTO valid_source;
  ELSIF NEW.kind='announcements' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.room_messages message WHERE message.id=NEW.source_id
      AND message.post_id=NEW.post_id AND NEW.dedupe_key='room:'||message.id::text)
    INTO valid_source;
  ELSIF NEW.kind='participation' AND NEW.dedupe_key LIKE 'event-change:%' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.event_change_recipients r WHERE r.user_id=NEW.recipient_id
      AND r.post_id=NEW.post_id AND r.change_id=NEW.source_id AND NEW.dedupe_key='event-change:'||r.change_id::text)
    INTO valid_source;
  ELSIF NEW.kind='participation' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.event_applications a WHERE a.id=NEW.source_id AND a.post_id=NEW.post_id
      AND a.user_id=NEW.recipient_id AND NEW.dedupe_key IN ('application:'||a.id::text||':confirmed',
        'application:'||a.id::text||':refunded','application:'||a.id::text||':rejected','application:'||a.id::text||':cancelled',
        'application:'||a.id::text||':pending_approval','application:'||a.id::text||':review'))
    INTO valid_source;
  ELSIF NEW.kind='subscriptions' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.posts p WHERE p.id=NEW.post_id AND NEW.source_id=p.id
      AND NEW.dedupe_key='subscription:'||p.id::text AND p.kind='모집' AND NOT p.sample
      AND p.author_id IS DISTINCT FROM NEW.recipient_id AND (
        EXISTS(SELECT 1 FROM sliper.category_subscriptions c WHERE c.user_id=NEW.recipient_id AND c.category_slug=p.category_slug AND c.created_at<=p.created_at)
        OR (NOT p.is_anonymous AND EXISTS(SELECT 1 FROM sliper.host_subscriptions h WHERE h.user_id=NEW.recipient_id AND h.host_id=p.author_id AND h.created_at<=p.created_at))))
    INTO valid_source;
  ELSIF NEW.kind='reminders' THEN
    SELECT EXISTS(SELECT 1 FROM sliper.event_applications a WHERE a.id=NEW.source_id
      AND a.user_id=NEW.recipient_id AND a.post_id=NEW.post_id
      AND NEW.dedupe_key LIKE 'reminder:'||a.id::text||':%')
    INTO valid_source;
  END IF;
  IF NOT valid_source THEN RAISE EXCEPTION 'Inbox recipient must match source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER engagement_inbox_source_guard BEFORE INSERT OR UPDATE ON sliper.inbox_items
FOR EACH ROW EXECUTE FUNCTION sliper.guard_engagement_inbox();
--> statement-breakpoint
-- Preserve old comments/change notices in the inbox; do not enqueue historical push deliveries.
INSERT INTO sliper.inbox_items(recipient_id,dedupe_key,kind,post_id,source_id,actor_id,title,body,url,created_at,read_at)
SELECT n.recipient_id,'comment:'||n.comment_id::text,'comments',n.post_id,n.comment_id,c.author_id,
  CASE WHEN n.kind='comment_reply' THEN '내 댓글에 답글이 달렸어요' ELSE '내 글에 댓글이 달렸어요' END,
  '이야기를 확인하고 함께 대화해보세요.','/?post='||n.post_id::text,n.created_at,n.read_at
FROM sliper.notifications n JOIN sliper.comments c ON c.id=n.comment_id AND c.post_id=n.post_id
JOIN sliper.posts p ON p.id=n.post_id
WHERE p.status='published' AND c.status='published'
ON CONFLICT(recipient_id,dedupe_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO sliper.inbox_items(recipient_id,dedupe_key,kind,post_id,source_id,title,body,url,created_at,read_at)
SELECT r.user_id,'event-change:'||r.change_id::text,'participation',r.post_id,r.change_id,
  CASE WHEN c.kind='cancel' THEN '참가한 행사가 취소되었어요' ELSE '참가한 행사의 일정이 변경됐어요' END,
  '참가 내역에서 변경 안내와 환불 기준을 확인해주세요.','/participation',min(r.created_at),CASE WHEN bool_or(r.read_at IS NULL) THEN NULL ELSE min(r.read_at) END
FROM sliper.event_change_recipients r JOIN sliper.event_changes c ON c.id=r.change_id
JOIN sliper.posts p ON p.id=r.post_id WHERE p.status='published'
GROUP BY r.user_id,r.change_id,r.post_id,c.kind
ON CONFLICT(recipient_id,dedupe_key) DO NOTHING;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sliper FROM PUBLIC,anon,authenticated;
