"""Immediate native validation at the authoritative acceptance/event boundary.

Private construction rows may exist, but acceptance cannot. Parent locks serialize
line insertion with publication; no writable connection flag disables guards.
"""
from apps.runtime.mariadb.ddl import reject, same, trigger, retained


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


def _aftercare_permission(user, code):
    return f"""EXISTS(SELECT 1 FROM accounts_user u WHERE u.id={user} AND u.is_active AND u.email_verified AND u.is_staff AND (u.is_superuser OR EXISTS(SELECT 1 FROM accounts_user_groups ug JOIN auth_group_permissions gp ON gp.group_id=ug.group_id JOIN auth_permission p ON p.id=gp.permission_id JOIN django_content_type ct ON ct.id=p.content_type_id WHERE ug.user_id=u.id AND ct.app_label='orders' AND p.codename={code})))"""


def _seller_orders(order, account):
    return f"""EXISTS(SELECT 1 FROM orders_sellerorder o JOIN organizations_businessprofile b ON b.id=o.seller_id JOIN accounts_account a ON a.id={account} JOIN accounts_user u ON u.id=a.user_id WHERE o.id={order} AND a.context='seller' AND a.status='active' AND u.is_active AND u.email_verified AND (b.kind='individual' AND b.account_id=a.id OR b.kind='company' AND EXISTS(SELECT 1 FROM organizations_membership m WHERE m.company_id=b.id AND m.account_id=a.id AND m.active AND (m.is_owner OR JSON_CONTAINS(m.bundles,'"orders_negotiation"')))))"""


def _participant():
    return "EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.account_id AND a.user_id=NEW.actor_id AND a.context=NEW.context AND a.status='active')"


def _buyer_order(order, account, actor):
    return f"EXISTS(SELECT 1 FROM orders_sellerorder o JOIN accounts_account a ON a.id=o.buyer_id JOIN accounts_user u ON u.id=a.user_id WHERE o.id={order} AND a.id={account} AND u.id={actor} AND a.status='active' AND u.is_active AND u.email_verified)"


def effective_line_value(line, field, *, before=None):
    boundary = f" AND change_event.version<{before}" if before else ""
    return f"COALESCE((SELECT change_line.proposed_{field} FROM orders_amendmentline change_line JOIN orders_amendment change_parent ON change_parent.id=change_line.amendment_id JOIN orders_amendmentdecision change_decision ON change_decision.amendment_id=change_parent.id JOIN orders_aftercareevent change_event ON change_event.id=change_decision.event_id WHERE change_line.line_id={line}.id AND change_parent.state='approved' AND change_decision.action='approved'{boundary} ORDER BY change_event.version DESC LIMIT 1),{line}.{field})"


def effective_order_total(order):
    return f"IF(EXISTS(SELECT 1 FROM orders_cancellationrequest cancelled_order JOIN orders_cancellationdecision cancelled_decision ON cancelled_decision.request_id=cancelled_order.id WHERE cancelled_order.order_id={order} AND cancelled_decision.action='approved'),0,COALESCE((SELECT approved_order.after_total FROM orders_amendment approved_order JOIN orders_amendmentdecision approved_decision ON approved_decision.amendment_id=approved_order.id JOIN orders_aftercareevent approved_event ON approved_event.id=approved_decision.event_id WHERE approved_order.order_id={order} AND approved_order.state='approved' AND approved_decision.action='approved' ORDER BY approved_event.version DESC LIMIT 1),(SELECT original_order.goods_total FROM orders_sellerorder original_order WHERE original_order.id={order})))"


def aftercare_independent(order, user):
    from apps.payments.mariadb_guards import independent

    return f"({independent(order, user)}) AND NOT EXISTS(SELECT 1 FROM orders_amendment proposal JOIN accounts_account proposer ON proposer.id=proposal.actor_id WHERE proposal.order_id={order} AND proposer.user_id={user})"


def adjustment_snapshot_guard(field, *, before=False):
    boundary = "(SELECT version FROM orders_aftercareevent WHERE id=NEW.event_id)" if before else None
    quantity = effective_line_value("l", "quantity", before=boundary)
    price = effective_line_value("l", "unit_price", before=boundary)
    rows = f"JSON_TABLE(NEW.{field},'$[*]' COLUMNS(line CHAR(36) PATH '$.line',variant CHAR(36) PATH '$.variant',tier VARCHAR(9) PATH '$.tier',quantity VARCHAR(32) PATH '$.quantity',unit_price VARCHAR(32) PATH '$.unit_price',goods_amount VARCHAR(32) PATH '$.goods_amount'))"
    total = "NEW.before_total" if before else "NEW.after_total"
    return reject(f"""JSON_TYPE(NEW.{field})<>'ARRAY' OR JSON_LENGTH(NEW.{field})<>(SELECT COUNT(*) FROM orders_orderline l WHERE l.order_id=NEW.order_id)
        OR (SELECT COUNT(DISTINCT snapshot.line) FROM {rows} snapshot)<>JSON_LENGTH(NEW.{field})
        OR EXISTS(SELECT 1 FROM {rows} snapshot LEFT JOIN orders_orderline l ON l.id=REPLACE(snapshot.line,'-','') AND l.order_id=NEW.order_id WHERE l.id IS NULL OR NOT (REPLACE(snapshot.variant,'-','') <=> l.variant_id) OR NOT (snapshot.tier <=> l.tier) OR NOT (snapshot.quantity REGEXP BINARY '^[0-9]+[.][0-9]{{3}}$') OR NOT (snapshot.unit_price REGEXP BINARY '^[0-9]+[.][0-9]{{2}}$') OR NOT (snapshot.goods_amount REGEXP BINARY '^[0-9]+[.][0-9]{{2}}$') OR NOT (CAST(snapshot.quantity AS DECIMAL(12,3)) <=> {quantity}) OR NOT (CAST(snapshot.unit_price AS DECIMAL(11,2)) <=> {price}) OR NOT (CAST(snapshot.goods_amount AS DECIMAL(24,2)) <=> ROUND({quantity}*{price},2)))
        OR {total}<>(SELECT SUM(ROUND({quantity}*{price},2)) FROM orders_orderline l WHERE l.order_id=NEW.order_id)""")


