"""Native publication/decision guards. No session flag can bypass financial history."""

from apps.runtime.mariadb.ddl import reject, same, trigger, retained


def accepted(order):
    return f"EXISTS(SELECT 1 FROM orders_sellerorder o LEFT JOIN orders_checkoutoutcome c ON c.id=o.outcome_id LEFT JOIN orders_negotiation n ON n.id=o.negotiation_id WHERE o.id={order} AND (c.state='accepted' OR n.state='accepted'))"


def seller_account(order, account):
    return f"""EXISTS(SELECT 1 FROM orders_sellerorder o JOIN organizations_businessprofile p ON p.id=o.seller_id JOIN accounts_account a ON a.id={account} JOIN accounts_user u ON u.id=a.user_id
        WHERE o.id={order} AND a.context='seller' AND a.status='active' AND u.is_active AND u.email_verified
        AND (p.kind='individual' AND p.account_id=a.id OR p.kind='company' AND EXISTS(SELECT 1 FROM organizations_membership m WHERE m.company_id=p.id AND m.account_id=a.id AND m.active AND (m.is_owner OR JSON_CONTAINS(m.bundles,'"payments_refunds"')))))"""


def permission(user, code):
    return f"""EXISTS(SELECT 1 FROM accounts_user u WHERE u.id={user} AND u.is_active AND u.email_verified AND u.is_staff AND (u.is_superuser OR EXISTS(SELECT 1 FROM accounts_account a WHERE a.user_id=u.id AND a.context='staff' AND a.status='active') AND EXISTS(SELECT 1 FROM accounts_user_groups ug JOIN auth_group_permissions gp ON gp.group_id=ug.group_id JOIN auth_permission p ON p.id=gp.permission_id JOIN django_content_type ct ON ct.id=p.content_type_id WHERE ug.user_id=u.id AND ct.app_label='payments' AND p.codename={code})))"""


def independent(order, user):
    return f"""EXISTS(SELECT 1 FROM orders_sellerorder o JOIN accounts_account buyer ON buyer.id=o.buyer_id JOIN organizations_businessprofile seller ON seller.id=o.seller_id JOIN accounts_account owner_account ON owner_account.id=seller.account_id WHERE o.id={order} AND buyer.user_id<>{user} AND owner_account.user_id<>{user}
        AND NOT EXISTS(SELECT 1 FROM organizations_membership m JOIN accounts_account a ON a.id=m.account_id WHERE a.user_id={user} AND (m.company_id=o.seller_id OR m.company_id IN (SELECT p.id FROM organizations_businessprofile p WHERE p.account_id=o.buyer_id)))
        AND NOT EXISTS(SELECT 1 FROM payments_receipt r JOIN accounts_account a ON a.id=r.actor_id WHERE r.order_id=o.id AND a.user_id={user})
        AND NOT EXISTS(SELECT 1 FROM payments_stockplan p JOIN accounts_account a ON a.id=p.actor_id WHERE p.order_id=o.id AND a.user_id={user}))"""


def effective(receipt):
    return f"COALESCE((SELECT effective_c.amount FROM payments_correction effective_c JOIN payments_reviewcase effective_case ON effective_case.correction_id=effective_c.id WHERE effective_c.receipt_id={receipt}.id AND effective_case.state='approved' ORDER BY effective_c.target_version DESC LIMIT 1),{receipt}.amount)"


def receipt_version(receipt_id):
    return f"(1+(SELECT COUNT(*) FROM payments_correction version_c JOIN payments_reviewcase version_case ON version_case.correction_id=version_c.id WHERE version_c.receipt_id={receipt_id} AND version_case.state='approved'))"


def confirmed(order):
    return f"(SELECT COALESCE(SUM({effective('payment_sum_receipt')}),0) FROM payments_receipt payment_sum_receipt JOIN payments_receiptseal payment_sum_seal ON payment_sum_seal.receipt_id=payment_sum_receipt.id WHERE payment_sum_receipt.order_id={order})"


def due(order):
    return f"COALESCE((SELECT due_extension.due_at FROM payments_extension due_extension WHERE due_extension.order_id={order} ORDER BY due_extension.generation DESC LIMIT 1),(SELECT due_order.due_at FROM orders_sellerorder due_order WHERE due_order.id={order}))"


def generation(order):
    return f"(SELECT COALESCE(MAX(generation_extension.generation),1) FROM payments_extension generation_extension WHERE generation_extension.order_id={order})"


def overdue(order, gen=None):
    return (
        f"EXISTS(SELECT 1 FROM orders_sellerorder o WHERE o.id={order} AND o.payment_method='advance' AND {due(order)}<=UTC_TIMESTAMP(6) AND {confirmed(order)}<o.goods_total"
        + (f" AND {generation(order)}={gen}" if gen else "")
        + ")"
    )


def event_matches(event, order, account, action):
    return f"EXISTS(SELECT 1 FROM payments_event e JOIN payments_finance f ON f.order_id=e.order_id WHERE e.id={event} AND e.order_id={order} AND e.account_id={account} AND e.action='{action}' AND e.version<=f.version)"


