from django.db import migrations

FORWARD = """
CREATE FUNCTION cart_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.account_id IS NOT NULL OR OLD.consumed_by_id IS NOT NULL OR OLD.expires_at>statement_timestamp() THEN RAISE EXCEPTION 'Retained account/merged/active cart'; END IF; RETURN OLD;
 END IF;
 IF ROW(OLD.id,OLD.account_id,OLD.guest_key) IS DISTINCT FROM ROW(NEW.id,NEW.account_id,NEW.guest_key) OR NEW.version<>OLD.version+1 OR OLD.consumed_by_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid cart identity/version'; END IF;
 IF NEW.consumed_by_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts_account WHERE id=NEW.consumed_by_id AND context='buyer') THEN RAISE EXCEPTION 'Invalid merge buyer'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER cart_identity_retained BEFORE UPDATE OR DELETE ON cart_cart FOR EACH ROW EXECUTE FUNCTION cart_identity_guard();
CREATE FUNCTION cart_receipt_retained() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Merge receipt is retained'; END; $$;
CREATE TRIGGER cart_merge_retained BEFORE UPDATE OR DELETE ON cart_mergereceipt FOR EACH ROW EXECUTE FUNCTION cart_receipt_retained();
CREATE FUNCTION cart_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.quantity<=0 OR NEW.quantity>999999999.999 OR NOT EXISTS(SELECT 1 FROM catalogue_variant v JOIN catalogue_saleunit u ON u.code=v.unit_id WHERE v.id=NEW.variant_id AND mod(NEW.quantity,v.quantity_increment)=0 AND (u.fractional OR NEW.quantity=trunc(NEW.quantity))) THEN RAISE EXCEPTION 'Invalid cart quantity'; END IF;
 IF TG_OP='UPDATE' AND (ROW(OLD.id,OLD.cart_id,OLD.variant_id,OLD.tier) IS DISTINCT FROM ROW(NEW.id,NEW.cart_id,NEW.variant_id,NEW.tier) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Invalid cart selection change'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER cart_line_validated BEFORE INSERT OR UPDATE ON cart_cartline FOR EACH ROW EXECUTE FUNCTION cart_line_guard();
"""
REVERSE = """DROP TRIGGER cart_line_validated ON cart_cartline; DROP FUNCTION cart_line_guard(); DROP TRIGGER cart_merge_retained ON cart_mergereceipt; DROP FUNCTION cart_receipt_retained(); DROP TRIGGER cart_identity_retained ON cart_cart; DROP FUNCTION cart_identity_guard();"""


class Migration(migrations.Migration):
    dependencies = [("cart", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
