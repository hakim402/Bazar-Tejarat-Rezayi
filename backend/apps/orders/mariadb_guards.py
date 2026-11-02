"""Immediate native validation at the authoritative acceptance/event boundary.

Private construction rows may exist, but acceptance cannot. Parent locks serialize
line insertion with publication; no writable connection flag disables guards.
"""
from apps.runtime.mariadb.ddl import reject, same, trigger


def j(value, path):
    return f"JSON_UNQUOTE(JSON_EXTRACT({value},'$.{path}'))"


def lines(value):
    return f"""JSON_TABLE({value}, '$.lines[*]' COLUMNS (
        variant VARCHAR(64) PATH '$.variant', tier VARCHAR(32) PATH '$.tier',
        price VARCHAR(64) PATH '$.unit_price', cap VARCHAR(64) PATH '$.max_unit_price',
        quantity VARCHAR(64) PATH '$.quantity', maximum VARCHAR(64) PATH '$.max_quantity'
    ))"""


def complete(order_alias="o"):
    o = order_alias
    return f"""EXISTS(SELECT 1 FROM orders_orderline WHERE order_id={o}.id)
        AND {o}.goods_total=(SELECT SUM(goods_amount) FROM orders_orderline WHERE order_id={o}.id)
        AND EXISTS(SELECT 1 FROM orders_invoice WHERE order_id={o}.id)
        AND EXISTS(SELECT 1 FROM orders_orderevent WHERE order_id={o}.id
            AND action=CASE WHEN {o}.negotiation_id IS NULL THEN 'fixed_order_accepted' ELSE 'negotiated_order_accepted' END)"""


