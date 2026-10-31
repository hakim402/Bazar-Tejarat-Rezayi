from django.db import migrations

FORWARD = """
CREATE FUNCTION notifications_order_cursor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Order notice intent retained'; END IF;
 IF OLD.complete OR ROW(OLD.event_id,OLD.sender_id) IS DISTINCT FROM ROW(NEW.event_id,NEW.sender_id) OR NEW.version<>OLD.version+1 OR (OLD.after_account IS NOT NULL AND (NEW.after_account IS NULL OR NEW.after_account<OLD.after_account)) THEN RAISE EXCEPTION 'Invalid order notice recovery state'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER notifications_order_cursor_guard BEFORE UPDATE OR DELETE ON notifications_ordernoticecursor FOR EACH ROW EXECUTE FUNCTION notifications_order_cursor_guard();
"""
REVERSE = "DROP TRIGGER notifications_order_cursor_guard ON notifications_ordernoticecursor; DROP FUNCTION notifications_order_cursor_guard();"


class Migration(migrations.Migration):
    dependencies = [("notifications", "0005_ordernoticecursor")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