def published_event(event, action):
    return f"""(({action}<>'receipt_confirmed' OR EXISTS(SELECT 1 FROM payments_receipt r JOIN payments_receiptseal seal ON seal.receipt_id=r.id WHERE r.event_id={event}))
        AND ({action} NOT IN ('claim_withdrawn','claim_rejected') OR EXISTS(SELECT 1 FROM payments_claimdecision decision WHERE decision.event_id={event}))
        AND ({action} NOT IN ('stock_reserved','allocation_shortage') OR EXISTS(SELECT 1 FROM payments_allocationattempt attempt WHERE attempt.event_id={event}))
        AND ({action}<>'claim_submitted' OR EXISTS(SELECT 1 FROM payments_claim c WHERE c.event_id={event}))
        AND ({action}<>'correction_proposed' OR EXISTS(SELECT 1 FROM payments_correction c JOIN payments_reviewcase k ON k.correction_id=c.id WHERE c.event_id={event}))
        AND ({action} NOT IN ('stock_plan_submitted','replacement_proposed') OR EXISTS(SELECT 1 FROM payments_stockplan p JOIN payments_stockplanseal seal ON seal.plan_id=p.id WHERE p.event_id={event}))
        AND ({action}<>'overdue_reminder' OR EXISTS(SELECT 1 FROM payments_reminder reminder WHERE reminder.event_id={event}))
        AND ({action}<>'deadline_extended' OR EXISTS(SELECT 1 FROM payments_extension x WHERE x.event_id={event}))
        AND ({action} NOT IN ('case_assign','case_approve','case_reject','case_replenish','case_refer','case_resolve','overdue_cleared','overdue_reopened') OR EXISTS(SELECT 1 FROM payments_caseevent k WHERE k.event_id={event})))"""


