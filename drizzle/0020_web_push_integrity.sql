-- Endpoints are bound to the authenticated account that registered them. A new
-- owner must register a new endpoint instead of silently stealing a device.
CREATE FUNCTION sliper.guard_push_subscription_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.endpoint IS DISTINCT FROM OLD.endpoint
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Push subscription identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER push_subscription_owner_guard
BEFORE UPDATE ON sliper.push_subscriptions
FOR EACH ROW EXECUTE FUNCTION sliper.guard_push_subscription_owner();
--> statement-breakpoint
-- Application changes occur through several paths (free applications, manual
-- approval, payment callbacks and refunds). Keeping this outbox write in their
-- transaction prevents a successful approval from losing its notification job.
CREATE FUNCTION sliper.enqueue_application_push() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status NOT IN ('confirmed', 'refunded') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sliper.posts WHERE id = NEW.post_id AND status = 'published'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO sliper.push_deliveries (
    subscription_id, recipient_id, dedupe_key, kind, post_id,
    title, body, url
  )
  SELECT
    subscription.id,
    NEW.user_id,
    'application:' || NEW.id::text || ':' || NEW.status,
    'participation',
    NEW.post_id,
    CASE WHEN NEW.status = 'confirmed'
      THEN '참가가 확정됐어요'
      ELSE '환불 처리가 완료됐어요'
    END,
    'Sliper에서 행사와 신청 내역을 확인해주세요.',
    CASE WHEN NEW.status = 'confirmed'
      THEN '/rooms/' || NEW.post_id::text
      ELSE '/events/' || NEW.post_id::text
    END
  FROM sliper.push_subscriptions AS subscription
  LEFT JOIN sliper.push_preferences AS preferences
    ON preferences.user_id = subscription.user_id
  WHERE subscription.user_id = NEW.user_id
    AND COALESCE(preferences.participation, true)
    AND (subscription.expiration_time IS NULL
      OR subscription.expiration_time > statement_timestamp())
  ON CONFLICT (subscription_id, dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER application_web_push
AFTER INSERT OR UPDATE OF status ON sliper.event_applications
FOR EACH ROW EXECUTE FUNCTION sliper.enqueue_application_push();
--> statement-breakpoint
REVOKE ALL ON sliper.push_preferences, sliper.push_subscriptions, sliper.push_deliveries
FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sliper.guard_push_subscription_owner(), sliper.enqueue_application_push()
FROM PUBLIC, anon, authenticated;
