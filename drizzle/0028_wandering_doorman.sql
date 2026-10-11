CREATE TABLE "sliper"."event_change_recipients" (
	"change_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_change_recipients_change_id_application_id_pk" PRIMARY KEY("change_id","application_id")
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_change_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"revision" integer NOT NULL,
	"reason" varchar(500) NOT NULL,
	"before_starts_at" timestamp with time zone,
	"before_ends_at" timestamp with time zone,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_event_revision" UNIQUE("post_id","revision"),
	CONSTRAINT "change_event_identity" UNIQUE("id","post_id"),
	CONSTRAINT "event_change_kind" CHECK ("sliper"."event_changes"."kind" in ('cancel','reschedule')),
	CONSTRAINT "event_change_reason" CHECK (char_length(btrim("sliper"."event_changes"."reason")) between 5 and 500),
	CONSTRAINT "event_change_schedule" CHECK ("sliper"."event_changes"."kind"<>'reschedule' or ("sliper"."event_changes"."starts_at" is not null and "sliper"."event_changes"."ends_at">"sliper"."event_changes"."starts_at"))
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sliper"."event_lifecycle" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" varchar(500) DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_revision" CHECK ("sliper"."event_lifecycle"."revision">=0),
	CONSTRAINT "lifecycle_cancel_reason" CHECK ("sliper"."event_lifecycle"."cancelled_at" is null or char_length(btrim("sliper"."event_lifecycle"."cancellation_reason")) between 5 and 500)
);
--> statement-breakpoint
ALTER TABLE "sliper"."event_lifecycle" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sliper"."refund_requests" ADD COLUMN "cause" varchar(24) DEFAULT 'participant' NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."event_change_recipients" ADD CONSTRAINT "change_recipient_event_fk" FOREIGN KEY ("change_id","post_id") REFERENCES "sliper"."event_changes"("id","post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_change_recipients" ADD CONSTRAINT "change_recipient_application_fk" FOREIGN KEY ("application_id","post_id","user_id") REFERENCES "sliper"."event_applications"("id","post_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_changes" ADD CONSTRAINT "event_changes_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_changes" ADD CONSTRAINT "event_changes_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "sliper"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sliper"."event_lifecycle" ADD CONSTRAINT "event_lifecycle_post_id_event_settings_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "sliper"."event_settings"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_recipient_inbox_idx" ON "sliper"."event_change_recipients" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "change_recipient_application_idx" ON "sliper"."event_change_recipients" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "change_event_time" ON "sliper"."event_changes" USING btree ("post_id","created_at");--> statement-breakpoint
ALTER TABLE "sliper"."refund_requests" ADD CONSTRAINT "refund_cause" CHECK ("sliper"."refund_requests"."cause" in ('participant','host_cancel','schedule_change'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_event_settings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p sliper.posts; occupied integer;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 IF p.kind <> '모집' OR p.status <> 'published' THEN RAISE EXCEPTION 'event requires a published recruitment'; END IF;
 IF TG_OP='UPDATE' AND NEW.post_id <> OLD.post_id THEN RAISE EXCEPTION 'immutable event'; END IF;
 IF TG_OP='UPDATE' AND NEW.meetup_type <> OLD.meetup_type THEN RAISE EXCEPTION 'immutable meetup type'; END IF;
 IF TG_OP='UPDATE' AND OLD.venue_latitude IS NOT NULL AND (NEW.venue_latitude,NEW.venue_longitude) IS DISTINCT FROM (OLD.venue_latitude,OLD.venue_longitude) AND EXISTS(SELECT 1 FROM sliper.event_applications WHERE post_id=NEW.post_id) THEN RAISE EXCEPTION 'event venue is committed'; END IF;
 SELECT count(*) INTO occupied FROM sliper.event_applications WHERE post_id=NEW.post_id AND (status='confirmed' OR (status='pending_payment' AND expires_at>statement_timestamp()));
 IF TG_OP='UPDATE' AND OLD.starts_at IS NOT NULL AND (NEW.starts_at,NEW.ends_at,NEW.refund_policy) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at,OLD.refund_policy) AND EXISTS(SELECT 1 FROM sliper.event_applications WHERE post_id=NEW.post_id) AND NOT EXISTS(SELECT 1 FROM sliper.event_changes c JOIN sliper.event_lifecycle l ON l.post_id=c.post_id AND l.revision=c.revision WHERE c.post_id=NEW.post_id AND c.kind='reschedule' AND l.cancelled_at IS NULL AND c.before_starts_at IS NOT DISTINCT FROM OLD.starts_at AND c.before_ends_at IS NOT DISTINCT FROM OLD.ends_at AND c.starts_at=NEW.starts_at AND c.ends_at=NEW.ends_at AND NEW.refund_policy=OLD.refund_policy) THEN RAISE EXCEPTION 'event schedule is committed'; END IF;
 IF NEW.capacity < occupied THEN RAISE EXCEPTION 'capacity below current reservations'; END IF;
 IF NEW.open AND EXISTS(SELECT 1 FROM sliper.event_lifecycle WHERE post_id=NEW.post_id AND cancelled_at IS NOT NULL) THEN RAISE EXCEPTION 'cancelled event cannot reopen'; END IF;
 RETURN NEW;
END $$;



--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_event_settings() FROM PUBLIC, anon, authenticated;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_refund_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE app sliper.event_applications; d integer; verified_amount integer; host_reason varchar;
BEGIN
 PERFORM 1 FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 SELECT * INTO app FROM sliper.event_applications WHERE id=NEW.application_id;
 IF TG_OP='INSERT' THEN
   host_reason:='participant';
   IF EXISTS(SELECT 1 FROM sliper.event_lifecycle l WHERE l.post_id=app.post_id AND l.cancelled_at IS NOT NULL) THEN host_reason:='host_cancel';
   ELSIF EXISTS(SELECT 1 FROM sliper.event_change_recipients r JOIN sliper.event_changes c ON c.id=r.change_id JOIN sliper.event_settings s ON s.post_id=r.post_id WHERE r.application_id=app.id AND c.kind='reschedule' AND s.starts_at>statement_timestamp()) AND NOT EXISTS(SELECT 1 FROM sliper.event_admissions a WHERE a.application_id=app.id) THEN host_reason:='schedule_change'; END IF;
   NEW.cause:=host_reason;
   IF app.user_id<>NEW.user_id OR app.post_id<>NEW.post_id OR (app.status<>'confirmed' AND NOT (host_reason<>'participant' AND app.status='review')) OR app.amount_krw<=0 OR (app.event_starts_at IS NULL AND host_reason='participant') OR NEW.state<>'pending' THEN RAISE EXCEPTION 'invalid refund request'; END IF;
   IF host_reason<>'participant' AND NOT (EXISTS(SELECT 1 FROM sliper.payment_orders o WHERE o.application_id=app.id AND o.state='paid' AND o.amount_krw=app.amount_krw) OR EXISTS(SELECT 1 FROM sliper.external_receipts r WHERE r.application_id=app.id AND r.state='paid' AND r.amount_krw=app.amount_krw)) THEN RAISE EXCEPTION 'host refund requires verified payment'; END IF;
   NEW.event_starts_at:=coalesce(app.event_starts_at,(select starts_at from sliper.event_settings where post_id=app.post_id),statement_timestamp()); NEW.amount_krw:=app.amount_krw; NEW.policy_version:=app.refund_policy;
   NEW.requested_at:=statement_timestamp();
   d:=(app.event_starts_at AT TIME ZONE 'Asia/Seoul')::date-(NEW.requested_at AT TIME ZONE 'Asia/Seoul')::date;
   NEW.rate:=CASE WHEN host_reason='participant' THEN GREATEST(0,LEAST(5,d))*20 ELSE 100 END;
   NEW.refundable_krw:=floor(NEW.amount_krw::numeric*NEW.rate/100);
 ELSE
   IF (NEW.id,NEW.application_id,NEW.post_id,NEW.user_id,NEW.policy_version,NEW.event_starts_at,NEW.amount_krw,NEW.rate,NEW.refundable_krw,NEW.reason,NEW.requested_at,NEW.cause) IS DISTINCT FROM (OLD.id,OLD.application_id,OLD.post_id,OLD.user_id,OLD.policy_version,OLD.event_starts_at,OLD.amount_krw,OLD.rate,OLD.refundable_krw,OLD.reason,OLD.requested_at,OLD.cause) THEN RAISE EXCEPTION 'immutable refund quote'; END IF;
   IF OLD.state<>'pending' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'refund already processed'; END IF;
   IF NEW.state<>OLD.state THEN
     IF NEW.state NOT IN ('completed','rejected') THEN RAISE EXCEPTION 'invalid refund transition'; END IF;
     IF NEW.processed_by IS NOT NULL AND NOT (EXISTS(SELECT 1 FROM sliper.posts WHERE id=NEW.post_id AND author_id=NEW.processed_by) OR EXISTS(SELECT 1 FROM sliper.room_managers WHERE post_id=NEW.post_id AND user_id=NEW.processed_by)) THEN RAISE EXCEPTION 'only event managers process refunds'; END IF;
     IF NEW.state='rejected' AND NEW.processed_by IS NULL THEN RAISE EXCEPTION 'rejection requires a manager'; END IF;
     IF NEW.state='completed' THEN
       IF app.status<>'refunded' THEN RAISE EXCEPTION 'refund application not closed'; END IF;
       IF app.source='external' THEN SELECT refunded_amount_krw INTO verified_amount FROM sliper.external_receipts WHERE application_id=app.id AND state='refunded';
       ELSE SELECT refunded_amount_krw INTO verified_amount FROM sliper.payment_orders WHERE application_id=app.id AND state='refunded'; END IF;
       IF verified_amount IS NULL OR verified_amount<>NEW.actual_refund_krw THEN RAISE EXCEPTION 'refund amount not verified'; END IF;
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settings sliper.event_settings; occupied integer; p sliper.posts;
BEGIN
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 SELECT * INTO settings FROM sliper.event_settings WHERE post_id=NEW.post_id;
 IF TG_OP='INSERT' THEN
   IF EXISTS(SELECT 1 FROM sliper.event_lifecycle l WHERE l.post_id=NEW.post_id AND l.cancelled_at IS NOT NULL) AND NOT (NEW.source='external' AND NEW.status='review') THEN RAISE EXCEPTION 'cancelled event cannot accept applications'; END IF;
   NEW.event_starts_at:=settings.starts_at; NEW.refund_policy:=settings.refund_policy;
   IF NEW.refund_consent_at IS NOT NULL THEN NEW.refund_consent_at:=statement_timestamp(); END IF;
   IF NEW.source='site' AND NEW.amount_krw>0 AND NEW.event_starts_at IS NOT NULL AND NEW.refund_consent_at IS NULL THEN RAISE EXCEPTION 'refund consent required'; END IF;
   IF p.status<>'published' OR p.kind<>'모집' OR (NEW.source='site' AND NOT settings.open) OR NEW.amount_krw<>settings.amount_krw THEN RAISE EXCEPTION 'application configuration mismatch'; END IF;
   IF (NEW.source='site' AND (p.application_url IS NOT NULL OR NEW.status NOT IN ('pending_payment','confirmed'))) OR (NEW.source='external' AND (p.application_url IS NULL OR NEW.status NOT IN ('pending_approval','review'))) THEN RAISE EXCEPTION 'invalid initial application state'; END IF;
 ELSE
   IF (NEW.id,NEW.post_id,NEW.user_id,NEW.amount_krw,NEW.expires_at,NEW.source,NEW.external_reference,NEW.event_starts_at,NEW.refund_policy) IS DISTINCT FROM (OLD.id,OLD.post_id,OLD.user_id,OLD.amount_krw,OLD.expires_at,OLD.source,OLD.external_reference,OLD.event_starts_at,OLD.refund_policy) THEN RAISE EXCEPTION 'immutable application'; END IF;
   IF (NEW.attendee_name,NEW.contact,NEW.note,NEW.refund_consent_at,NEW.answers,NEW.questionnaire_version) IS DISTINCT FROM (OLD.attendee_name,OLD.contact,OLD.note,OLD.refund_consent_at,OLD.answers,OLD.questionnaire_version) AND NOT (OLD.source='external' AND OLD.questionnaire_version IS NULL AND OLD.status IN ('pending_approval','review') AND NEW.questionnaire_version IS NOT NULL) THEN RAISE EXCEPTION 'immutable application responses'; END IF;
   IF NEW.status<>OLD.status AND NOT (
     (OLD.status='pending_payment' AND NEW.status IN ('confirmed','cancelled','expired','review','refunded')) OR
     (OLD.status='confirmed' AND (NEW.status='refunded' OR (NEW.status='cancelled' AND OLD.amount_krw=0))) OR
     (OLD.status IN ('cancelled','expired','rejected') AND NEW.status IN ('review','refunded')) OR
     (OLD.status='review' AND (NEW.status='refunded' OR (NEW.source='external' AND NEW.status='confirmed'))) OR
     (OLD.status='pending_approval' AND NEW.status IN ('confirmed','rejected','cancelled','review','refunded'))
   ) THEN RAISE EXCEPTION 'invalid application transition'; END IF;
 END IF;
 IF NEW.status='confirmed' THEN
   IF EXISTS(SELECT 1 FROM sliper.event_lifecycle l WHERE l.post_id=NEW.post_id AND l.cancelled_at IS NOT NULL) AND (TG_OP='INSERT' OR OLD.status<>'confirmed') THEN RAISE EXCEPTION 'cancelled event cannot confirm'; END IF;
   IF NEW.questionnaire_version IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(settings.questions) q WHERE q->>'required'='true') THEN RAISE EXCEPTION 'application answers required before confirmation'; END IF;
   IF NEW.source='external' AND NOT EXISTS(SELECT 1 FROM sliper.external_receipts WHERE application_id=NEW.id AND state='paid' AND amount_krw=NEW.amount_krw) THEN RAISE EXCEPTION 'external payment not verified'; END IF;
   IF NEW.source='site' AND NEW.amount_krw>0 AND NOT EXISTS (SELECT 1 FROM sliper.payment_orders WHERE application_id=NEW.id AND state='paid' AND amount_krw=NEW.amount_krw) THEN RAISE EXCEPTION 'payment not confirmed'; END IF;
   IF NEW.confirmed_at IS NULL THEN RAISE EXCEPTION 'confirmation time required'; END IF;
 END IF;
 IF NEW.status IN ('pending_payment','confirmed') THEN
   SELECT count(*) INTO occupied FROM sliper.event_applications WHERE post_id=NEW.post_id AND id<>NEW.id AND (status='confirmed' OR (status='pending_payment' AND expires_at>statement_timestamp()));
   IF occupied>=settings.capacity THEN RAISE EXCEPTION 'event full'; END IF;
 END IF;
 IF NEW.source='external' AND NEW.status='refunded' AND NOT EXISTS(SELECT 1 FROM sliper.external_receipts WHERE application_id=NEW.id AND state='refunded') THEN RAISE EXCEPTION 'external refund not verified'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint

CREATE FUNCTION sliper.guard_event_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p sliper.posts; s sliper.event_settings; rev integer; cancelled timestamptz;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.post_id,NEW.kind,NEW.revision,NEW.reason,NEW.before_starts_at,NEW.before_ends_at,NEW.starts_at,NEW.ends_at,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.post_id,OLD.kind,OLD.revision,OLD.reason,OLD.before_starts_at,OLD.before_ends_at,OLD.starts_at,OLD.ends_at,OLD.created_at) OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL) THEN RAISE EXCEPTION 'event changes are immutable'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO p FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 SELECT * INTO s FROM sliper.event_settings WHERE post_id=NEW.post_id;
 SELECT revision,cancelled_at INTO rev,cancelled FROM sliper.event_lifecycle WHERE post_id=NEW.post_id;
 IF p.status<>'published' OR p.kind<>'모집' OR NEW.created_by IS DISTINCT FROM p.author_id OR NEW.created_by IS NULL OR NEW.revision<>coalesce(rev,0)+1 OR cancelled IS NOT NULL THEN RAISE EXCEPTION 'invalid owner event change'; END IF;
 IF s.starts_at<=statement_timestamp() OR EXISTS(SELECT 1 FROM sliper.event_admissions WHERE post_id=NEW.post_id) OR EXISTS(SELECT 1 FROM sliper.event_results WHERE post_id=NEW.post_id) THEN RAISE EXCEPTION 'event already started or attended'; END IF;
 IF (NEW.before_starts_at,NEW.before_ends_at) IS DISTINCT FROM (s.starts_at,s.ends_at) THEN RAISE EXCEPTION 'event change snapshot mismatch'; END IF;
 IF NEW.kind='reschedule' AND (NEW.starts_at<=statement_timestamp() OR NEW.ends_at<=NEW.starts_at) THEN RAISE EXCEPTION 'invalid new event schedule'; END IF;
 NEW.created_at:=statement_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER event_change_guard BEFORE INSERT OR UPDATE ON sliper.event_changes FOR EACH ROW EXECUTE FUNCTION sliper.guard_event_change();
--> statement-breakpoint
CREATE FUNCTION sliper.guard_event_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c sliper.event_changes;
BEGIN
 PERFORM 1 FROM sliper.posts WHERE id=NEW.post_id FOR UPDATE;
 IF TG_OP='UPDATE' AND (NEW.post_id<>OLD.post_id OR OLD.cancelled_at IS NOT NULL OR NEW.revision<>OLD.revision+1) THEN RAISE EXCEPTION 'invalid lifecycle transition'; END IF;
 SELECT * INTO c FROM sliper.event_changes WHERE post_id=NEW.post_id AND revision=NEW.revision;
 IF c.id IS NULL OR ((c.kind='cancel')<>(NEW.cancelled_at IS NOT NULL)) OR (c.kind='cancel' AND NEW.cancellation_reason<>c.reason) THEN RAISE EXCEPTION 'lifecycle requires matching change'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER event_lifecycle_guard BEFORE INSERT OR UPDATE ON sliper.event_lifecycle FOR EACH ROW EXECUTE FUNCTION sliper.guard_event_lifecycle();

--> statement-breakpoint
REVOKE ALL ON TABLE sliper.event_lifecycle, sliper.event_changes, sliper.event_change_recipients FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA sliper FROM PUBLIC,anon,authenticated;