def statements():
    result = ["CREATE SEQUENCE orders_invoice_number START WITH 1 INCREMENT BY 1 NOCACHE",
              "INSERT INTO orders_orderpolicy(id,advance_hours,version) VALUES(1,72,1)"]
    for table, key in (("orders_sellercheckoutterms", "seller_id"), ("orders_orderpolicy", "id")):
        result += [trigger(table, "DELETE", reject()), trigger(table, "UPDATE", reject(f"NEW.version<>OLD.version+1 OR NEW.{key}<>OLD.{key}"))]
    # Order insertion is construction only. Operational readers scope to the
    # terminal outcome/request validated below, not merely row existence.
    origin = f"""(NEW.negotiation_id IS NULL AND NOT EXISTS(SELECT 1 FROM orders_checkoutoutcome c
        JOIN orders_checkoutsubmission s ON s.id=c.submission_id WHERE c.id=NEW.outcome_id AND c.state='pending'
        AND c.seller_id=NEW.seller_id AND s.buyer_id=NEW.buyer_id AND {j('s.payload','currency')}=NEW.currency))
        OR (NEW.negotiation_id IS NOT NULL AND (NOT ({j('NEW.snapshot','origin')} <=> 'negotiated')
        OR NOT EXISTS(SELECT 1 FROM orders_negotiation r WHERE r.id=NEW.negotiation_id AND r.state='submitted'
        AND r.buyer_id=NEW.buyer_id AND r.seller_id=NEW.seller_id AND r.currency=NEW.currency)))"""
    result.append(trigger("orders_sellerorder", "INSERT", reject(origin)))
    # A current locking read of the origin precedes the immutable header lock.
    # This also works if a caller selects a stricter isolation level.
    body = """DECLARE origin_id CHAR(32); DECLARE request_id CHAR(32); DECLARE header_id CHAR(32);
        SELECT outcome_id,negotiation_id INTO origin_id,request_id FROM orders_sellerorder WHERE id=NEW.order_id;
        IF request_id IS NULL THEN
            SELECT id INTO origin_id FROM orders_checkoutoutcome WHERE id=origin_id FOR UPDATE;
        ELSE
            SELECT id INTO request_id FROM orders_negotiation WHERE id=request_id FOR UPDATE;
        END IF;
        SELECT id INTO header_id FROM orders_sellerorder WHERE id=NEW.order_id FOR UPDATE;
    """
    body += reject("NEW.goods_amount<>ROUND(NEW.quantity*NEW.unit_price,2)", "Invalid immutable line arithmetic")
    fixed = """EXISTS(SELECT 1 FROM orders_sellerorder o JOIN orders_checkoutoutcome c ON c.id=o.outcome_id
        JOIN catalogue_variant v ON v.id=NEW.variant_id JOIN catalogue_product p ON p.id=v.product_id
        WHERE o.id=NEW.order_id AND c.state='pending' AND p.seller_id=o.seller_id
        AND p.currency=o.currency AND p.pricing_mode='fixed')"""
    negotiated = f"""EXISTS(SELECT 1 FROM orders_sellerorder o JOIN orders_negotiation r ON r.id=o.negotiation_id
        JOIN orders_negotiationrevision rev ON rev.request_id=r.id AND rev.number=r.revision
        JOIN {lines('rev.body')} caps ON caps.variant=CONCAT(SUBSTRING(NEW.variant_id,1,8),'-',SUBSTRING(NEW.variant_id,9,4),'-',SUBSTRING(NEW.variant_id,13,4),'-',SUBSTRING(NEW.variant_id,17,4),'-',SUBSTRING(NEW.variant_id,21,12)) AND caps.tier=NEW.tier
        JOIN catalogue_variant v ON v.id=NEW.variant_id JOIN catalogue_product p ON p.id=v.product_id
        WHERE o.id=NEW.order_id AND r.state='submitted'
        AND NEW.quantity<=CAST(caps.maximum AS DECIMAL(12,3)) AND NEW.unit_price<=CAST(caps.cap AS DECIMAL(11,2))
        AND ({j('NEW.snapshot','max_unit_price')} <=> caps.cap)
        AND ({j('NEW.snapshot','max_quantity')} <=> caps.maximum)
        AND ({j('NEW.snapshot','buyer_revision')} <=> CAST(r.revision AS CHAR))
        AND p.seller_id=o.seller_id AND p.currency=o.currency AND p.pricing_mode='negotiable'
        AND MOD(NEW.quantity,v.quantity_increment)=0 AND (NEW.tier<>'wholesale' OR NEW.quantity>=v.minimum_wholesale))"""
    body += reject(f"NOT (({fixed}) OR ({negotiated}))", "Line origin, buyer cap or quantity violation")
    result.append(trigger("orders_orderline", "INSERT", body))
    identity = same("id submission_id seller_id")
    body = "DECLARE header_id CHAR(32); " + reject(f"OLD.state<>'pending' OR NOT ({identity}) OR NEW.version<>OLD.version+1")
    body += f"""IF NEW.state='accepted' THEN
        SELECT id INTO header_id FROM orders_sellerorder WHERE outcome_id=NEW.id FOR UPDATE;
        {reject(f'NOT EXISTS(SELECT 1 FROM orders_sellerorder o WHERE o.outcome_id=NEW.id AND ({complete()}))', 'Incomplete accepted order or invoice')}
        END IF;"""
    result += [trigger("orders_checkoutoutcome", "DELETE", reject()), trigger("orders_checkoutoutcome", "UPDATE", body)]
    result += request_statements()
    return result


