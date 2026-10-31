from django.db import migrations

FORWARD = """
CREATE FUNCTION notifications_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Notification history is retained'; END; $$;
CREATE TRIGGER notifications_event_retained BEFORE UPDATE OR DELETE ON notifications_event FOR EACH ROW EXECUTE FUNCTION notifications_append_only();
CREATE TRIGGER notifications_attempt_retained BEFORE UPDATE OR DELETE ON notifications_attempt FOR EACH ROW EXECUTE FUNCTION notifications_append_only();
CREATE FUNCTION notifications_notice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification history is retained'; END IF;
 IF ROW(OLD.id,OLD.event_id,OLD.account_id,OLD.conversation_id,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.event_id,NEW.account_id,NEW.conversation_id,NEW.created_at) OR OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN RAISE EXCEPTION 'Notice identity/read history is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER notifications_notice_retained BEFORE UPDATE OR DELETE ON notifications_notice FOR EACH ROW EXECUTE FUNCTION notifications_notice_guard();
CREATE FUNCTION notifications_outbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Delivery history is retained'; END IF;
 IF ROW(OLD.id,OLD.conversation_id,OLD.account_id,OLD.episode,OLD.identity_digest,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.conversation_id,NEW.account_id,NEW.episode,NEW.identity_digest,NEW.created_at) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid delivery history change'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER notifications_outbox_retained BEFORE UPDATE OR DELETE ON notifications_outbox FOR EACH ROW EXECUTE FUNCTION notifications_outbox_guard();
"""
REVERSE = """
DROP TRIGGER notifications_outbox_retained ON notifications_outbox; DROP FUNCTION notifications_outbox_guard();
DROP TRIGGER notifications_notice_retained ON notifications_notice; DROP FUNCTION notifications_notice_guard();
DROP TRIGGER notifications_attempt_retained ON notifications_attempt;
DROP TRIGGER notifications_event_retained ON notifications_event; DROP FUNCTION notifications_append_only();
"""


class Migration(migrations.Migration):
    dependencies = [("notifications", "0001_initial"), ("messaging", "0002_retained_history")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