def decision_guard(kind):
    parent = "cancellationrequest" if kind == "cancellation" else "amendment"
    key = "request_id" if kind == "cancellation" else "amendment_id"
    permission = "decide_cancellation" if kind == "cancellation" else "decide_amendment"
    body = f"DECLARE target_order CHAR(32); DECLARE target_state VARCHAR(9); DECLARE reviewer CHAR(32); SELECT order_id,state,assigned_to_id INTO target_order,target_state,reviewer FROM orders_{parent} WHERE id=NEW.{key} FOR UPDATE; "
    identity = f"((NEW.context='owner' AND NEW.account_id IS NULL AND EXISTS(SELECT 1 FROM accounts_user u WHERE u.id=NEW.actor_id AND u.is_superuser)) OR (NEW.context='staff' AND ({_participant()})))"
    independent = aftercare_independent("target_order", "NEW.actor_id")
    body += reject(f"""target_order IS NULL OR target_state<>'pending' OR reviewer IS NULL OR reviewer<>NEW.actor_id
        OR NEW.action NOT IN ('approved','rejected') OR CHAR_LENGTH(TRIM(NEW.reason)) NOT BETWEEN 3 AND 1000
        OR NOT ({identity}) OR NOT ({_aftercare_permission('NEW.actor_id', repr(permission))})
        OR NOT ({_aftercare_permission('NEW.actor_id', repr('read_aftercare'))}) OR NOT ({independent})
        OR EXISTS(SELECT 1 FROM fulfilment_shipment shipped WHERE shipped.order_id=target_order)
        OR EXISTS(SELECT 1 FROM fulfilment_completion finished WHERE finished.order_id=target_order)
        OR EXISTS(SELECT 1 FROM orders_cancellationrequest cancelled JOIN orders_cancellationdecision decided ON decided.request_id=cancelled.id WHERE cancelled.order_id=target_order AND decided.action='approved')
        OR NOT EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id WHERE e.id=NEW.event_id AND e.order_id=target_order AND e.version=s.version AND e.action=CONCAT('{kind}_',NEW.action) AND e.actor_id=NEW.actor_id AND (e.account_id <=> NEW.account_id) AND e.context=NEW.context)""")
    if kind == "cancellation":
        body += reject(f"""EXISTS(SELECT 1 FROM orders_cancellationrequest request WHERE request.id=NEW.request_id AND (request.requester_user_id=NEW.actor_id OR (request.requester_context='seller' AND NOT ({_seller_orders('target_order', 'request.requester_account_id')}))))""")
    else:
        quantity = effective_line_value("l", "quantity")
        price = effective_line_value("l", "unit_price")
        body += reject(f"""NEW.action='approved' AND (NOT EXISTS(SELECT 1 FROM orders_amendmentline proposal WHERE proposal.amendment_id=NEW.amendment_id)
            OR EXISTS(SELECT 1 FROM orders_amendmentline proposal JOIN orders_orderline l ON l.id=proposal.line_id JOIN catalogue_variant v ON v.id=l.variant_id WHERE proposal.amendment_id=NEW.amendment_id AND (l.order_id<>target_order OR proposal.proposed_quantity<=0 OR proposal.proposed_quantity>={quantity} OR proposal.proposed_unit_price<=0 OR proposal.proposed_unit_price>{price} OR MOD(proposal.proposed_quantity,v.quantity_increment)<>0 OR (l.tier='wholesale' AND proposal.proposed_quantity<v.minimum_wholesale)))
            OR (SELECT proposal.after_total FROM orders_amendment proposal WHERE proposal.id=NEW.amendment_id)<>(SELECT SUM(ROUND(COALESCE(proposal.proposed_quantity,{quantity})*COALESCE(proposal.proposed_unit_price,{price}),2)) FROM orders_orderline l LEFT JOIN orders_amendmentline proposal ON proposal.line_id=l.id AND proposal.amendment_id=NEW.amendment_id WHERE l.order_id=target_order))""")
    return trigger(f"orders_{kind}decision", "INSERT", body)