def request_statements():
    result = []
    origin = f"""NEW.state<>'submitted' OR NEW.version<>1 OR NEW.revision<>1 OR NOT EXISTS(
        SELECT 1 FROM orders_negotiationoutcome o JOIN orders_negotiationsubmission s ON s.id=o.submission_id
        WHERE o.id=NEW.outcome_id AND o.state='pending' AND s.buyer_id=NEW.buyer_id
        AND o.seller_id=NEW.seller_id AND {j('s.payload','currency')}=NEW.currency)"""
    result.append(trigger("orders_negotiation", "INSERT", reject(origin)))
    immutable = same("id outcome_id buyer_id seller_id currency created_at")
    transition = """(OLD.state IN ('submitted','correction_requested') AND NEW.state IN ('withdrawn','rejected') AND NEW.revision=OLD.revision)
        OR (OLD.state='submitted' AND NEW.state IN ('accepted','correction_requested') AND NEW.revision=OLD.revision)
        OR (OLD.state='correction_requested' AND NEW.state='submitted' AND NEW.revision=OLD.revision+1)"""
    event_match = """EXISTS(SELECT 1 FROM orders_negotiationevent e WHERE e.request_id=NEW.id AND e.version=NEW.version
        AND e.revision=NEW.revision AND e.action=CASE WHEN NEW.state='submitted' THEN 'resubmitted' ELSE NEW.state END)"""
    result += [trigger("orders_negotiation", "DELETE", reject()), trigger("orders_negotiation", "UPDATE", reject(f"NOT ({immutable}) OR NEW.version<>OLD.version+1 OR NOT ({transition}) OR NOT ({event_match})"))]
    result.append(trigger("orders_negotiationrevision", "INSERT", revision_body()))
    identity = same("id submission_id seller_id")
    body = reject(f"OLD.state<>'pending' OR NOT ({identity}) OR NEW.version<>OLD.version+1")
    body += reject("""NEW.state='submitted' AND NOT EXISTS(SELECT 1 FROM orders_negotiation r
        JOIN orders_negotiationrevision v ON v.request_id=r.id AND v.number=r.revision
        JOIN orders_negotiationevent e ON e.request_id=r.id AND e.version=r.version AND e.revision=r.revision AND e.action='submitted'
        WHERE r.outcome_id=NEW.id)""", "Incomplete initial request publication")
    result += [trigger("orders_negotiationoutcome", "DELETE", reject()), trigger("orders_negotiationoutcome", "UPDATE", body)]
    body = """DECLARE request_id CHAR(32); DECLARE current_state VARCHAR(20); DECLARE current_version BIGINT;
        DECLARE current_revision BIGINT; DECLARE buyer_id CHAR(32); DECLARE seller_id CHAR(32);
        SELECT r.id,r.state,r.version,r.revision,r.buyer_id,r.seller_id INTO request_id,current_state,current_version,current_revision,buyer_id,seller_id
        FROM orders_negotiation r WHERE r.id=NEW.request_id FOR UPDATE;"""
    transitions = """(NEW.version=1 AND current_version=1 AND NEW.revision=1 AND current_revision=1 AND NEW.action='submitted'
            AND current_state='submitted' AND NOT EXISTS(SELECT 1 FROM orders_negotiationevent existing_event WHERE existing_event.request_id=NEW.request_id))
        OR (NEW.version=current_version+1 AND (
            (current_state IN ('submitted','correction_requested') AND NEW.action IN ('withdrawn','rejected') AND NEW.revision=current_revision)
            OR (current_state='submitted' AND NEW.action IN ('accepted','correction_requested') AND NEW.revision=current_revision)
            OR (current_state='correction_requested' AND NEW.action='resubmitted' AND NEW.revision=current_revision+1)))"""
    body += reject(f"NOT ({transitions}) OR NOT EXISTS(SELECT 1 FROM orders_negotiationrevision proposed_revision WHERE proposed_revision.request_id=NEW.request_id AND proposed_revision.number=NEW.revision)", "Invalid or incomplete request event")
    body += reject("""(NEW.action IN ('submitted','resubmitted','withdrawn') AND NEW.actor_id<>buyer_id)
        OR (NEW.action IN ('accepted','rejected','correction_requested') AND NOT EXISTS(
            SELECT 1 FROM accounts_account a WHERE a.id=NEW.actor_id AND a.context='seller'
            AND (EXISTS(SELECT 1 FROM organizations_businessprofile p WHERE p.id=seller_id AND p.kind='individual' AND p.account_id=a.id)
                OR EXISTS(SELECT 1 FROM organizations_membership m WHERE m.company_id=seller_id AND m.account_id=a.id
                    AND m.active AND (m.is_owner OR JSON_CONTAINS(m.bundles,'"orders_negotiation"'))))))""", "Wrong request event authority")
    complete_negotiation = f"""EXISTS(SELECT 1 FROM orders_sellerorder o
        JOIN orders_negotiationrevision rev ON rev.request_id=NEW.request_id AND rev.number=NEW.revision
        WHERE o.negotiation_id=NEW.request_id AND ({complete()})
        AND (SELECT COUNT(*) FROM orders_orderline WHERE order_id=o.id)=JSON_LENGTH(JSON_EXTRACT(rev.body,'$.lines'))
        AND JSON_EQUALS(JSON_EXTRACT(o.snapshot,'$.proposal'),rev.body)
        AND ({j('o.snapshot','finalizer.account')} <=> CONCAT(SUBSTRING(NEW.actor_id,1,8),'-',SUBSTRING(NEW.actor_id,9,4),'-',SUBSTRING(NEW.actor_id,13,4),'-',SUBSTRING(NEW.actor_id,17,4),'-',SUBSTRING(NEW.actor_id,21,12))))"""
    body += reject(f"NEW.action='accepted' AND NOT ({complete_negotiation})", "Incomplete negotiated agreement")
    result.append(trigger("orders_negotiationevent", "INSERT", body))
    body = """IF NEW.version>1 THEN UPDATE orders_negotiation
        SET state=CASE WHEN NEW.action='resubmitted' THEN 'submitted' ELSE NEW.action END,
            version=NEW.version,revision=NEW.revision WHERE id=NEW.request_id; END IF;"""
    result.append(trigger("orders_negotiationevent", "INSERT", body, suffix="advance", timing="AFTER"))
    return result