def statements():
    result = []
    for table in [
        "event",
        "command",
        "claim",
        "claimdecision",
        "receipt",
        "receiptseal",
        "correction",
        "extension",
        "stockplan",
        "stockplanline",
        "stockplanseal",
        "allocationattempt",
        "caseevent",
        "evidencebinding",
        "emailattempt",
        "reminder",
    ]:
        result += retained("payments_" + table)
    result.append(trigger("payments_finance", "INSERT", reject(f"NEW.version<>0 OR NOT ({accepted('NEW.order_id')})")))
    result.append(trigger("payments_finance", "DELETE", reject()))
    result.append(
        trigger(
            "payments_finance",
            "UPDATE",
            reject(
                f"NOT ({same('order_id created_at')}) OR (NEW.version<>OLD.version AND (NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM payments_event e WHERE e.order_id=NEW.order_id AND e.version=NEW.version)))"
            ),
        )
    )
    body = "DECLARE current_version BIGINT; SELECT version INTO current_version FROM payments_finance WHERE order_id=NEW.order_id FOR UPDATE; "
    body += reject(f"current_version IS NULL OR NEW.version<>current_version+1 OR NOT ({accepted('NEW.order_id')})")
    buyer = "EXISTS(SELECT 1 FROM orders_sellerorder o JOIN accounts_account a ON a.id=o.buyer_id JOIN accounts_user u ON u.id=a.user_id WHERE o.id=NEW.order_id AND NEW.account_id=a.id AND NEW.actor_id=u.id AND a.context='buyer' AND a.status='active' AND u.is_active AND u.email_verified)"
    seller = (
        seller_account("NEW.order_id", "NEW.account_id")
        + " AND EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.account_id AND a.user_id=NEW.actor_id)"
    )
    body += reject(f"""NOT ((NEW.context='buyer' AND NEW.action IN ('claim_submitted','claim_withdrawn') AND ({buyer}))
        OR (NEW.context='seller' AND NEW.action IN ('receipt_confirmed','claim_rejected','correction_proposed','deadline_extended','stock_plan_submitted','replacement_proposed') AND ({seller}))
        OR (NEW.context IN ('owner','staff') AND NEW.action IN ('case_assign','case_approve','case_reject','case_replenish','case_refer','case_resolve') AND ({permission("NEW.actor_id", "'read_payments'")}))
        OR (NEW.context='system' AND NEW.actor_id IS NULL AND NEW.account_id IS NULL AND NEW.action IN ('allocation_review','allocation_shortage','stock_reserved','overdue_reminder','overdue_reopened','overdue_cleared')))""")
    result.append(trigger("payments_event", "INSERT", body))
    result.append(
        trigger(
            "payments_command",
            "INSERT",
            reject(
                "NEW.context NOT IN ('buyer','seller','staff','owner') OR CHAR_LENGTH(NEW.digest)<>64 OR NOT JSON_VALID(NEW.result) OR NOT EXISTS(SELECT 1 FROM accounts_user u WHERE u.id=NEW.actor_id AND u.is_active AND u.email_verified) OR (NEW.context<>'owner' AND NOT EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.account_id AND a.user_id=NEW.actor_id AND a.context=NEW.context AND a.status='active')) OR (NEW.context='owner' AND NOT EXISTS(SELECT 1 FROM accounts_user u WHERE u.id=NEW.actor_id AND u.is_superuser AND u.is_staff))"
            ),
        )
    )
    command_action = "CASE NEW.action WHEN 'claim' THEN 'claim_submitted' WHEN 'receipt' THEN 'receipt_confirmed' WHEN 'confirm' THEN 'receipt_confirmed' WHEN 'withdraw' THEN 'claim_withdrawn' WHEN 'reject' THEN 'claim_rejected' WHEN 'correction' THEN 'correction_proposed' WHEN 'extension' THEN 'deadline_extended' WHEN 'plan' THEN (SELECT action FROM payments_event WHERE id=NEW.event_id) ELSE NEW.action END"
    command_source = f"(NEW.action NOT IN ('upload','absence_fence') AND EXISTS(SELECT 1 FROM payments_event e WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.actor_id=NEW.actor_id AND (e.account_id <=> NEW.account_id) AND e.context=NEW.context AND e.action={command_action} AND ({published_event('e.id', 'e.action')}))) OR (NEW.action='absence_fence' AND NEW.event_id IS NULL AND NEW.digest=REPEAT('0',64) AND JSON_TYPE(JSON_EXTRACT(NEW.result,'$.settled'))='BOOLEAN' AND JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.settled'))='true') OR (NEW.action='upload' AND NEW.event_id IS NULL AND EXISTS(SELECT 1 FROM payments_evidence image WHERE image.order_id=NEW.order_id AND image.creator_id=NEW.account_id AND image.id=REPLACE(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.id')),'-','')))"
    result.append(trigger("payments_command", "INSERT", reject(f"NOT ({command_source})"), suffix="source_guard"))
    result_identity = """(NEW.action='claim' AND EXISTS(SELECT 1 FROM payments_claim c WHERE c.event_id=NEW.event_id AND c.id=REPLACE(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.claim')),'-','')))
        OR (NEW.action IN ('receipt','confirm') AND EXISTS(SELECT 1 FROM payments_receipt r JOIN payments_receiptseal seal ON seal.receipt_id=r.id WHERE r.event_id=NEW.event_id AND r.id=REPLACE(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.receipt')),'-','')))
        OR (NEW.action IN ('withdraw','reject') AND EXISTS(SELECT 1 FROM payments_claimdecision d WHERE d.event_id=NEW.event_id AND d.claim_id=REPLACE(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.claim')),'-','')))
        OR (NEW.action='correction' AND EXISTS(SELECT 1 FROM payments_correction c WHERE c.event_id=NEW.event_id AND c.id=REPLACE(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.correction')),'-','')))
        OR (NEW.action='extension' AND EXISTS(SELECT 1 FROM payments_extension x WHERE x.event_id=NEW.event_id AND x.id=REPLACE(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.extension')),'-','')))
        OR (NEW.action='plan' AND EXISTS(SELECT 1 FROM payments_stockplan p JOIN payments_stockplanseal seal ON seal.plan_id=p.id WHERE p.event_id=NEW.event_id AND p.id=REPLACE(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.plan')),'-','')))
        OR (NEW.action IN ('case_assign','case_approve','case_reject','case_replenish','case_refer','case_resolve') AND EXISTS(SELECT 1 FROM payments_caseevent k WHERE k.event_id=NEW.event_id AND k.case_id=REPLACE(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.case')),'-','')))"""
    result.append(
        trigger(
            "payments_command",
            "INSERT",
            reject(
                f"NEW.digest NOT REGEXP BINARY '^[0-9a-f]{{64}}$' OR (NEW.action NOT IN ('upload','absence_fence') AND (NOT ({result_identity}) OR NOT (JSON_TYPE(JSON_EXTRACT(NEW.result,'$.version')) <=> 'INTEGER') OR NOT EXISTS(SELECT 1 FROM payments_event e WHERE e.id=NEW.event_id AND e.version=CAST(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.version')) AS UNSIGNED))))"
            ),
            suffix="result_guard",
        )
    )
    result.append(
        trigger(
            "payments_claim",
            "INSERT",
            reject(
                f"NOT ({event_matches('NEW.event_id', 'NEW.order_id', 'NEW.actor_id', 'claim_submitted')}) OR NEW.currency<>(SELECT currency FROM orders_sellerorder WHERE id=NEW.order_id) OR NEW.paid_at>UTC_TIMESTAMP(6) OR CHAR_LENGTH(TRIM(NEW.description))=0 OR NEW.previous_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments_claim c JOIN payments_claimdecision d ON d.claim_id=c.id WHERE c.id=NEW.previous_id AND c.order_id=NEW.order_id AND c.actor_id=NEW.actor_id AND d.action IN ('withdrawn','rejected'))"
            ),
        )
    )
    body = "DECLARE parent_id CHAR(32); SELECT id INTO parent_id FROM payments_claim WHERE id=NEW.claim_id FOR UPDATE; "
    body += reject(
        "NEW.version<>2 OR NEW.action NOT IN ('confirmed','rejected','withdrawn') OR NOT EXISTS(SELECT 1 FROM payments_claim c JOIN payments_event e ON e.id=NEW.event_id WHERE c.id=NEW.claim_id AND e.order_id=c.order_id AND e.account_id=NEW.actor_id AND e.action=CASE NEW.action WHEN 'confirmed' THEN 'receipt_confirmed' WHEN 'rejected' THEN 'claim_rejected' ELSE 'claim_withdrawn' END) OR (NEW.action='withdrawn' AND NEW.actor_id<>(SELECT actor_id FROM payments_claim WHERE id=NEW.claim_id)) OR (NEW.action='confirmed' AND NOT EXISTS(SELECT 1 FROM payments_receipt r WHERE r.claim_id=NEW.claim_id AND r.event_id=NEW.event_id)) OR (NEW.action<>'confirmed' AND EXISTS(SELECT 1 FROM payments_receipt r JOIN payments_receiptseal s ON s.receipt_id=r.id WHERE r.claim_id=NEW.claim_id))"
    )
    result.append(trigger("payments_claimdecision", "INSERT", body))
    body = reject(
        f"NOT ({event_matches('NEW.event_id', 'NEW.order_id', 'NEW.actor_id', 'receipt_confirmed')}) OR NEW.currency<>(SELECT currency FROM orders_sellerorder WHERE id=NEW.order_id) OR NEW.paid_at>UTC_TIMESTAMP(6) OR CHAR_LENGTH(TRIM(NEW.description))=0"
    )
    body += reject(
        "NEW.claim_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments_claim c WHERE c.id=NEW.claim_id AND c.order_id=NEW.order_id AND c.amount=NEW.amount AND c.currency=NEW.currency AND c.paid_at=NEW.paid_at AND c.description=NEW.description AND NOT EXISTS(SELECT 1 FROM payments_claimdecision d WHERE d.claim_id=c.id))"
    )
    result.append(trigger("payments_receipt", "INSERT", body))
    body = "DECLARE parent_id CHAR(32); SELECT id INTO parent_id FROM payments_receipt WHERE id=NEW.receipt_id FOR UPDATE; "
    body += reject(f"""NOT EXISTS(SELECT 1 FROM payments_receipt r JOIN payments_event e ON e.id=r.event_id JOIN payments_finance f ON f.order_id=r.order_id WHERE r.id=NEW.receipt_id AND e.version<=f.version AND e.action='receipt_confirmed'
        AND EXISTS(SELECT 1 FROM payments_reviewcase k WHERE k.receipt_id=r.id AND k.kind='receipt' AND k.order_id=r.order_id)
        AND (r.claim_id IS NULL OR EXISTS(SELECT 1 FROM payments_claimdecision d WHERE d.claim_id=r.claim_id AND d.action='confirmed' AND d.event_id=r.event_id))
        AND ((SELECT payment_method FROM orders_sellerorder WHERE id=r.order_id)<>'advance' OR EXISTS(SELECT 1 FROM payments_allocationintent i WHERE i.order_id=r.order_id))
        AND {confirmed("r.order_id")}+r.amount<=9999999999999999999999.99)""")
    result.append(trigger("payments_receiptseal", "INSERT", body))
    body = "DECLARE parent_id CHAR(32); SELECT id INTO parent_id FROM payments_receipt WHERE id=NEW.receipt_id FOR UPDATE; "
    body += reject(
        f"NEW.target_version<>{receipt_version('NEW.receipt_id')} OR NEW.paid_at>UTC_TIMESTAMP(6) OR CHAR_LENGTH(TRIM(NEW.description))=0 OR NOT EXISTS(SELECT 1 FROM payments_receipt r JOIN payments_receiptseal s ON s.receipt_id=r.id WHERE r.id=NEW.receipt_id AND ({event_matches('NEW.event_id', 'r.order_id', 'NEW.actor_id', 'correction_proposed')})) OR EXISTS(SELECT 1 FROM payments_correction c LEFT JOIN payments_reviewcase k ON k.correction_id=c.id WHERE c.receipt_id=NEW.receipt_id AND (k.id IS NULL OR k.state='open'))"
    )
    result.append(trigger("payments_correction", "INSERT", body))
    result.append(
        trigger(
            "payments_extension",
            "INSERT",
            reject(
                f"NEW.generation<>{generation('NEW.order_id')}+1 OR NOT (NEW.before_at <=> {due('NEW.order_id')}) OR NOT EXISTS(SELECT 1 FROM orders_sellerorder o WHERE o.id=NEW.order_id AND o.payment_method='advance') OR NOT ({event_matches('NEW.event_id', 'NEW.order_id', 'NEW.actor_id', 'deadline_extended')})"
            ),
        )
    )
    result += plan_statements()
    result += case_statements()
    result += intent_statements()
    result += evidence_statements()
    result += delivery_statements()
    return result


