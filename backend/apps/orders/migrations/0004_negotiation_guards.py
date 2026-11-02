"""Extend retained agreement guards with an explicit negotiation origin."""

from django.db import migrations

FORWARD = r"""
CREATE TRIGGER orders_request_submission_retained BEFORE UPDATE OR DELETE ON orders_negotiationsubmission FOR EACH ROW EXECUTE FUNCTION orders_immutable();
CREATE TRIGGER orders_request_revision_retained BEFORE UPDATE OR DELETE ON orders_negotiationrevision FOR EACH ROW EXECUTE FUNCTION orders_immutable();
CREATE TRIGGER orders_request_event_retained BEFORE UPDATE OR DELETE ON orders_negotiationevent FOR EACH ROW EXECUTE FUNCTION orders_immutable();
CREATE TRIGGER orders_request_command_retained BEFORE UPDATE OR DELETE ON orders_negotiationcommand FOR EACH ROW EXECUTE FUNCTION orders_immutable();
CREATE FUNCTION orders_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Request history retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'submitted' OR NEW.version<>1 OR NEW.revision<>1 OR NOT EXISTS(SELECT 1 FROM orders_negotiationoutcome o JOIN orders_negotiationsubmission s ON s.id=o.submission_id WHERE o.id=NEW.outcome_id AND o.state='pending' AND s.buyer_id=NEW.buyer_id AND o.seller_id=NEW.seller_id AND s.payload->>'currency'=NEW.currency) THEN RAISE EXCEPTION 'Invalid request origin'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.outcome_id,NEW.buyer_id,NEW.seller_id,NEW.currency,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.outcome_id,OLD.buyer_id,OLD.seller_id,OLD.currency,OLD.created_at) OR NEW.version<>OLD.version+1 OR NOT ((OLD.state IN ('submitted','correction_requested') AND NEW.state IN ('withdrawn','rejected') AND NEW.revision=OLD.revision) OR (OLD.state='submitted' AND NEW.state IN ('accepted','correction_requested') AND NEW.revision=OLD.revision) OR (OLD.state='correction_requested' AND NEW.state='submitted' AND NEW.revision=OLD.revision+1)) THEN RAISE EXCEPTION 'Invalid request transition'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER orders_request_guard BEFORE INSERT OR UPDATE OR DELETE ON orders_negotiation FOR EACH ROW EXECUTE FUNCTION orders_request_guard();
CREATE FUNCTION orders_revision_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r orders_negotiation; l jsonb; previous jsonb;
BEGIN
 SELECT * INTO r FROM orders_negotiation WHERE id=NEW.request_id FOR UPDATE;
 IF NEW.actor_id<>r.buyer_id OR NEW.number<>r.revision+(CASE WHEN r.state='correction_requested' THEN 1 ELSE 0 END) OR (NEW.number>1 AND r.state<>'correction_requested') OR NEW.body->>'explanation' IS DISTINCT FROM 'seller-finalizes-v1' OR jsonb_typeof(NEW.body->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.body->'lines') NOT BETWEEN 1 AND 100 OR NEW.body->'choice'->>'seller' IS DISTINCT FROM r.seller_id::text THEN RAISE EXCEPTION 'Invalid buyer revision'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(NEW.body->'lines'))<>(SELECT count(DISTINCT (x->>'variant',x->>'tier')) FROM jsonb_array_elements(NEW.body->'lines') x) THEN RAISE EXCEPTION 'Duplicate proposal selection'; END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(NEW.body->'lines') LOOP
  IF l->>'unit_price' IS NULL OR l->>'max_unit_price' IS NULL OR l->>'quantity' IS NULL OR l->>'max_quantity' IS NULL OR l->>'unit_price' !~ '^\d{1,9}\.\d{2}$' OR l->>'max_unit_price' !~ '^\d{1,9}\.\d{2}$' OR l->>'quantity' !~ '^\d{1,9}(\.\d{1,3})?$' OR l->>'max_quantity' !~ '^\d{1,9}(\.\d{1,3})?$' OR NOT ((l->>'unit_price')::numeric>0 AND (l->>'unit_price')::numeric<=(l->>'max_unit_price')::numeric AND (l->>'quantity')::numeric>0 AND (l->>'quantity')::numeric<=(l->>'max_quantity')::numeric) OR l->>'tier' NOT IN ('retail','wholesale') OR NOT EXISTS(SELECT 1 FROM catalogue_variant v JOIN catalogue_product p ON p.id=v.product_id WHERE v.id=(l->>'variant')::uuid AND p.seller_id=r.seller_id AND p.currency=r.currency AND p.pricing_mode='negotiable' AND mod((l->>'quantity')::numeric,v.quantity_increment)=0 AND mod((l->>'max_quantity')::numeric,v.quantity_increment)=0) THEN RAISE EXCEPTION 'Invalid proposal limits/scope'; END IF;
 END LOOP;
 IF NEW.number=1 AND NOT EXISTS(SELECT 1 FROM orders_negotiationoutcome o JOIN orders_negotiationsubmission sub ON sub.id=o.submission_id CROSS JOIN LATERAL jsonb_array_elements(sub.payload->'proposals') p WHERE o.id=r.outcome_id AND p->'choice'->>'seller'=r.seller_id::text AND (NEW.body-'context'-'goods_total')=p) THEN RAISE EXCEPTION 'Initial revision must retain buyer submission'; END IF;
 IF NEW.number>1 THEN
  SELECT body INTO previous FROM orders_negotiationrevision WHERE request_id=r.id AND number=NEW.number-1;
  IF previous IS NULL OR (SELECT jsonb_agg(k ORDER BY k) FROM (SELECT (x->>'variant')||':'||(x->>'tier') k FROM jsonb_array_elements(previous->'lines') x) a) IS DISTINCT FROM (SELECT jsonb_agg(k ORDER BY k) FROM (SELECT (x->>'variant')||':'||(x->>'tier') k FROM jsonb_array_elements(NEW.body->'lines') x) a) THEN RAISE EXCEPTION 'Request selection immutable'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER orders_revision_scope BEFORE INSERT ON orders_negotiationrevision FOR EACH ROW EXECUTE FUNCTION orders_revision_scope();
CREATE FUNCTION orders_request_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r orders_negotiation;
BEGIN
 SELECT * INTO r FROM orders_negotiation WHERE id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM orders_negotiationrevision WHERE request_id=r.id AND number=r.revision) OR NOT EXISTS(SELECT 1 FROM orders_negotiationevent WHERE request_id=r.id AND version=r.version AND revision=r.revision AND action=CASE WHEN r.state='submitted' AND r.version>1 THEN 'resubmitted' ELSE r.state END) OR (r.state='accepted' AND NOT EXISTS(SELECT 1 FROM orders_sellerorder o JOIN orders_invoice i ON i.order_id=o.id WHERE o.negotiation_id=r.id)) THEN RAISE EXCEPTION 'Incomplete request history/agreement'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER orders_request_complete AFTER INSERT OR UPDATE ON orders_negotiation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_request_complete();
CREATE FUNCTION orders_request_event_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r orders_negotiation;
BEGIN
 SELECT * INTO r FROM orders_negotiation WHERE id=NEW.request_id;
 IF NEW.version<>r.version OR NEW.revision<>r.revision OR NEW.action<>(CASE WHEN r.state='submitted' AND r.version>1 THEN 'resubmitted' ELSE r.state END) OR (NEW.action IN ('submitted','resubmitted','withdrawn') AND NEW.actor_id<>r.buyer_id) OR (NEW.action IN ('accepted','rejected','correction_requested') AND NOT EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.actor_id AND a.context='seller' AND (EXISTS(SELECT 1 FROM organizations_businessprofile p WHERE p.id=r.seller_id AND p.kind='individual' AND p.account_id=a.id) OR EXISTS(SELECT 1 FROM organizations_membership m WHERE m.company_id=r.seller_id AND m.account_id=a.id AND m.active AND (m.is_owner OR m.bundles @> '["orders_negotiation"]'::jsonb))))) THEN RAISE EXCEPTION 'Wrong request event/actor'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER orders_request_event_scope BEFORE INSERT ON orders_negotiationevent FOR EACH ROW EXECUTE FUNCTION orders_request_event_scope();
CREATE FUNCTION orders_request_outcome_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Request outcome retained'; END IF;
 IF OLD.state<>'pending' OR ROW(OLD.id,OLD.submission_id,OLD.seller_id) IS DISTINCT FROM ROW(NEW.id,NEW.submission_id,NEW.seller_id) OR NEW.version<>OLD.version+1 OR NEW.state='submitted' AND NOT EXISTS(SELECT 1 FROM orders_negotiation WHERE outcome_id=NEW.id) THEN RAISE EXCEPTION 'Terminal/stale request outcome'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER orders_request_outcome_guard BEFORE UPDATE OR DELETE ON orders_negotiationoutcome FOR EACH ROW EXECUTE FUNCTION orders_request_outcome_guard();
CREATE OR REPLACE FUNCTION orders_agreement_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.negotiation_id IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM orders_checkoutoutcome c JOIN orders_checkoutsubmission s ON s.id=c.submission_id WHERE c.id=NEW.outcome_id AND c.state='pending' AND c.seller_id=NEW.seller_id AND s.buyer_id=NEW.buyer_id AND s.payload->>'currency'=NEW.currency) THEN RAISE EXCEPTION 'Invalid seller agreement identity'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM orders_negotiation r WHERE r.id=NEW.negotiation_id AND r.state='submitted' AND r.buyer_id=NEW.buyer_id AND r.seller_id=NEW.seller_id AND r.currency=NEW.currency) OR NEW.snapshot->>'origin' IS DISTINCT FROM 'negotiated' THEN RAISE EXCEPTION 'Invalid negotiated origin'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION orders_line_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o orders_sellerorder; r orders_negotiation; caps jsonb;
BEGIN
 SELECT * INTO o FROM orders_sellerorder WHERE id=NEW.order_id;
 IF NEW.goods_amount<>round(NEW.quantity*NEW.unit_price,2) THEN RAISE EXCEPTION 'Invalid line arithmetic'; END IF;
 IF o.negotiation_id IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM orders_checkoutoutcome c JOIN catalogue_variant v ON v.id=NEW.variant_id JOIN catalogue_product p ON p.id=v.product_id WHERE c.id=o.outcome_id AND c.state='pending' AND p.seller_id=o.seller_id AND p.currency=o.currency AND p.pricing_mode='fixed') THEN RAISE EXCEPTION 'Invalid fixed line'; END IF;
 ELSE
  SELECT * INTO r FROM orders_negotiation WHERE id=o.negotiation_id;
  SELECT x INTO caps FROM orders_negotiationrevision rev CROSS JOIN LATERAL jsonb_array_elements(rev.body->'lines') x WHERE rev.request_id=r.id AND rev.number=r.revision AND x->>'variant'=NEW.variant_id::text AND x->>'tier'=NEW.tier;
  IF r.state<>'submitted' OR caps IS NULL OR NEW.quantity>(caps->>'max_quantity')::numeric OR NEW.unit_price>(caps->>'max_unit_price')::numeric OR NEW.snapshot->>'max_unit_price' IS DISTINCT FROM caps->>'max_unit_price' OR NEW.snapshot->>'max_quantity' IS DISTINCT FROM caps->>'max_quantity' OR NEW.snapshot->>'buyer_revision' IS DISTINCT FROM r.revision::text OR NOT EXISTS(SELECT 1 FROM catalogue_variant v JOIN catalogue_product p ON p.id=v.product_id WHERE v.id=NEW.variant_id AND p.seller_id=o.seller_id AND p.currency=o.currency AND p.pricing_mode='negotiable' AND mod(NEW.quantity,v.quantity_increment)=0 AND (NEW.tier<>'wholesale' OR NEW.quantity>=v.minimum_wholesale)) THEN RAISE EXCEPTION 'Negotiated scope/limits violation'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION orders_complete_agreement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r orders_negotiation; proposal jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM orders_orderline WHERE order_id=NEW.id) OR NEW.goods_total<>(SELECT sum(goods_amount) FROM orders_orderline WHERE order_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM orders_invoice WHERE order_id=NEW.id) THEN RAISE EXCEPTION 'Incomplete order/invoice agreement'; END IF;
 IF NEW.negotiation_id IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM orders_checkoutoutcome WHERE id=NEW.outcome_id AND state='accepted') OR NOT EXISTS(SELECT 1 FROM orders_orderevent WHERE order_id=NEW.id AND action='fixed_order_accepted') THEN RAISE EXCEPTION 'Incomplete fixed agreement'; END IF;
 ELSE
  SELECT * INTO r FROM orders_negotiation WHERE id=NEW.negotiation_id;
  SELECT body INTO proposal FROM orders_negotiationrevision WHERE request_id=r.id AND number=r.revision;
  IF r.state<>'accepted' OR (SELECT count(*) FROM orders_orderline WHERE order_id=NEW.id)<>jsonb_array_length(proposal->'lines') OR NEW.snapshot->'proposal' IS DISTINCT FROM proposal OR NOT EXISTS(SELECT 1 FROM orders_orderevent WHERE order_id=NEW.id AND action='negotiated_order_accepted') OR NOT EXISTS(SELECT 1 FROM orders_negotiationevent e WHERE e.request_id=r.id AND e.version=r.version AND e.action='accepted' AND e.actor_id::text=NEW.snapshot->'finalizer'->>'account') THEN RAISE EXCEPTION 'Incomplete negotiated agreement'; END IF;
 END IF;
 RETURN NEW;
END; $$;
"""