def revision_body():
    body = """DECLARE request_id CHAR(32); DECLARE buyer_id CHAR(32); DECLARE seller_id CHAR(32); DECLARE currency_code VARCHAR(3);
        DECLARE current_revision BIGINT; DECLARE current_state VARCHAR(20); DECLARE outcome_id CHAR(32);
        SELECT r.id,r.buyer_id,r.seller_id,r.currency,r.revision,r.state,r.outcome_id
        INTO request_id,buyer_id,seller_id,currency_code,current_revision,current_state,outcome_id
        FROM orders_negotiation r WHERE r.id=NEW.request_id FOR UPDATE;"""
    body += reject(f"""NEW.actor_id<>buyer_id OR NEW.number<>current_revision+(CASE WHEN current_state='correction_requested' THEN 1 ELSE 0 END)
        OR (NEW.number>1 AND current_state<>'correction_requested')
        OR NOT ({j('NEW.body','explanation')} <=> 'seller-finalizes-v1')
        OR NOT (JSON_TYPE(JSON_EXTRACT(NEW.body,'$.lines')) <=> 'ARRAY')
        OR JSON_LENGTH(JSON_EXTRACT(NEW.body,'$.lines')) NOT BETWEEN 1 AND 100
        OR NOT ({j('NEW.body','choice.seller')} <=> CONCAT(SUBSTRING(seller_id,1,8),'-',SUBSTRING(seller_id,9,4),'-',SUBSTRING(seller_id,13,4),'-',SUBSTRING(seller_id,17,4),'-',SUBSTRING(seller_id,21,12)))""", "Invalid buyer revision")
    table = lines('NEW.body')
    body += reject(f"(SELECT COUNT(*) FROM {table} l)<>(SELECT COUNT(DISTINCT CONCAT(l.variant,':',l.tier)) FROM {table} l)", "Duplicate or missing proposal selection")
    # Validate representations BEFORE any numeric cast. SQL JSON conversion
    # warnings must never silently truncate a malformed buyer cap.
    bad = """l.variant IS NULL OR l.variant NOT REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR l.tier IS NULL OR l.tier NOT IN ('retail','wholesale') OR l.price IS NULL OR l.cap IS NULL
        OR l.quantity IS NULL OR l.maximum IS NULL
        OR l.price NOT REGEXP '^[0-9]{1,9}\\\\.[0-9]{2}$' OR l.cap NOT REGEXP '^[0-9]{1,9}\\\\.[0-9]{2}$'
        OR l.quantity NOT REGEXP '^[0-9]{1,9}(\\\\.[0-9]{1,3})?$' OR l.maximum NOT REGEXP '^[0-9]{1,9}(\\\\.[0-9]{1,3})?$'"""
    body += reject(f"EXISTS(SELECT 1 FROM {table} l WHERE {bad})", "Invalid numeric proposal representation")
    body += reject(f"""EXISTS(SELECT 1 FROM {table} l WHERE
        CAST(l.price AS DECIMAL(11,2))<=0 OR CAST(l.price AS DECIMAL(11,2))>CAST(l.cap AS DECIMAL(11,2))
        OR CAST(l.quantity AS DECIMAL(12,3))<=0 OR CAST(l.quantity AS DECIMAL(12,3))>CAST(l.maximum AS DECIMAL(12,3))
        OR NOT EXISTS(SELECT 1 FROM catalogue_variant v JOIN catalogue_product p ON p.id=v.product_id
            WHERE CONCAT(SUBSTRING(v.id,1,8),'-',SUBSTRING(v.id,9,4),'-',SUBSTRING(v.id,13,4),'-',SUBSTRING(v.id,17,4),'-',SUBSTRING(v.id,21,12))=l.variant AND p.seller_id=seller_id AND p.currency=currency_code
            AND p.pricing_mode='negotiable' AND MOD(CAST(l.quantity AS DECIMAL(12,3)),v.quantity_increment)=0
            AND MOD(CAST(l.maximum AS DECIMAL(12,3)),v.quantity_increment)=0))""", "Invalid buyer caps or variant scope")
    proposal = "JSON_REMOVE(NEW.body,'$.context','$.goods_total')"
    body += reject(f"""NEW.number=1 AND NOT EXISTS(SELECT 1 FROM orders_negotiationoutcome o
        JOIN orders_negotiationsubmission sub ON sub.id=o.submission_id
        JOIN JSON_TABLE(sub.payload,'$.proposals[*]' COLUMNS(proposal JSON PATH '$')) p
        WHERE o.id=outcome_id AND ({j('p.proposal','choice.seller')} <=> CONCAT(SUBSTRING(seller_id,1,8),'-',SUBSTRING(seller_id,9,4),'-',SUBSTRING(seller_id,13,4),'-',SUBSTRING(seller_id,17,4),'-',SUBSTRING(seller_id,21,12)))
            AND JSON_EQUALS({proposal},p.proposal))""", "Initial proposal must retain submission")
    body += reject(f"""NEW.number>1 AND (NOT EXISTS(SELECT 1 FROM orders_negotiationrevision prior_revision WHERE prior_revision.request_id=NEW.request_id AND prior_revision.number=NEW.number-1)
        OR EXISTS(SELECT 1 FROM orders_negotiationrevision previous JOIN {lines('previous.body')} old_line
            WHERE previous.request_id=NEW.request_id AND previous.number=NEW.number-1
            AND NOT EXISTS(SELECT 1 FROM {table} new_line WHERE new_line.variant=old_line.variant AND new_line.tier=old_line.tier))
        OR (SELECT JSON_LENGTH(JSON_EXTRACT(previous.body,'$.lines')) FROM orders_negotiationrevision previous
            WHERE previous.request_id=NEW.request_id AND previous.number=NEW.number-1)<>JSON_LENGTH(JSON_EXTRACT(NEW.body,'$.lines')))""", "Request selection is immutable")
    return body