def plan_statements():
    result = [
        trigger(
            "payments_stockplan",
            "INSERT",
            reject(
                f"NOT EXISTS(SELECT 1 FROM orders_sellerorder o WHERE o.id=NEW.order_id AND o.payment_method='advance') OR NOT (({event_matches('NEW.event_id', 'NEW.order_id', 'NEW.actor_id', 'stock_plan_submitted')}) OR ({event_matches('NEW.event_id', 'NEW.order_id', 'NEW.actor_id', 'replacement_proposed')})) OR (NEW.replaces_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments_allocationattempt a JOIN payments_allocationintent i ON i.order_id=a.intent_id WHERE i.order_id=NEW.order_id AND a.shortage_id=NEW.replaces_id AND i.allocation_id IS NULL AND i.version=NEW.intent_version))"
            ),
        )
    ]
    body = (
        "DECLARE parent_id CHAR(32); SELECT id INTO parent_id FROM payments_stockplan WHERE id=NEW.plan_id FOR UPDATE; "
    )
    body += reject(
        "EXISTS(SELECT 1 FROM payments_stockplanseal WHERE plan_id=NEW.plan_id) OR (SELECT COUNT(*) FROM payments_stockplanline WHERE plan_id=NEW.plan_id)>=100 OR EXISTS(SELECT 1 FROM payments_stockplanline WHERE plan_id=NEW.plan_id AND variant_id=NEW.variant_id AND (batch_id <=> NEW.batch_id)) OR NOT EXISTS(SELECT 1 FROM payments_stockplan p JOIN orders_orderline l ON l.order_id=p.order_id JOIN catalogue_variant v ON v.id=l.variant_id WHERE p.id=NEW.plan_id AND l.variant_id=NEW.variant_id AND MOD(NEW.quantity,v.quantity_increment)=0) OR NEW.batch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_batch b WHERE b.id=NEW.batch_id AND b.position_id=NEW.variant_id)"
    )
    result.append(trigger("payments_stockplanline", "INSERT", body))
    body = (
        "DECLARE parent_id CHAR(32); SELECT id INTO parent_id FROM payments_stockplan WHERE id=NEW.plan_id FOR UPDATE; "
    )
    body += reject(
        "NOT EXISTS(SELECT 1 FROM payments_stockplanline WHERE plan_id=NEW.plan_id) OR EXISTS(SELECT l.variant_id FROM payments_stockplan p JOIN orders_orderline l ON l.order_id=p.order_id WHERE p.id=NEW.plan_id GROUP BY l.variant_id HAVING SUM(l.quantity)<>COALESCE((SELECT SUM(s.quantity) FROM payments_stockplanline s WHERE s.plan_id=NEW.plan_id AND s.variant_id=l.variant_id),0)) OR EXISTS(SELECT 1 FROM payments_stockplanline s JOIN payments_stockplan p ON p.id=s.plan_id WHERE s.plan_id=NEW.plan_id AND NOT EXISTS(SELECT 1 FROM orders_orderline l WHERE l.order_id=p.order_id AND l.variant_id=s.variant_id)) OR EXISTS(SELECT 1 FROM payments_stockplan p WHERE p.id=NEW.plan_id AND p.replaces_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments_reviewcase k WHERE k.plan_id=p.id AND k.kind='replacement' AND k.order_id=p.order_id))"
    )
    result.append(trigger("payments_stockplanseal", "INSERT", body))
    return result