def aftercare_statements(version=4):
    from apps.payments.mariadb_guards import accepted

    result = []
    for table in ("aftercareevent", "aftercarecommand", "cancellationdecision", "amendmentdecision", "invoiceadjustment"):
        result += retained("orders_" + table)
    result.append(trigger("orders_aftercare", "INSERT", reject(f"NEW.version<>0 OR NOT ({accepted('NEW.order_id')})")))
    result.append(trigger("orders_aftercare", "DELETE", reject()))
    result.append(
        trigger(
            "orders_aftercare",
            "UPDATE",
            reject(
                f"NOT ({same('order_id created_at')}) OR (NEW.version<>OLD.version AND (NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM orders_aftercareevent e WHERE e.order_id=NEW.order_id AND e.version=NEW.version)))"
            ),
        )
    )
    owner = "EXISTS(SELECT 1 FROM accounts_user u WHERE u.id=NEW.actor_id AND u.is_superuser AND u.is_staff AND u.is_active AND u.email_verified)"
    staff = _aftercare_permission("NEW.actor_id", "'read_aftercare'")
    buyer_actions = "'cancellation_requested','cancellation_withdrawn'"
    seller_actions = "'cancellation_requested','cancellation_withdrawn','amendment_proposed','amendment_withdrawn'"
    staff_actions = "'cancellation_assigned','cancellation_opened','cancellation_approved','cancellation_rejected','amendment_assigned','amendment_approved','amendment_rejected'"
    if version >= 5:
        # Dispute and review queues are scoped by their own read codenames; the
        # action-specific decide permission is enforced by the decision guards.
        staff = f"({staff} OR {_aftercare_permission('NEW.actor_id', repr('read_dispute'))} OR {_aftercare_permission('NEW.actor_id', repr('read_review'))})"
        buyer_actions += ",'dispute_opened','dispute_withdrawn','review_submitted','review_withdrawn'"
        seller_actions += ",'dispute_response'"
        staff_actions += ",'dispute_assigned','dispute_decided','review_decided'"
    body = "DECLARE current_version BIGINT; SELECT version INTO current_version FROM orders_aftercare WHERE order_id=NEW.order_id FOR UPDATE; "
    body += reject(f"current_version IS NULL OR NEW.version<>current_version+1 OR NOT ({accepted('NEW.order_id')})")
    body += reject(
        f"""NOT ((NEW.context='buyer' AND ({_participant()}) AND ({_buyer_order('NEW.order_id', 'NEW.account_id', 'NEW.actor_id')}) AND NEW.action IN ({buyer_actions}))
        OR (NEW.context='seller' AND ({_participant()}) AND ({_seller_orders('NEW.order_id', 'NEW.account_id')}) AND NEW.action IN ({seller_actions}))
        OR (NEW.context IN ('owner','staff') AND (NEW.context='owner' AND ({owner}) OR NEW.context='staff' AND ({staff})) AND NEW.action IN ({staff_actions})))"""
    )
    result.append(trigger("orders_aftercareevent", "INSERT", body))
    result.append(
        trigger(
            "orders_aftercarecommand",
            "INSERT",
            reject(
                "NEW.context NOT IN ('buyer','seller','staff','owner') OR CHAR_LENGTH(NEW.digest)<>64 OR NOT JSON_VALID(NEW.result) OR NOT EXISTS(SELECT 1 FROM accounts_user u WHERE u.id=NEW.actor_id AND u.is_active AND u.email_verified) OR (NEW.context<>'owner' AND NOT EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.account_id AND a.user_id=NEW.actor_id AND a.context=NEW.context AND a.status='active')) OR (NEW.context='owner' AND NOT EXISTS(SELECT 1 FROM accounts_user u WHERE u.id=NEW.actor_id AND u.is_superuser AND u.is_staff))"
            ),
            suffix="identity_guard",
        )
    )
    disputes_map = ""
    if version >= 5:
        disputes_map = (
            " WHEN 'dispute_open' THEN 'dispute_opened'"
            " WHEN 'dispute_withdraw' THEN 'dispute_withdrawn'"
            " WHEN 'dispute_respond' THEN 'dispute_response'"
            " WHEN 'dispute_assign' THEN 'dispute_assigned'"
            " WHEN 'dispute_dismiss' THEN 'dispute_decided'"
            " WHEN 'dispute_resolve' THEN 'dispute_decided'"
            " WHEN 'dispute_refund' THEN 'dispute_decided'"
            " WHEN 'review_submit' THEN 'review_submitted'"
            " WHEN 'review_withdraw' THEN 'review_withdrawn'"
            " WHEN 'review_moderate_approve' THEN 'review_decided'"
            " WHEN 'review_moderate_reject' THEN 'review_decided'"
            " WHEN 'review_moderate_withdraw' THEN 'review_decided'"
        )
    command_action = "CASE NEW.action WHEN 'request' THEN 'cancellation_requested' WHEN 'withdraw' THEN 'cancellation_withdrawn' WHEN 'propose' THEN 'amendment_proposed' WHEN 'amendment_withdraw' THEN 'amendment_withdrawn' WHEN 'cancellation_assign' THEN 'cancellation_assigned' WHEN 'cancellation_open' THEN 'cancellation_opened' WHEN 'cancellation_approve' THEN 'cancellation_approved' WHEN 'cancellation_reject' THEN 'cancellation_rejected' WHEN 'amendment_assign' THEN 'amendment_assigned' WHEN 'amendment_approve' THEN 'amendment_approved' WHEN 'amendment_reject' THEN 'amendment_rejected'" + disputes_map + " ELSE NEW.action END"
    result.append(
        trigger(
            "orders_aftercarecommand",
            "INSERT",
            reject(
                f"(NEW.action<>'absence_fence' AND NOT EXISTS(SELECT 1 FROM orders_aftercareevent e WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.actor_id=NEW.actor_id AND (e.account_id <=> NEW.account_id) AND e.context=NEW.context AND e.action={command_action})) OR (NEW.action='absence_fence' AND (NEW.event_id IS NOT NULL OR NEW.digest<>REPEAT('0',64) OR NOT (JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.settled'))<=>'true')))"
            ),
            suffix="source_guard",
        )
    )
    result.append(
        trigger(
            "orders_aftercarecommand",
            "INSERT",
            reject(
                "NEW.digest NOT REGEXP BINARY '^[0-9a-f]{64}$' OR (NEW.action<>'absence_fence' AND (NOT (JSON_TYPE(JSON_EXTRACT(NEW.result,'$.version')) <=> 'INTEGER') OR NOT EXISTS(SELECT 1 FROM orders_aftercareevent e WHERE e.id=NEW.event_id AND e.version=CAST(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.version')) AS UNSIGNED))))"
            ),
            suffix="result_guard",
        )
    )
    cancelled = "EXISTS(SELECT 1 FROM orders_cancellationrequest p JOIN orders_cancellationdecision d ON d.request_id=p.id WHERE p.order_id=NEW.order_id AND d.action='approved')"
    body = "DECLARE order_seller CHAR(32); DECLARE order_buyer CHAR(32); SELECT seller_id,buyer_id INTO order_seller,order_buyer FROM orders_sellerorder WHERE id=NEW.order_id FOR UPDATE; "
    requester = f"""((NEW.requester_account_id IS NOT NULL AND NEW.requester_user_id IS NULL AND NEW.requester_context IN ('buyer','seller') AND ((NEW.requester_context='buyer' AND NEW.requester_account_id=order_buyer) OR (NEW.requester_context='seller' AND {_seller_orders('NEW.order_id', 'NEW.requester_account_id')})))
        OR (NEW.requester_account_id IS NULL AND NEW.requester_user_id IS NOT NULL AND NEW.requester_context='staff' AND ({_aftercare_permission('NEW.requester_user_id', chr(39) + 'assign_aftercare' + chr(39))})))"""
    body += reject(
        f"""order_seller IS NULL OR NEW.version<>1 OR NEW.assigned_to_id IS NOT NULL OR NEW.state<>'pending' OR CHAR_LENGTH(TRIM(NEW.reason))<3 OR NOT ({requester}) OR EXISTS(SELECT 1 FROM orders_cancellationrequest p WHERE p.order_id=NEW.order_id AND p.state='pending') OR EXISTS(SELECT 1 FROM orders_sellerorder o JOIN fulfilment_shipment s ON s.order_id=o.id WHERE o.id=NEW.order_id) OR EXISTS(SELECT 1 FROM fulfilment_completion c WHERE c.order_id=NEW.order_id) OR ({cancelled}) OR NOT EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.action=IF(NEW.requester_context='staff','cancellation_opened','cancellation_requested') AND e.version=s.version) OR (NEW.payment_case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments_reviewcase k WHERE k.id=NEW.payment_case_id AND k.order_id=NEW.order_id AND k.kind='shortage'))"""
    )
    from apps.payments.mariadb_guards import confirmed, permission

    body += reject(f"""NOT EXISTS(SELECT 1 FROM orders_aftercareevent e WHERE e.id=NEW.event_id AND ((NEW.requester_context IN ('buyer','seller') AND e.account_id=NEW.requester_account_id AND e.context=NEW.requester_context AND NEW.payment_case_id IS NULL) OR (NEW.requester_context='staff' AND e.actor_id=NEW.requester_user_id AND e.context IN ('owner','staff'))))
        OR (NEW.requester_context='staff' AND (NEW.payment_case_id IS NULL OR {confirmed('NEW.order_id')}<=0 OR NOT ({permission('NEW.requester_user_id', repr('read_payments'))}) OR NOT EXISTS(SELECT 1 FROM payments_reviewcase k JOIN payments_allocationintent i ON i.order_id=k.order_id JOIN accounts_user u ON u.id=NEW.requester_user_id WHERE k.id=NEW.payment_case_id AND k.order_id=NEW.order_id AND k.kind='shortage' AND k.state IN ('open','referred') AND (u.is_superuser OR k.assigned_to_id=u.id) AND i.state IN ('shortage','review_required') AND i.allocation_id IS NULL)))""")
    result.append(trigger("orders_cancellationrequest", "INSERT", body))
    identity = "id order_id requester_account_id requester_user_id requester_context payment_case_id reason event_id created_at"
    witnessed = f"""EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id
        WHERE e.order_id=NEW.order_id AND e.version=s.version
        AND ((e.action='cancellation_assigned' AND NEW.state=OLD.state AND NOT (NEW.assigned_to_id <=> OLD.assigned_to_id)
            AND ({_aftercare_permission('e.actor_id', repr('assign_aftercare'))}) AND (NEW.assigned_to_id IS NULL OR (({_aftercare_permission('NEW.assigned_to_id', repr('decide_cancellation'))}) AND ({_aftercare_permission('NEW.assigned_to_id', repr('read_aftercare'))}) AND ({aftercare_independent('NEW.order_id', 'NEW.assigned_to_id')}) AND NOT (NEW.assigned_to_id <=> OLD.requester_user_id))))
        OR (e.action=CONCAT('cancellation_',NEW.state) AND OLD.state='pending' AND NEW.state IN ('withdrawn','approved','rejected') AND (NEW.assigned_to_id <=> OLD.assigned_to_id)
            AND ((NEW.state='withdrawn' AND e.context=OLD.requester_context AND e.account_id=OLD.requester_account_id)
                OR EXISTS(SELECT 1 FROM orders_cancellationdecision d WHERE d.request_id=NEW.id AND d.event_id=e.id AND d.action=NEW.state)))))"""
    witness = f"""(NEW.version=OLD.version AND NEW.state=OLD.state AND (NEW.assigned_to_id <=> OLD.assigned_to_id) AND (NEW.blocker_id <=> OLD.blocker_id))
        OR (NEW.version=OLD.version AND NEW.state=OLD.state AND (NEW.assigned_to_id <=> OLD.assigned_to_id) AND OLD.blocker_id IS NULL AND NEW.blocker_id IS NOT NULL AND EXISTS(SELECT 1 FROM fulfilment_blocker b WHERE b.id=NEW.blocker_id AND b.order_id=NEW.order_id))
        OR (NEW.version=OLD.version+1 AND (NEW.blocker_id <=> OLD.blocker_id) AND OLD.state='pending' AND ({witnessed}))"""
    result += [
        trigger("orders_cancellationrequest", "DELETE", reject()),
        trigger("orders_cancellationrequest", "UPDATE", reject(f"NOT ({same(identity)}) OR NOT ({witness})")),
    ]
    body = "DECLARE order_seller CHAR(32); SELECT seller_id INTO order_seller FROM orders_sellerorder WHERE id=NEW.order_id FOR UPDATE; "
    body += reject(
        f"""order_seller IS NULL OR NEW.version<>1 OR NEW.assigned_to_id IS NOT NULL OR NEW.state<>'pending' OR NEW.after_total<=0 OR CHAR_LENGTH(TRIM(NEW.reason))<3 OR NOT ({_seller_orders('NEW.order_id', 'NEW.actor_id')}) OR EXISTS(SELECT 1 FROM orders_amendment p WHERE p.order_id=NEW.order_id AND p.state='pending') OR EXISTS(SELECT 1 FROM orders_sellerorder o JOIN fulfilment_shipment s ON s.order_id=o.id WHERE o.id=NEW.order_id) OR EXISTS(SELECT 1 FROM fulfilment_completion c WHERE c.order_id=NEW.order_id) OR ({cancelled}) OR NOT EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.action='amendment_proposed' AND e.account_id=NEW.actor_id AND e.version=s.version)"""
    )
    result.append(trigger("orders_amendment", "INSERT", body))
    amendment_identity = "id order_id actor_id after_total reason event_id created_at"
    amendment_witnessed = f"""EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id
        WHERE e.order_id=NEW.order_id AND e.version=s.version AND OLD.state='pending'
        AND ((e.action='amendment_assigned' AND NEW.state=OLD.state AND NOT (NEW.assigned_to_id <=> OLD.assigned_to_id)
            AND ({_aftercare_permission('e.actor_id', repr('assign_aftercare'))}) AND (NEW.assigned_to_id IS NULL OR (({_aftercare_permission('NEW.assigned_to_id', repr('decide_amendment'))}) AND ({_aftercare_permission('NEW.assigned_to_id', repr('read_aftercare'))}) AND ({aftercare_independent('NEW.order_id', 'NEW.assigned_to_id')}))))
        OR (e.action=CONCAT('amendment_',NEW.state) AND NEW.state IN ('withdrawn','approved','rejected') AND (NEW.assigned_to_id <=> OLD.assigned_to_id)
            AND ((NEW.state='withdrawn' AND e.context='seller' AND e.account_id=OLD.actor_id)
                OR EXISTS(SELECT 1 FROM orders_amendmentdecision d WHERE d.amendment_id=NEW.id AND d.event_id=e.id AND d.action=NEW.state)))))"""
    amendment_witness = f"""(NEW.version=OLD.version AND NEW.state=OLD.state AND (NEW.assigned_to_id <=> OLD.assigned_to_id)) OR (NEW.version=OLD.version+1 AND ({amendment_witnessed}))"""
    result += [
        trigger("orders_amendment", "DELETE", reject()),
        trigger("orders_amendment", "UPDATE", reject(f"NOT ({same(amendment_identity)}) OR NOT ({amendment_witness})")),
    ]
    result += [trigger("orders_amendmentline", "DELETE", reject())]
    result.append(
        trigger(
            "orders_amendmentline",
            "UPDATE",
            reject(f"NOT ({same('id amendment_id line_id proposed_quantity proposed_unit_price')})"),
        )
    )
    body = "DECLARE order_id CHAR(32); DECLARE current_state VARCHAR(9); SELECT a.order_id,a.state INTO order_id,current_state FROM orders_amendment a WHERE a.id=NEW.amendment_id FOR UPDATE; "
    body += reject(
        f"""order_id IS NULL OR current_state<>'pending' OR EXISTS(SELECT 1 FROM orders_amendmentdecision d WHERE d.amendment_id=NEW.amendment_id) OR NOT EXISTS(SELECT 1 FROM orders_orderline l JOIN catalogue_variant v ON v.id=l.variant_id WHERE l.id=NEW.line_id AND l.order_id=order_id AND NEW.proposed_quantity>0 AND NEW.proposed_quantity<{effective_line_value('l', 'quantity')} AND NEW.proposed_unit_price>0 AND NEW.proposed_unit_price<={effective_line_value('l', 'unit_price')} AND MOD(NEW.proposed_quantity,v.quantity_increment)=0 AND (l.tier<>'wholesale' OR NEW.proposed_quantity>=v.minimum_wholesale)) OR EXISTS(SELECT 1 FROM orders_amendmentline x WHERE x.amendment_id=NEW.amendment_id AND x.line_id=NEW.line_id)"""
    )
    result.append(trigger("orders_amendmentline", "INSERT", body))
    body = "DECLARE invoice_order CHAR(32); DECLARE event_order CHAR(32); DECLARE event_action VARCHAR(32); SELECT i.order_id INTO invoice_order FROM orders_sellerorder o JOIN orders_invoice i ON i.order_id=o.id WHERE i.id=NEW.invoice_id; SELECT e.order_id,e.action INTO event_order,event_action FROM orders_aftercareevent e WHERE e.id=NEW.event_id; "
    body += reject(
        """invoice_order IS NULL OR invoice_order<>NEW.order_id OR event_order IS NULL OR event_order<>NEW.order_id OR CHAR_LENGTH(TRIM(NEW.reason))<3 OR (NEW.cancellation_id IS NOT NULL AND NEW.amendment_id IS NOT NULL) OR (NEW.cancellation_id IS NULL AND NEW.amendment_id IS NULL) OR (NEW.cancellation_id IS NOT NULL AND (NEW.amendment_id IS NOT NULL OR event_action<>'cancellation_approved' OR NOT EXISTS(SELECT 1 FROM orders_cancellationrequest p JOIN orders_cancellationdecision d ON d.request_id=p.id WHERE p.id=NEW.cancellation_id AND p.order_id=NEW.order_id AND d.action='approved') OR NEW.after_total<>0 OR JSON_LENGTH(NEW.after_lines)<>0)) OR (NEW.amendment_id IS NOT NULL AND (NEW.cancellation_id IS NOT NULL OR event_action<>'amendment_approved' OR NOT EXISTS(SELECT 1 FROM orders_amendment a JOIN orders_amendmentdecision d ON d.amendment_id=a.id WHERE a.id=NEW.amendment_id AND a.order_id=NEW.order_id AND d.action='approved') OR NEW.after_total<=0))"""
    )
    body += reject("""NOT EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id WHERE e.id=NEW.event_id AND e.version=s.version AND e.actor_id=NEW.actor_id)
        OR (NEW.cause='cancellation' AND NOT EXISTS(SELECT 1 FROM orders_cancellationdecision d WHERE d.request_id=NEW.cancellation_id AND d.event_id=NEW.event_id AND d.actor_id=NEW.actor_id AND d.action='approved'))
        OR (NEW.cause='amendment' AND NOT EXISTS(SELECT 1 FROM orders_amendmentdecision d JOIN orders_amendment a ON a.id=d.amendment_id WHERE d.amendment_id=NEW.amendment_id AND d.event_id=NEW.event_id AND d.actor_id=NEW.actor_id AND d.action='approved' AND a.after_total=NEW.after_total))""")
    body += adjustment_snapshot_guard("before_lines", before=True)
    body += "IF NEW.cause='amendment' THEN " + adjustment_snapshot_guard("after_lines") + "END IF; "
    result.append(trigger("orders_invoiceadjustment", "INSERT", body))
    result += [decision_guard("cancellation"), decision_guard("amendment")]
    return result


