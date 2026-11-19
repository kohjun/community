ALTER TABLE "sliper"."event_settings" ADD COLUMN "participant_chat_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."room_messages" ADD COLUMN "is_announcement" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sliper"."event_settings" ADD CONSTRAINT "event_participant_chat_lightning_only" CHECK (not "sliper"."event_settings"."participant_chat_enabled" or "sliper"."event_settings"."meetup_type" = 'lightning');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sliper.guard_room_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_owner uuid;
  event_kind text;
  event_status text;
  is_manager boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.post_id, NEW.body, NEW.created_at, NEW.is_announcement)
      IS DISTINCT FROM (OLD.id, OLD.post_id, OLD.body, OLD.created_at, OLD.is_announcement)
      OR NEW.author_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'room messages are immutable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT author_id, kind, status INTO event_owner, event_kind, event_status
  FROM sliper.posts WHERE id = NEW.post_id FOR UPDATE;
  IF NEW.author_id IS NULL OR event_kind IS DISTINCT FROM '모집'
    OR event_status IS DISTINCT FROM 'published'
  THEN
    RAISE EXCEPTION 'a published recruitment and message author are required';
  END IF;
  is_manager := NEW.author_id IS NOT DISTINCT FROM event_owner OR EXISTS (
    SELECT 1 FROM sliper.room_managers WHERE post_id = NEW.post_id AND user_id = NEW.author_id
  );

  IF NEW.is_announcement THEN
    IF NOT is_manager THEN
      RAISE EXCEPTION 'only event managers may publish announcements';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM sliper.event_settings
    WHERE post_id = NEW.post_id AND meetup_type = 'lightning' AND participant_chat_enabled
  ) OR NOT (is_manager OR EXISTS (
    SELECT 1 FROM sliper.room_members member
    JOIN sliper.event_applications application ON application.id = member.application_id
    WHERE member.post_id = NEW.post_id AND member.user_id = NEW.author_id
      AND member.revoked_at IS NULL AND application.status = 'confirmed'
  )) THEN
    RAISE EXCEPTION 'chat requires an open lightning room and a confirmed member or manager';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER engagement_room_ingress ON sliper.room_messages;
--> statement-breakpoint
CREATE TRIGGER engagement_room_ingress AFTER INSERT ON sliper.room_messages
FOR EACH ROW WHEN (NEW.is_announcement) EXECUTE FUNCTION sliper.enqueue_engagement_event();