def case_statements():
    result = []
    body = "DECLARE parent_id CHAR(32); SELECT order_id INTO parent_id FROM payments_finance WHERE order_id=NEW.order_id FOR UPDATE; "
    valid = """(NEW.kind='receipt' AND NEW.receipt_id IS NOT NULL AND NEW.correction_id IS NULL AND NEW.plan_id IS NULL AND EXISTS(SELECT 1 FROM payments_receipt r WHERE r.id=NEW.receipt_id AND r.order_id=NEW.order_id))
        OR (NEW.kind='correction' AND EXISTS(SELECT 1 FROM payments_correction c JOIN payments_receipt r ON r.id=c.receipt_id WHERE c.id=NEW.correction_id AND r.id=NEW.receipt_id AND r.order_id=NEW.order_id))
        OR (NEW.kind='replacement' AND EXISTS(SELECT 1 FROM payments_stockplan p WHERE p.id=NEW.plan_id AND p.order_id=NEW.order_id AND p.replaces_id IS NOT NULL))
        OR (NEW.kind='shortage' AND EXISTS(SELECT 1 FROM payments_allocationintent i WHERE i.order_id=NEW.order_id AND i.state IN ('shortage','review_required')))
        OR (NEW.kind='zero_balance' AND EXISTS(SELECT 1 FROM payments_receipt r JOIN payments_receiptseal seal ON seal.receipt_id=r.id JOIN payments_event e ON e.order_id=r.order_id AND e.version=NEW.generation JOIN payments_caseevent decision ON decision.event_id=e.id AND decision.action='approve' JOIN payments_reviewcase reviewed ON reviewed.id=decision.case_id AND reviewed.kind='correction' AND reviewed.state='approved' JOIN payments_correction correction ON correction.id=reviewed.correction_id AND correction.receipt_id=r.id WHERE r.id=NEW.receipt_id AND r.order_id=NEW.order_id))"""
    valid += f" OR (NEW.kind='overdue' AND ({overdue('NEW.order_id', 'NEW.generation')}))"
    body += reject(
        f"parent_id IS NULL OR NEW.version<>1 OR NEW.state<>'open' OR NEW.assigned_to_id IS NOT NULL OR NOT NEW.overdue_active OR NOT ({valid}) OR EXISTS(SELECT 1 FROM payments_reviewcase k WHERE k.order_id=NEW.order_id AND k.kind=NEW.kind AND (NEW.kind='shortage' OR NEW.kind='zero_balance' AND k.state='open' OR NEW.kind='overdue' AND k.generation=NEW.generation OR NEW.kind='receipt' AND k.receipt_id=NEW.receipt_id))"
    )
    body += reject(
        f"NEW.receipt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments_receipt r WHERE r.id=NEW.receipt_id AND r.order_id=NEW.order_id) OR NEW.correction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments_correction c JOIN payments_receipt r ON r.id=c.receipt_id WHERE c.id=NEW.correction_id AND r.order_id=NEW.order_id) OR NEW.plan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments_stockplan p WHERE p.id=NEW.plan_id AND p.order_id=NEW.order_id) OR NEW.shortage_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payments_allocationattempt t WHERE t.shortage_id=NEW.shortage_id AND t.intent_id=NEW.order_id) OR NEW.kind='zero_balance' AND {confirmed('NEW.order_id')}<>0"
    )
    result.append(trigger("payments_reviewcase", "INSERT", body))
    identity = same("id key order_id kind receipt_id correction_id plan_id shortage_id generation created_at")
    transition = """EXISTS(SELECT 1 FROM payments_caseevent e WHERE e.case_id=NEW.id AND e.version=NEW.version
        AND ((e.action='assign' AND (NEW.assigned_to_id <=> e.assigned_to_id) AND NEW.state=OLD.state AND NEW.overdue_active=OLD.overdue_active)
        OR (e.action IN ('approve','reject','resolve','refer') AND NEW.state=CASE e.action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' WHEN 'resolve' THEN 'resolved' ELSE 'referred' END AND (NEW.assigned_to_id <=> OLD.assigned_to_id) AND NEW.overdue_active=OLD.overdue_active)
        OR (e.action='replenish' AND NEW.state=OLD.state AND (NEW.assigned_to_id <=> OLD.assigned_to_id) AND NEW.overdue_active=OLD.overdue_active)
        OR (e.action='system_clear' AND NOT NEW.overdue_active AND NEW.state='resolved')
        OR (e.action='system_reopen' AND NEW.overdue_active AND NEW.state='open' AND NEW.assigned_to_id IS NULL)))"""
    result += [
        trigger("payments_reviewcase", "DELETE", reject()),
        trigger(
            "payments_reviewcase",
            "UPDATE",
            reject(f"NOT ({identity}) OR NEW.version<>OLD.version+1 OR NOT ({transition})"),
        ),
    ]
    body = "DECLARE order_id CHAR(32); DECLARE current_version BIGINT; DECLARE assigned_id CHAR(32); DECLARE case_kind VARCHAR(16); DECLARE case_state VARCHAR(12); DECLARE correction_id CHAR(32); DECLARE plan_id CHAR(32); DECLARE active_flag BOOL; DECLARE due_generation BIGINT; DECLARE required_code VARCHAR(50); SELECT k.order_id,k.version,k.assigned_to_id,k.kind,k.state,k.correction_id,k.plan_id,k.overdue_active,k.generation INTO order_id,current_version,assigned_id,case_kind,case_state,correction_id,plan_id,active_flag,due_generation FROM payments_reviewcase k WHERE k.id=NEW.case_id FOR UPDATE; SET required_code=CASE case_kind WHEN 'receipt' THEN 'review_payment' WHEN 'correction' THEN 'decide_payment_correction' WHEN 'shortage' THEN 'decide_payment_shortage' WHEN 'replacement' THEN 'decide_payment_shortage' ELSE 'review_overdue' END; "
    body += reject(
        "NEW.version<>current_version+1 OR CHAR_LENGTH(TRIM(NEW.reason))<3 OR NOT EXISTS(SELECT 1 FROM payments_event e JOIN payments_finance f ON f.order_id=e.order_id WHERE e.id=NEW.event_id AND e.order_id=order_id AND e.version<=f.version AND (e.actor_id <=> NEW.actor_id) AND e.context=NEW.context AND e.action=CASE NEW.action WHEN 'system_clear' THEN 'overdue_cleared' WHEN 'system_reopen' THEN 'overdue_reopened' ELSE CONCAT('case_',NEW.action) END)"
    )
    assignment = f"NEW.action='assign' AND ({permission('NEW.actor_id', "'assign_payment_case'")}) AND (NEW.assigned_to_id IS NULL OR (({permission('NEW.assigned_to_id', 'required_code')}) AND ({independent('order_id', 'NEW.assigned_to_id')})))"
    decision = f"NEW.action IN ('approve','reject','replenish','refer','resolve') AND case_state='open' AND NEW.actor_id=assigned_id AND ({permission('NEW.actor_id', 'required_code')}) AND ({independent('order_id', 'NEW.actor_id')})"
    system = f"NEW.context='system' AND NEW.actor_id IS NULL AND NEW.account_id IS NULL AND case_kind='overdue' AND ((NEW.action='system_clear' AND active_flag AND NOT ({overdue('order_id', 'due_generation')})) OR (NEW.action='system_reopen' AND NOT active_flag AND ({overdue('order_id', 'due_generation')})))"
    body += reject(
        f"NOT (({assignment}) OR ({decision}) OR ({system}))", "Independent current assigned payment authority required"
    )
    body += reject(
        "NEW.action IN ('approve','reject') AND case_kind NOT IN ('receipt','correction','replacement') OR NEW.action='replenish' AND case_kind<>'shortage' OR NEW.action IN ('refer','resolve') AND case_kind NOT IN ('shortage','overdue','zero_balance')"
    )
    body += reject(
        f"case_kind='correction' AND NEW.action IN ('approve','reject') AND NOT EXISTS(SELECT 1 FROM payments_correction c WHERE c.id=correction_id AND c.target_version={receipt_version('c.receipt_id')})",
        "Stale receipt correction",
    )
    body += reject(
        "case_kind='replacement' AND NEW.action='approve' AND NOT EXISTS(SELECT 1 FROM payments_stockplan p JOIN payments_stockplanseal s ON s.plan_id=p.id JOIN payments_allocationintent i ON i.order_id=p.order_id WHERE p.id=plan_id AND i.allocation_id IS NULL AND i.version=p.intent_version)"
    )
    body += reject(
        f"case_kind='correction' AND NEW.action='approve' AND EXISTS(SELECT 1 FROM payments_correction c JOIN payments_receipt r ON r.id=c.receipt_id WHERE c.id=correction_id AND {confirmed('order_id')}-{effective('r')}+c.amount>9999999999999999999999.99)",
        "Correction total overflow",
    )
    body += reject(
        "case_kind='receipt' AND NEW.action IN ('approve','reject') AND NOT EXISTS(SELECT 1 FROM payments_reviewcase k JOIN payments_receiptseal s ON s.receipt_id=k.receipt_id WHERE k.id=NEW.case_id) OR case_kind='shortage' AND NEW.action='replenish' AND EXISTS(SELECT 1 FROM payments_allocationintent i WHERE i.order_id=order_id AND i.allocation_id IS NOT NULL)"
    )
    result.append(trigger("payments_caseevent", "INSERT", body))
    return result


