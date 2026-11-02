from django.db import migrations

FORWARD = """
CREATE SEQUENCE orders_invoice_number;
INSERT INTO orders_orderpolicy(id,advance_hours,version) VALUES(1,72,1);
CREATE FUNCTION orders_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Accepted agreement history is immutable'; END; $$;
CREATE TRIGGER orders_order_retained BEFORE UPDATE OR DELETE ON orders_sellerorder FOR EACH ROW EXECUTE FUNCTION orders_immutable();
CREATE TRIGGER orders_line_retained BEFORE UPDATE OR DELETE ON orders_orderline FOR EACH ROW EXECUTE FUNCTION orders_immutable();
CREATE TRIGGER orders_invoice_retained BEFORE UPDATE OR DELETE ON orders_invoice FOR EACH ROW EXECUTE FUNCTION orders_immutable();
CREATE TRIGGER orders_submission_retained BEFORE UPDATE OR DELETE ON orders_checkoutsubmission FOR EACH ROW EXECUTE FUNCTION orders_immutable();
CREATE TRIGGER orders_event_retained BEFORE UPDATE OR DELETE ON orders_orderevent FOR EACH ROW EXECUTE FUNCTION orders_immutable();
CREATE FUNCTION orders_outcome_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Seller outcome is retained'; END IF;
 IF OLD.state<>'pending' OR ROW(OLD.id,OLD.submission_id,OLD.seller_id) IS DISTINCT FROM ROW(NEW.id,NEW.submission_id,NEW.seller_id) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Outcome is terminal or stale'; END IF;
 IF NEW.state='accepted' AND NOT EXISTS(SELECT 1 FROM orders_sellerorder o JOIN orders_invoice i ON i.order_id=o.id WHERE o.outcome_id=NEW.id) THEN RAISE EXCEPTION 'Accepted outcome requires issued invoice'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER orders_outcome_retained BEFORE UPDATE OR DELETE ON orders_checkoutoutcome FOR EACH ROW EXECUTE FUNCTION orders_outcome_guard();
CREATE FUNCTION orders_line_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM orders_sellerorder o JOIN orders_checkoutoutcome c ON c.id=o.outcome_id JOIN catalogue_variant v ON v.id=NEW.variant_id JOIN catalogue_product p ON p.id=v.product_id WHERE o.id=NEW.order_id AND c.state='pending' AND p.seller_id=o.seller_id AND p.currency=o.currency AND p.pricing_mode='fixed') OR NEW.goods_amount<>round(NEW.quantity*NEW.unit_price,2) THEN RAISE EXCEPTION 'Invalid immutable order line'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER orders_line_scope BEFORE INSERT ON orders_orderline FOR EACH ROW EXECUTE FUNCTION orders_line_scope();
CREATE FUNCTION orders_agreement_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM orders_checkoutoutcome c JOIN orders_checkoutsubmission s ON s.id=c.submission_id WHERE c.id=NEW.outcome_id AND c.state='pending' AND c.seller_id=NEW.seller_id AND s.buyer_id=NEW.buyer_id AND s.payload->>'currency'=NEW.currency) THEN RAISE EXCEPTION 'Invalid seller agreement identity'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER orders_agreement_scope BEFORE INSERT ON orders_sellerorder FOR EACH ROW EXECUTE FUNCTION orders_agreement_scope();
CREATE FUNCTION orders_complete_agreement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM orders_orderline WHERE order_id=NEW.id) OR NEW.goods_total<>(SELECT sum(goods_amount) FROM orders_orderline WHERE order_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM orders_invoice WHERE order_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM orders_checkoutoutcome WHERE id=NEW.outcome_id AND state='accepted') OR NOT EXISTS(SELECT 1 FROM orders_orderevent WHERE order_id=NEW.id AND action='fixed_order_accepted') THEN RAISE EXCEPTION 'Incomplete order/invoice agreement'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER orders_complete_agreement AFTER INSERT ON orders_sellerorder DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_complete_agreement();
CREATE FUNCTION orders_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Commercial terms history is retained'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Stale terms/policy'; END IF;
 IF TG_TABLE_NAME='orders_sellercheckoutterms' THEN IF NEW.seller_id<>OLD.seller_id THEN RAISE EXCEPTION 'Terms identity immutable'; END IF; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER orders_terms_version BEFORE UPDATE OR DELETE ON orders_sellercheckoutterms FOR EACH ROW EXECUTE FUNCTION orders_version_guard();
CREATE TRIGGER orders_policy_version BEFORE UPDATE OR DELETE ON orders_orderpolicy FOR EACH ROW EXECUTE FUNCTION orders_version_guard();
"""
REVERSE = """
DROP TRIGGER orders_policy_version ON orders_orderpolicy; DROP TRIGGER orders_terms_version ON orders_sellercheckoutterms; DROP FUNCTION orders_version_guard();
DROP TRIGGER orders_complete_agreement ON orders_sellerorder; DROP FUNCTION orders_complete_agreement();
DROP TRIGGER orders_agreement_scope ON orders_sellerorder; DROP FUNCTION orders_agreement_scope();
DROP TRIGGER orders_line_scope ON orders_orderline; DROP FUNCTION orders_line_scope();
DROP TRIGGER orders_outcome_retained ON orders_checkoutoutcome; DROP FUNCTION orders_outcome_guard();
DROP TRIGGER orders_event_retained ON orders_orderevent; DROP TRIGGER orders_submission_retained ON orders_checkoutsubmission; DROP TRIGGER orders_invoice_retained ON orders_invoice; DROP TRIGGER orders_line_retained ON orders_orderline; DROP TRIGGER orders_order_retained ON orders_sellerorder; DROP FUNCTION orders_immutable(); DROP SEQUENCE orders_invoice_number;
"""


class Migration(migrations.Migration):
    dependencies = [("orders", "0001_initial"), ("cart", "0002_cart_guards")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