def _delivered(order):
    return f"""EXISTS(SELECT 1 FROM fulfilment_delivery d JOIN fulfilment_shipment s ON s.id=d.shipment_id
        JOIN fulfilment_publication p ON p.event_id=d.event_id WHERE s.order_id={order})"""


def _not_cancelled(order):
    return f"""NOT EXISTS(SELECT 1 FROM orders_cancellationrequest c JOIN orders_cancellationdecision d
        ON d.request_id=c.id WHERE c.order_id={order} AND d.action='approved')"""


def dispute_independent(order, user):
    """A dispute response or evidence author cannot decide that dispute."""
    return f"""({aftercare_independent(order, user)})
        AND NOT EXISTS(SELECT 1 FROM orders_disputeresponse r JOIN orders_disputerequest d ON d.id=r.dispute_id
            JOIN accounts_account a ON a.id=r.actor_id WHERE d.order_id={order} AND a.user_id={user})
        AND NOT EXISTS(SELECT 1 FROM payments_evidencebinding b JOIN orders_disputerequest d ON d.id=b.dispute_id
            JOIN payments_evidence e ON e.id=b.evidence_id JOIN accounts_account a ON a.id=e.creator_id
            WHERE d.order_id={order} AND a.user_id={user})"""


def dispute_event_unpublished(event, order):
    """Commands publish the aftercare head; notices must not precede construction."""
    return f"""NOT EXISTS(SELECT 1 FROM orders_aftercarecommand command
        WHERE command.order_id={order} AND command.action<>'absence_fence'
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(command.result,'$.version')) AS UNSIGNED)>={event}.version)
        AND NOT EXISTS(SELECT 1 FROM notifications_event notice WHERE notice.aftercare_event_id={event}.id)"""