def intent_statements():
    result = []
    valid_plan = "NEW.plan_id IS NULL OR EXISTS(SELECT 1 FROM payments_stockplan p JOIN payments_stockplanseal s ON s.plan_id=p.id WHERE p.id=NEW.plan_id AND p.order_id=NEW.order_id)"
    result.append(
        trigger(
            "payments_allocationintent",
            "INSERT",
            reject(
                f"NEW.version<>1 OR NEW.state NOT IN ('pending','awaiting_selection') OR NEW.allocation_id IS NOT NULL OR NOT ({valid_plan}) OR NOT EXISTS(SELECT 1 FROM payments_receipt r JOIN orders_sellerorder o ON o.id=r.order_id WHERE r.id=NEW.first_receipt_id AND o.id=NEW.order_id AND o.payment_method='advance')"
            ),
        )
    )
    valid_allocation = "NEW.allocation_id IS NULL OR EXISTS(SELECT 1 FROM inventory_allocation a JOIN payments_allocationattempt t ON t.operation_id=a.operation_id WHERE a.id=NEW.allocation_id AND a.state='held' AND t.intent_id=NEW.order_id)"
    valid_changed_plan = """(NEW.plan_id <=> OLD.plan_id) OR (OLD.allocation_id IS NULL AND EXISTS(SELECT 1 FROM payments_stockplan p JOIN payments_stockplanseal s ON s.plan_id=p.id WHERE p.id=NEW.plan_id AND p.order_id=NEW.order_id AND (NOT EXISTS(SELECT 1 FROM payments_allocationattempt t WHERE t.intent_id=NEW.order_id) AND p.replaces_id IS NULL OR EXISTS(SELECT 1 FROM payments_reviewcase k WHERE k.plan_id=p.id AND k.state='approved'))))"""
    identity = same("order_id id first_receipt_id created_at")
    result += [
        trigger("payments_allocationintent", "DELETE", reject()),
        trigger(
            "payments_allocationintent",
            "UPDATE",
            reject(
                f"NOT ({identity}) OR NEW.version<>OLD.version+1 OR NOT ({valid_allocation}) OR NOT ({valid_changed_plan}) OR (OLD.allocation_id IS NOT NULL AND (NOT (NEW.allocation_id <=> OLD.allocation_id) OR NEW.state<>'reserved')) OR (NEW.state='reserved' AND NEW.allocation_id IS NULL) OR (OLD.allocation_id IS NULL AND NEW.allocation_id IS NOT NULL AND {confirmed('NEW.order_id')}<=0)"
            ),
        ),
    ]
    result.append(
        trigger(
            "payments_allocationattempt",
            "INSERT",
            reject(
                f"{confirmed('NEW.intent_id')}<=0 OR NOT EXISTS(SELECT 1 FROM payments_event attempt_event WHERE attempt_event.id=NEW.event_id AND attempt_event.order_id=NEW.intent_id AND attempt_event.context='system' AND attempt_event.action=CASE WHEN NEW.shortage_id IS NULL THEN 'stock_reserved' ELSE 'allocation_shortage' END) OR "
                + """NOT EXISTS(SELECT 1 FROM payments_allocationintent i JOIN payments_stockplan p ON p.id=NEW.plan_id JOIN payments_stockplanseal s ON s.plan_id=p.id JOIN orders_sellerorder o ON o.id=i.order_id JOIN inventory_operation operation ON operation.id=NEW.operation_id WHERE i.order_id=NEW.intent_id AND i.plan_id=p.id AND i.state='pending' AND i.allocation_id IS NULL AND o.payment_method='advance' AND operation.id=NEW.id AND operation.seller_id=o.seller_id AND operation.action='reserve') OR NEW.number<>(1+(SELECT COALESCE(MAX(t.number),0) FROM payments_allocationattempt t WHERE t.intent_id=NEW.intent_id))
        OR (NEW.shortage_id IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM inventory_shortage s WHERE s.id=NEW.shortage_id AND s.operation_id=NEW.operation_id) OR EXISTS(SELECT 1 FROM inventory_movement m WHERE m.operation_id=NEW.operation_id)))
        OR (NEW.shortage_id IS NULL AND (NOT EXISTS(SELECT 1 FROM inventory_allocation a WHERE a.operation_id=NEW.operation_id AND a.state='held') OR EXISTS(SELECT 1 FROM payments_stockplanline p WHERE p.plan_id=NEW.plan_id AND NOT EXISTS(SELECT 1 FROM inventory_allocation a JOIN inventory_allocationline l ON l.allocation_id=a.id JOIN inventory_bucket b ON b.id=l.bucket_id JOIN inventory_movement m ON m.operation_id=a.operation_id AND m.bucket_id=b.id WHERE a.operation_id=NEW.operation_id AND b.position_id=p.variant_id AND (b.batch_id <=> p.batch_id) AND l.quantity=p.quantity AND m.held_delta=p.quantity AND m.physical_delta=0))))"""
            ),
        )
    )
    result.append(
        trigger(
            "payments_allocationattempt",
            "INSERT",
            reject(
                "NEW.shortage_id IS NULL AND EXISTS(SELECT 1 FROM inventory_allocation a JOIN inventory_allocationline l ON l.allocation_id=a.id JOIN inventory_bucket b ON b.id=l.bucket_id WHERE a.operation_id=NEW.operation_id AND NOT EXISTS(SELECT 1 FROM payments_stockplanline p WHERE p.plan_id=NEW.plan_id AND p.variant_id=b.position_id AND (p.batch_id <=> b.batch_id) AND p.quantity=l.quantity))"
            ),
            suffix="scope_guard",
        )
    )
    return result