REVERSE = "DO $$ BEGIN IF EXISTS(SELECT 1 FROM orders_negotiation) OR EXISTS(SELECT 1 FROM orders_negotiationsubmission) THEN RAISE EXCEPTION 'Refuse rollback with retained Phase 11 data'; END IF; END; $$;\nDROP TRIGGER orders_request_submission_retained ON orders_negotiationsubmission;\nDROP TRIGGER orders_request_revision_retained ON orders_negotiationrevision;\nDROP TRIGGER orders_request_event_retained ON orders_negotiationevent;\nDROP TRIGGER orders_request_command_retained ON orders_negotiationcommand;\nDROP TRIGGER orders_request_guard ON orders_negotiation;\nDROP TRIGGER orders_revision_scope ON orders_negotiationrevision;\nDROP TRIGGER orders_request_complete ON orders_negotiation;\nDROP TRIGGER orders_request_event_scope ON orders_negotiationevent;\nDROP TRIGGER orders_request_outcome_guard ON orders_negotiationoutcome;\nDROP FUNCTION orders_request_guard();\nDROP FUNCTION orders_revision_scope();\nDROP FUNCTION orders_request_complete();\nDROP FUNCTION orders_request_event_scope();\nDROP FUNCTION orders_request_outcome_guard();\nCREATE OR REPLACE FUNCTION orders_line_scope() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n IF NOT EXISTS(SELECT 1 FROM orders_sellerorder o JOIN orders_checkoutoutcome c ON c.id=o.outcome_id JOIN catalogue_variant v ON v.id=NEW.variant_id JOIN catalogue_product p ON p.id=v.product_id WHERE o.id=NEW.order_id AND c.state='pending' AND p.seller_id=o.seller_id AND p.currency=o.currency AND p.pricing_mode='fixed') OR NEW.goods_amount<>round(NEW.quantity*NEW.unit_price,2) THEN RAISE EXCEPTION 'Invalid immutable order line'; END IF;\n RETURN NEW;\nEND; $$;\nCREATE OR REPLACE FUNCTION orders_agreement_scope() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n IF NOT EXISTS(SELECT 1 FROM orders_checkoutoutcome c JOIN orders_checkoutsubmission s ON s.id=c.submission_id WHERE c.id=NEW.outcome_id AND c.state='pending' AND c.seller_id=NEW.seller_id AND s.buyer_id=NEW.buyer_id AND s.payload->>'currency'=NEW.currency) THEN RAISE EXCEPTION 'Invalid seller agreement identity'; END IF;\n RETURN NEW;\nEND; $$;\nCREATE OR REPLACE FUNCTION orders_complete_agreement() RETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n IF NOT EXISTS(SELECT 1 FROM orders_orderline WHERE order_id=NEW.id) OR NEW.goods_total<>(SELECT sum(goods_amount) FROM orders_orderline WHERE order_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM orders_invoice WHERE order_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM orders_checkoutoutcome WHERE id=NEW.outcome_id AND state='accepted') OR NOT EXISTS(SELECT 1 FROM orders_orderevent WHERE order_id=NEW.id AND action='fixed_order_accepted') THEN RAISE EXCEPTION 'Incomplete order/invoice agreement'; END IF;\n RETURN NEW;\nEND; $$;\n"


class Migration(migrations.Migration):
    dependencies = [("orders", "0003_negotiationcommand_negotiationevent_and_more")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