def dispute_refund_pending(order, actor, account, context):
    """The unique pending request witnesses a due before its decision can exist."""
    return f"""EXISTS(SELECT 1 FROM orders_disputerequest request
        JOIN orders_aftercareevent decision_event ON decision_event.order_id=request.order_id
        JOIN orders_aftercare head ON head.order_id=decision_event.order_id
        JOIN orders_sellerorder original ON original.id=request.order_id
        JOIN accounts_account buyer ON buyer.id=request.requester_account_id
        JOIN accounts_user buyer_user ON buyer_user.id=buyer.user_id
        WHERE request.order_id={order} AND request.state='pending' AND request.assigned_to_id={actor}
        AND request.requester_account_id=original.buyer_id AND buyer.context='buyer' AND buyer.status='active'
        AND buyer_user.is_active AND buyer_user.email_verified
        AND decision_event.action='dispute_decided' AND decision_event.version=head.version
        AND decision_event.actor_id={actor} AND (decision_event.account_id <=> {account})
        AND decision_event.context={context}
        AND (({context}='owner' AND {account} IS NULL AND EXISTS(SELECT 1 FROM accounts_user root
            WHERE root.id={actor} AND root.is_superuser))
            OR ({context}='staff' AND EXISTS(SELECT 1 FROM accounts_account staff
                WHERE staff.id={account} AND staff.user_id={actor} AND staff.context='staff' AND staff.status='active')))
        AND ({_aftercare_permission(actor, repr('decide_dispute'))})
        AND ({_aftercare_permission(actor, repr('read_dispute'))})
        AND ({dispute_independent(order, actor)})
        AND ({_delivered(order)}) AND ({_not_cancelled(order)})
        AND ({dispute_event_unpublished('decision_event', order)})
        AND NOT EXISTS(SELECT 1 FROM orders_disputedecision decided
            WHERE decided.dispute_id=request.id OR decided.event_id=decision_event.id)
        AND NOT EXISTS(SELECT 1 FROM payments_refunddue prior
            WHERE prior.order_id={order} AND prior.cause='dispute'
            AND NOT EXISTS(SELECT 1 FROM payments_refundseal seal WHERE seal.due_id=prior.id)))"""