def evidence_statements():
    result = [
        trigger(
            "payments_evidence",
            "INSERT",
            reject(
                "NEW.storage_alias<>'private_local' OR NEW.key<>CONCAT('payments/',NEW.id,'.jpg') OR NEW.size NOT BETWEEN 1 AND 5242880 OR NEW.width NOT BETWEEN 1 AND 6000 OR NEW.height NOT BETWEEN 1 AND 6000 OR NEW.width*NEW.height>20000000 OR NEW.sha256 NOT REGEXP BINARY '^[0-9a-f]{64}$' OR NEW.expires_at<=NEW.created_at OR NOT EXISTS(SELECT 1 FROM accounts_account a JOIN accounts_user u ON u.id=a.user_id JOIN orders_sellerorder o ON o.id=NEW.order_id WHERE a.id=NEW.creator_id AND a.status='active' AND u.is_active AND u.email_verified AND (a.id=o.buyer_id OR a.context='seller'))"
            ),
        )
    ]
    result.append(
        trigger(
            "payments_evidence",
            "INSERT",
            reject(
                f"NOT EXISTS(SELECT 1 FROM orders_sellerorder o WHERE o.id=NEW.order_id AND o.buyer_id=NEW.creator_id) AND NOT ({seller_account('NEW.order_id', 'NEW.creator_id')})"
            ),
            suffix="scope_guard",
        )
    )
    result.append(trigger("payments_evidence", "UPDATE", reject()))
    result.append(
        trigger(
            "payments_evidence",
            "DELETE",
            reject(
                "OLD.expires_at>UTC_TIMESTAMP(6) OR EXISTS(SELECT 1 FROM payments_evidencebinding b WHERE b.evidence_id=OLD.id)"
            ),
        )
    )
    body = "DECLARE parent_id CHAR(32); SELECT id INTO parent_id FROM payments_evidence WHERE id=NEW.evidence_id FOR UPDATE; "
    body += reject("""NOT EXISTS(SELECT 1 FROM payments_evidence e WHERE e.id=NEW.evidence_id AND e.expires_at>UTC_TIMESTAMP(6)
        AND ((NEW.claim_id IS NOT NULL AND EXISTS(SELECT 1 FROM payments_claim c WHERE c.id=NEW.claim_id AND c.order_id=e.order_id AND c.actor_id=e.creator_id) AND (SELECT COUNT(*) FROM payments_evidencebinding b WHERE b.claim_id=NEW.claim_id)<3)
        OR (NEW.receipt_id IS NOT NULL AND EXISTS(SELECT 1 FROM payments_receipt r WHERE r.id=NEW.receipt_id AND r.order_id=e.order_id AND r.actor_id=e.creator_id) AND (SELECT COUNT(*) FROM payments_evidencebinding b WHERE b.receipt_id=NEW.receipt_id)<3)
        OR (NEW.correction_id IS NOT NULL AND EXISTS(SELECT 1 FROM payments_correction c JOIN payments_receipt r ON r.id=c.receipt_id WHERE c.id=NEW.correction_id AND r.order_id=e.order_id AND c.actor_id=e.creator_id) AND (SELECT COUNT(*) FROM payments_evidencebinding b WHERE b.correction_id=NEW.correction_id)<3)))""")
    body += reject(
        "(NEW.receipt_id IS NOT NULL AND EXISTS(SELECT 1 FROM payments_receiptseal seal WHERE seal.receipt_id=NEW.receipt_id)) OR (NEW.correction_id IS NOT NULL AND EXISTS(SELECT 1 FROM payments_reviewcase k WHERE k.correction_id=NEW.correction_id)) OR (NEW.claim_id IS NOT NULL AND EXISTS(SELECT 1 FROM payments_claim c JOIN notifications_event n ON n.payment_event_id=c.event_id WHERE c.id=NEW.claim_id))"
    )
    result.append(trigger("payments_evidencebinding", "INSERT", body))
    return result


