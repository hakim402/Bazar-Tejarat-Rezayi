from django.db import migrations

FORWARD = """
CREATE OR REPLACE FUNCTION notifications_notice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification history is retained'; END IF;
 IF ROW(OLD.id,OLD.event_id,OLD.account_id,OLD.conversation_id,OLD.order_id,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.event_id,NEW.account_id,NEW.conversation_id,NEW.order_id,NEW.created_at) OR OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN RAISE EXCEPTION 'Notice identity/read history is immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION notifications_resource_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.kind='order_accepted') OR NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.order_id IS NULL) THEN RAISE EXCEPTION 'Wrong notification resource'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER notifications_resource_scope BEFORE INSERT ON notifications_notice FOR EACH ROW EXECUTE FUNCTION notifications_resource_scope();
"""
REVERSE = """DROP TRIGGER notifications_resource_scope ON notifications_notice; DROP FUNCTION notifications_resource_scope();
CREATE OR REPLACE FUNCTION notifications_notice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification history is retained'; END IF;
 IF ROW(OLD.id,OLD.event_id,OLD.account_id,OLD.conversation_id,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.event_id,NEW.account_id,NEW.conversation_id,NEW.created_at) OR OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN RAISE EXCEPTION 'Notice identity/read history is immutable'; END IF;
 RETURN NEW;
END; $$;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0003_event_order_notice_order_alter_event_kind_and_more"),
        ("orders", "0002_agreement_guards"),
    ]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