def dispute_refund_match(due, decision):
    """Exact current finance event, not equality between unrelated ledger UUIDs."""
    return f"""{due}.cause='dispute' AND {due}.amount={decision}.amount
        AND {due}.order_id=(SELECT order_id FROM orders_disputerequest WHERE id={decision}.dispute_id)
        AND {due}.currency=(SELECT currency FROM orders_sellerorder WHERE id={due}.order_id)
        AND EXISTS(SELECT 1 FROM payments_event payment_event JOIN payments_finance finance
            ON finance.order_id=payment_event.order_id WHERE payment_event.id={due}.event_id
            AND payment_event.order_id={due}.order_id AND payment_event.action='refund_due_created'
            AND payment_event.version=finance.version AND payment_event.actor_id={decision}.actor_id
            AND (payment_event.account_id <=> {decision}.account_id) AND payment_event.context={decision}.context)"""


def dispute_statements():
    """v5 delta: post-delivery disputes and moderated buyer reviews.

    Disputes attach to the existing aftercare head and reuse the existing
    fulfilment dispute hold; a decision closes that hold and may order a bounded
    refund due whose amount bound is enforced by the payments guards."""
    result = []
    for table in ("disputeresponse", "disputedecision", "reviewdecision"):
        result += retained("orders_" + table)

    buyer_account = (
        "EXISTS(SELECT 1 FROM accounts_account a JOIN accounts_user u ON u.id=a.user_id "
        "WHERE a.id=NEW.requester_account_id AND a.context='buyer' AND a.status='active' "
        "AND u.is_active AND u.email_verified)"
    )
    body = "DECLARE order_buyer CHAR(32); SELECT buyer_id INTO order_buyer FROM orders_sellerorder WHERE id=NEW.order_id FOR UPDATE; "
    body += reject(
        f"""order_buyer IS NULL OR NEW.version<>1 OR NEW.assigned_to_id IS NOT NULL OR NEW.blocker_id IS NOT NULL
        OR NEW.state<>'pending' OR CHAR_LENGTH(TRIM(NEW.reason)) NOT BETWEEN 3 AND 1000
        OR NEW.requester_account_id<>order_buyer OR NOT ({buyer_account})
        OR NOT ({_delivered('NEW.order_id')}) OR NOT ({_not_cancelled('NEW.order_id')})
        OR EXISTS(SELECT 1 FROM orders_disputerequest p WHERE p.order_id=NEW.order_id AND p.state='pending')
        OR NOT EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id
            WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.action='dispute_opened'
            AND e.context='buyer' AND e.account_id=NEW.requester_account_id AND e.version=s.version)"""
    )
    result.append(trigger("orders_disputerequest", "INSERT", body))

    identity = "id order_id requester_account_id reason event_id created_at"
    witnessed = f"""EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id
        WHERE e.order_id=NEW.order_id AND e.version=s.version
        AND ((e.action='dispute_assigned' AND NEW.state=OLD.state AND NOT (NEW.assigned_to_id <=> OLD.assigned_to_id)
            AND ({_aftercare_permission('e.actor_id', repr('assign_dispute'))})
            AND (NEW.assigned_to_id IS NULL OR (({_aftercare_permission('NEW.assigned_to_id', repr('decide_dispute'))})
                AND ({_aftercare_permission('NEW.assigned_to_id', repr('read_dispute'))})
                AND ({dispute_independent('NEW.order_id', 'NEW.assigned_to_id')}))))
        OR (e.action='dispute_response' AND NEW.state='pending' AND OLD.state='pending'
            AND (NEW.assigned_to_id <=> OLD.assigned_to_id) AND e.context='seller'
            AND ({_seller_orders('NEW.order_id', 'e.account_id')})
            AND EXISTS(SELECT 1 FROM orders_disputeresponse r WHERE r.dispute_id=NEW.id AND r.event_id=e.id))
        OR (e.action='dispute_withdrawn' AND OLD.state='pending' AND NEW.state='withdrawn'
            AND (NEW.assigned_to_id <=> OLD.assigned_to_id) AND e.context='buyer' AND e.account_id=OLD.requester_account_id)
        OR (e.action='dispute_decided' AND OLD.state='pending'
            AND NEW.state IN ('dismissed','resolved_non_monetary','refund_ordered')
            AND (NEW.assigned_to_id <=> OLD.assigned_to_id)
            AND EXISTS(SELECT 1 FROM orders_disputedecision d WHERE d.dispute_id=NEW.id AND d.event_id=e.id AND d.action=NEW.state))))"""
    witness = f"""(NEW.version=OLD.version AND NEW.state=OLD.state AND (NEW.assigned_to_id <=> OLD.assigned_to_id) AND (NEW.blocker_id <=> OLD.blocker_id))
        OR (NEW.version=OLD.version AND NEW.state=OLD.state AND (NEW.assigned_to_id <=> OLD.assigned_to_id)
            AND OLD.blocker_id IS NULL AND NEW.blocker_id IS NOT NULL
            AND OLD.state='pending' AND EXISTS(SELECT 1 FROM fulfilment_blocker b
                JOIN fulfilment_event hold_event ON hold_event.id=b.event_id
                JOIN fulfilment_state delivery_head ON delivery_head.order_id=b.order_id
                JOIN orders_aftercareevent opening ON opening.id=OLD.event_id
                JOIN orders_aftercare head ON head.order_id=opening.order_id
                WHERE b.id=NEW.blocker_id AND b.order_id=NEW.order_id AND b.kind='dispute'
                AND hold_event.action='dispute_hold' AND hold_event.version=delivery_head.version
                AND hold_event.actor_id=opening.actor_id AND hold_event.account_id=opening.account_id
                AND hold_event.context=opening.context AND opening.version=head.version
                AND ({dispute_event_unpublished('opening', 'NEW.order_id')})))
        OR (NEW.version=OLD.version+1 AND (NEW.blocker_id <=> OLD.blocker_id) AND OLD.state='pending' AND ({witnessed}))"""
    result += [
        trigger("orders_disputerequest", "DELETE", reject()),
        trigger("orders_disputerequest", "UPDATE", reject(f"NOT ({same(identity)}) OR NOT ({witness})")),
    ]

    body = "DECLARE target_state VARCHAR(21); SELECT state INTO target_state FROM orders_disputerequest WHERE id=NEW.dispute_id FOR UPDATE; "
    body += reject(
        f"""target_state IS NULL OR target_state<>'pending' OR CHAR_LENGTH(TRIM(NEW.text)) NOT BETWEEN 3 AND 2000
        OR NOT ({_seller_orders('(SELECT order_id FROM orders_disputerequest WHERE id=NEW.dispute_id)', 'NEW.actor_id')})
        OR NOT EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id
            WHERE e.id=NEW.event_id AND e.order_id=(SELECT order_id FROM orders_disputerequest WHERE id=NEW.dispute_id)
            AND e.action='dispute_response' AND e.context='seller' AND e.account_id=NEW.actor_id AND e.version=s.version)"""
    )
    result.append(trigger("orders_disputeresponse", "INSERT", body))

    body = (
        "DECLARE target_order CHAR(32); DECLARE target_state VARCHAR(21); DECLARE reviewer CHAR(32); "
        "SELECT order_id,state,assigned_to_id INTO target_order,target_state,reviewer "
        "FROM orders_disputerequest WHERE id=NEW.dispute_id FOR UPDATE; "
    )
    identity = (
        "((NEW.context='owner' AND NEW.account_id IS NULL AND EXISTS(SELECT 1 FROM accounts_user u "
        "WHERE u.id=NEW.actor_id AND u.is_superuser)) OR (NEW.context='staff' AND ("
        + _participant()
        + ")))"
    )
    body += reject(
        f"""target_order IS NULL OR target_state<>'pending' OR reviewer IS NULL OR reviewer<>NEW.actor_id
        OR NEW.action NOT IN ('dismissed','resolved_non_monetary','refund_ordered')
        OR CHAR_LENGTH(TRIM(NEW.reason)) NOT BETWEEN 3 AND 1000
        OR NOT ({identity}) OR NOT ({_aftercare_permission('NEW.actor_id', repr('decide_dispute'))})
        OR NOT ({_aftercare_permission('NEW.actor_id', repr('read_dispute'))})
        OR NOT ({dispute_independent('target_order', 'NEW.actor_id')})
        OR NOT ({_delivered('target_order')}) OR NOT ({_not_cancelled('target_order')})
        OR (NEW.action='refund_ordered' AND (NEW.amount IS NULL OR NEW.amount<=0 OR NEW.refund_due_id IS NULL
            OR NOT EXISTS(SELECT 1 FROM payments_refunddue d WHERE d.id=NEW.refund_due_id
                AND ({dispute_refund_match('d', 'NEW')})
                AND NOT EXISTS(SELECT 1 FROM payments_refundseal seal WHERE seal.due_id=d.id)
                AND NOT EXISTS(SELECT 1 FROM orders_disputedecision prior WHERE prior.refund_due_id=d.id))))
        OR (NEW.action<>'refund_ordered' AND (NEW.amount IS NOT NULL OR NEW.refund_due_id IS NOT NULL))
        OR NOT EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id
            WHERE e.id=NEW.event_id AND e.order_id=target_order AND e.version=s.version AND e.action='dispute_decided'
            AND e.actor_id=NEW.actor_id AND (e.account_id <=> NEW.account_id) AND e.context=NEW.context
            AND ({dispute_event_unpublished('e', 'target_order')}))
        OR EXISTS(SELECT 1 FROM orders_disputedecision prior
            WHERE prior.dispute_id=NEW.dispute_id OR prior.event_id=NEW.event_id)"""
    )
    result.append(trigger("orders_disputedecision", "INSERT", body))

    body = "DECLARE order_buyer CHAR(32); SELECT buyer_id INTO order_buyer FROM orders_sellerorder WHERE id=NEW.order_id FOR UPDATE; "
    body += reject(
        f"""order_buyer IS NULL OR NEW.version<>1 OR NEW.state<>'pending' OR NEW.buyer_id<>order_buyer
        OR NEW.rating NOT BETWEEN 1 AND 5 OR CHAR_LENGTH(TRIM(NEW.text)) NOT BETWEEN 3 AND 2000
        OR NEW.language NOT IN ('fa-AF','en','ps','ar')
        OR NOT EXISTS(SELECT 1 FROM fulfilment_completion c WHERE c.order_id=NEW.order_id)
        OR NOT ({_not_cancelled('NEW.order_id')})
        OR EXISTS(SELECT 1 FROM orders_review r WHERE r.order_id=NEW.order_id)
        OR NOT EXISTS(SELECT 1 FROM accounts_account a JOIN accounts_user u ON u.id=a.user_id
            WHERE a.id=NEW.buyer_id AND a.context='buyer' AND a.status='active' AND u.is_active AND u.email_verified)
        OR NOT EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id
            WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.action='review_submitted'
            AND e.context='buyer' AND e.account_id=NEW.buyer_id AND e.version=s.version)"""
    )
    result.append(trigger("orders_review", "INSERT", body))

    def moderation(actor, context, order):
        return f"""({context} IN ('owner','staff') AND ({_aftercare_permission(actor, repr('moderate_review'))})
        AND ({_aftercare_permission(actor, repr('read_review'))})
        AND ({aftercare_independent(order, actor)}))"""

    witnessed = f"""EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id
        WHERE e.order_id=NEW.order_id AND e.version=s.version
        AND ((e.action='review_withdrawn' AND OLD.state='pending' AND NEW.state='withdrawn'
            AND e.context='buyer' AND e.account_id=OLD.buyer_id
            AND EXISTS(SELECT 1 FROM orders_reviewdecision d WHERE d.review_id=NEW.order_id
                AND d.event_id=e.id AND d.action='withdrawn' AND d.context='buyer'))
        OR (e.action='review_decided' AND NEW.state IN ('approved','rejected','withdrawn')
            AND ((NEW.state IN ('approved','rejected') AND OLD.state='pending')
                OR (NEW.state='withdrawn' AND OLD.state IN ('pending','approved')))
            AND ({moderation('e.actor_id', 'e.context', 'NEW.order_id')})
            AND EXISTS(SELECT 1 FROM orders_reviewdecision d WHERE d.review_id=NEW.order_id
                AND d.event_id=e.id AND d.action=NEW.state))))"""
    result += [
        trigger("orders_review", "DELETE", reject()),
        trigger(
            "orders_review",
            "UPDATE",
            reject(
                f"NOT ({same('order_id buyer_id rating text language event_id created_at')}) OR NOT ("
                f"(NEW.version=OLD.version AND NEW.state=OLD.state) OR (NEW.version=OLD.version+1 AND ({witnessed})))"
            ),
        ),
    ]

    body = "DECLARE review_state VARCHAR(9); DECLARE review_buyer CHAR(32); DECLARE review_order CHAR(32); SELECT state,buyer_id,order_id INTO review_state,review_buyer,review_order FROM orders_review WHERE order_id=NEW.review_id FOR UPDATE; "
    body += reject(
        f"""review_state IS NULL OR CHAR_LENGTH(TRIM(NEW.reason)) NOT BETWEEN 3 AND 1000
        OR NEW.action NOT IN ('approved','rejected','withdrawn')
        OR ((NEW.context='buyer' AND (NEW.action<>'withdrawn' OR review_state<>'pending' OR review_buyer<>NEW.account_id))
            OR (NEW.context NOT IN ('buyer','owner','staff'))
            OR (NEW.context IN ('owner','staff') AND (NOT ({moderation('NEW.actor_id', 'NEW.context', 'review_order')})
                OR ((NEW.action IN ('approved','rejected') AND review_state<>'pending')
                    OR (NEW.action='withdrawn' AND review_state NOT IN ('pending','approved'))))))
        OR NOT EXISTS(SELECT 1 FROM orders_aftercareevent e JOIN orders_aftercare s ON s.order_id=e.order_id
            WHERE e.id=NEW.event_id AND e.order_id=review_order AND e.version=s.version
            AND e.action=IF(NEW.context='buyer','review_withdrawn','review_decided')
            AND e.actor_id=NEW.actor_id AND (e.account_id <=> NEW.account_id) AND e.context=NEW.context)"""
    )
    result.append(trigger("orders_reviewdecision", "INSERT", body))
    return result