def delivery_statements():
    result = [
        trigger("payments_noticecursor", "DELETE", reject()),
        trigger(
            "payments_noticecursor",
            "UPDATE",
            reject(
                f"OLD.complete OR NEW.version<>OLD.version+1 OR NOT ({same('event_id sender_id generation slot')}) OR OLD.after_account IS NOT NULL AND (NEW.after_account IS NULL OR NEW.after_account<OLD.after_account)"
            ),
        ),
    ]
    result.append(
        trigger(
            "payments_noticecursor",
            "INSERT",
            reject(
                "NOT EXISTS(SELECT 1 FROM notifications_event n WHERE n.payment_event_id=NEW.event_id AND n.kind='payment') OR NEW.version<>1 OR NEW.complete OR NEW.after_account IS NOT NULL"
            ),
        )
    )
    result.append(
        trigger(
            "payments_email",
            "INSERT",
            reject(
                f"NOT EXISTS(SELECT 1 FROM payments_reminder r WHERE r.order_id=NEW.order_id AND r.generation=NEW.generation AND r.slot=NEW.slot) OR NOT (EXISTS(SELECT 1 FROM orders_sellerorder o JOIN accounts_account a ON a.id=o.buyer_id JOIN accounts_user u ON u.id=a.user_id WHERE o.id=NEW.order_id AND a.id=NEW.account_id AND a.status='active' AND u.is_active AND u.email_verified) OR ({seller_account('NEW.order_id', 'NEW.account_id')}))"
            ),
            suffix="scope_guard",
        )
    )
    result.append(
        trigger(
            "payments_email",
            "INSERT",
            reject(
                "NEW.status<>'queued' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.lease IS NOT NULL OR NEW.lease_until IS NOT NULL OR CHAR_LENGTH(NEW.identity_digest)<>64"
            ),
        )
    )
    result.append(trigger("payments_email", "DELETE", reject()))
    transition = """(OLD.status IN ('queued','retry_due','claimed') AND NEW.status IN ('claimed','dispatching','retry_due','cancelled','exhausted')) OR (OLD.status='dispatching' AND NEW.status IN ('captured','smtp_accepted','retry_due','delivery_unknown','exhausted'))"""
    result.append(
        trigger(
            "payments_email",
            "UPDATE",
            reject(
                f"NOT ({same('id order_id account_id generation slot identity_digest created_at')}) OR NEW.version<>OLD.version+1 OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR NOT ({transition})"
            ),
        )
    )
    result.append(
        trigger(
            "payments_reminder",
            "INSERT",
            reject(
                f"NEW.slot<>(CASE WHEN (SELECT reminder_hours FROM orders_orderpolicy WHERE id=1)=0 THEN 0 ELSE (TIMESTAMPDIFF(SECOND,{due('NEW.order_id')},UTC_TIMESTAMP(6)) DIV ((SELECT reminder_hours FROM orders_orderpolicy WHERE id=1)*3600)) END) OR NEW.generation<>{generation('NEW.order_id')} OR NOT ({overdue('NEW.order_id', 'NEW.generation')}) OR NOT EXISTS(SELECT 1 FROM payments_event e WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.action='overdue_reminder')"
            ),
        )
    )
    result.append(trigger("payments_sweepcursor", "DELETE", reject()))
    return result
