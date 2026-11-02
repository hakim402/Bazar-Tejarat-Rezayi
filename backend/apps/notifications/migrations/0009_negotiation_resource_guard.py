from django.db import migrations

SQL = """
CREATE OR REPLACE FUNCTION notifications_notice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification history retained'; END IF;
 IF ROW(OLD.id,OLD.event_id,OLD.account_id,OLD.conversation_id,OLD.order_id,OLD.negotiation_id,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.event_id,NEW.account_id,NEW.conversation_id,NEW.order_id,NEW.negotiation_id,NEW.created_at) OR OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN RAISE EXCEPTION 'Notice identity/read history immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION notifications_resource_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.negotiation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e JOIN orders_negotiationevent r ON r.id=e.negotiation_event_id WHERE e.id=NEW.event_id AND r.request_id=NEW.negotiation_id AND e.kind='negotiation') OR NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.kind='order_accepted') OR NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.order_id IS NULL AND e.negotiation_event_id IS NULL) THEN RAISE EXCEPTION 'Wrong notification resource'; END IF;
 RETURN NEW;
END; $$;
"""


REVERSE = "DO $$ BEGIN IF EXISTS(SELECT 1 FROM notifications_event WHERE negotiation_event_id IS NOT NULL) OR EXISTS(SELECT 1 FROM notifications_notice WHERE negotiation_id IS NOT NULL) THEN RAISE EXCEPTION 'Refuse rollback with retained request notices'; END IF; END; $$;\nCREATE OR REPLACE FUNCTION notifications_notice_guard() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification history is retained'; END IF;\n IF ROW(OLD.id,OLD.event_id,OLD.account_id,OLD.conversation_id,OLD.order_id,OLD.created_at) IS DISTINCT FROM ROW(NEW.id,NEW.event_id,NEW.account_id,NEW.conversation_id,NEW.order_id,NEW.created_at) OR OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN RAISE EXCEPTION 'Notice identity/read history is immutable'; END IF;\n RETURN NEW;\nEND; $$;\nCREATE OR REPLACE FUNCTION notifications_resource_scope() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n IF NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.kind='order_accepted') OR NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.order_id IS NULL) THEN RAISE EXCEPTION 'Wrong notification resource'; END IF;\n RETURN NEW;\nEND; $$;\n"


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0008_event_negotiation_event_notice_negotiation_and_more"),
        ("orders", "0004_negotiation_guards"),
    ]
    operations = [migrations.RunSQL(SQL, REVERSE)]
