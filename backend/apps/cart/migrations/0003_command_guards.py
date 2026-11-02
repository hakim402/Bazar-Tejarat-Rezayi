from django.db import migrations

FORWARD = """
CREATE FUNCTION cart_buyer_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts_account WHERE id=NEW.account_id AND context='buyer') THEN RAISE EXCEPTION 'Cart requires buyer identity'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER cart_buyer_identity BEFORE INSERT ON cart_cart FOR EACH ROW EXECUTE FUNCTION cart_buyer_identity();
CREATE FUNCTION cart_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' OR EXISTS(SELECT 1 FROM cart_cart WHERE id=OLD.cart_id AND (account_id IS NOT NULL OR consumed_by_id IS NOT NULL OR expires_at>statement_timestamp())) THEN RAISE EXCEPTION 'Cart command retained'; END IF; RETURN OLD;
END; $$;
CREATE TRIGGER cart_command_guard BEFORE UPDATE OR DELETE ON cart_cartcommand FOR EACH ROW EXECUTE FUNCTION cart_command_guard();
CREATE FUNCTION cart_consumed_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE selected uuid; BEGIN
 IF TG_OP='DELETE' THEN selected=OLD.cart_id; ELSE selected=NEW.cart_id; END IF;
 PERFORM 1 FROM cart_cart WHERE id=selected FOR UPDATE;
 IF EXISTS(SELECT 1 FROM cart_cart WHERE id=selected AND consumed_by_id IS NOT NULL) THEN RAISE EXCEPTION 'Consumed cart contribution retained'; END IF;
 IF TG_OP='INSERT' AND (SELECT count(*) FROM cart_cartline WHERE cart_id=selected)>=100 THEN RAISE EXCEPTION 'Cart selection limit'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER cart_consumed_line_guard BEFORE INSERT OR UPDATE OR DELETE ON cart_cartline FOR EACH ROW EXECUTE FUNCTION cart_consumed_line_guard();
"""
REVERSE = """DROP TRIGGER cart_consumed_line_guard ON cart_cartline; DROP FUNCTION cart_consumed_line_guard(); DROP TRIGGER cart_command_guard ON cart_cartcommand; DROP FUNCTION cart_command_guard(); DROP TRIGGER cart_buyer_identity ON cart_cart; DROP FUNCTION cart_buyer_identity();"""


class Migration(migrations.Migration):
    dependencies = [("cart", "0002_cart_guards")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
