"""Immutable native physical/financial publication; no writable bypass flag."""

from apps.runtime.mariadb.ddl import trigger, reject, retained, same
from apps.payments.mariadb_guards import accepted, confirmed as goods_confirmed, independent as goods_independent


def permission(user, code):
    return f"""EXISTS(SELECT 1 FROM accounts_user u WHERE u.id={user} AND u.is_active AND u.email_verified AND u.is_staff AND (u.is_superuser OR EXISTS(SELECT 1 FROM accounts_account a WHERE a.user_id=u.id AND a.context='staff' AND a.status='active') AND EXISTS(SELECT 1 FROM accounts_user_groups ug JOIN auth_group_permissions gp ON gp.group_id=ug.group_id JOIN auth_permission p ON p.id=gp.permission_id JOIN django_content_type ct ON ct.id=p.content_type_id WHERE ug.user_id=u.id AND ct.app_label='fulfilment' AND p.codename={code})))"""


def seller(order, account, bundle):
    return f"""EXISTS(SELECT 1 FROM orders_sellerorder o JOIN organizations_businessprofile b ON b.id=o.seller_id JOIN accounts_account a ON a.id={account} JOIN accounts_user u ON u.id=a.user_id WHERE o.id={order} AND a.context='seller' AND a.status='active' AND u.is_active AND u.email_verified AND (b.kind='individual' AND b.account_id=a.id OR b.kind='company' AND EXISTS(SELECT 1 FROM organizations_membership m WHERE m.company_id=b.id AND m.account_id=a.id AND m.active AND (m.is_owner OR JSON_CONTAINS(m.bundles,'"{bundle}"')))) AND EXISTS(SELECT 1 FROM verification_reviewcase v WHERE v.profile_id=b.id AND v.revision=b.revision AND v.status='approved'))"""


def buyer(order, account):
    return f"EXISTS(SELECT 1 FROM orders_sellerorder o JOIN accounts_account a ON a.id=o.buyer_id JOIN accounts_user u ON u.id=a.user_id WHERE o.id={order} AND a.id={account} AND a.status='active' AND u.is_active AND u.email_verified)"


def independent(order, user):
    # These local aliases must never shadow a caller's outer event/user alias.
    return f"""({goods_independent(order, user)}) AND NOT EXISTS(SELECT 1 FROM fulfilment_claim delivery_claim JOIN fulfilment_event delivery_claim_event ON delivery_claim_event.id=delivery_claim.event_id WHERE delivery_claim.order_id={order} AND delivery_claim_event.actor_id={user}) AND NOT EXISTS(SELECT 1 FROM fulfilment_correction delivery_correction JOIN fulfilment_event delivery_correction_event ON delivery_correction_event.id=delivery_correction.event_id WHERE delivery_correction.order_id={order} AND delivery_correction_event.actor_id={user}) AND NOT EXISTS(SELECT 1 FROM fulfilment_provider delivery_provider JOIN fulfilment_event delivery_provider_event ON delivery_provider_event.id=delivery_provider.event_id LEFT JOIN organizations_businessprofile delivery_business ON delivery_business.id=delivery_provider.business_id LEFT JOIN accounts_account delivery_owner ON delivery_owner.id=delivery_business.account_id WHERE delivery_provider.order_id={order} AND (delivery_provider_event.actor_id={user} OR delivery_owner.user_id={user} OR EXISTS(SELECT 1 FROM organizations_membership delivery_membership JOIN accounts_account delivery_member ON delivery_member.id=delivery_membership.account_id WHERE delivery_membership.company_id=delivery_provider.business_id AND delivery_member.user_id={user})))"""


def effective(receipt):
    return f"COALESCE((SELECT c.amount FROM fulfilment_correction c JOIN fulfilment_publication cp ON cp.event_id=c.event_id JOIN fulfilment_reviewcase k ON k.correction_id=c.id JOIN fulfilment_caseevent ce ON ce.case_id=k.id JOIN fulfilment_publication dp ON dp.event_id=ce.event_id WHERE c.receipt_id={receipt}.id AND k.state='approved' AND ce.action='approve' ORDER BY c.target_version DESC LIMIT 1),(SELECT amount FROM fulfilment_claim claim WHERE claim.id={receipt}.claim_id))"


def total(order):
    return f"(SELECT COALESCE(SUM({effective('dr')}),0) FROM fulfilment_receipt dr JOIN fulfilment_publication pub ON pub.event_id=dr.event_id WHERE dr.order_id={order})"


def receipt_version(receipt):
    return f"(1+(SELECT COUNT(*) FROM fulfilment_correction version_correction JOIN fulfilment_publication version_proposal_publication ON version_proposal_publication.event_id=version_correction.event_id JOIN fulfilment_reviewcase version_case ON version_case.correction_id=version_correction.id JOIN fulfilment_caseevent version_decision ON version_decision.case_id=version_case.id JOIN fulfilment_publication version_decision_publication ON version_decision_publication.event_id=version_decision.event_id WHERE version_correction.receipt_id={receipt} AND version_case.state='approved' AND version_decision.action='approve'))"


def open_hold(order, kind=None):
    return (
        f"EXISTS(SELECT 1 FROM fulfilment_blocker b JOIN fulfilment_publication pub ON pub.event_id=b.event_id WHERE b.order_id={order} "
        + (f" AND b.kind='{kind}'" if kind else "")
        + " AND NOT EXISTS(SELECT 1 FROM fulfilment_blockerclosure closed JOIN fulfilment_publication cp ON cp.event_id=closed.event_id WHERE closed.blocker_id=b.id))"
    )


def current_charge(order):
    return f"(SELECT c.id FROM fulfilment_chargeproposal c JOIN fulfilment_publication pub ON pub.event_id=c.event_id JOIN fulfilment_chargedecision d ON d.proposal_id=c.id JOIN fulfilment_publication dp ON dp.event_id=d.event_id JOIN fulfilment_event e ON e.id=d.event_id WHERE c.order_id={order} AND d.action='approved' ORDER BY e.version DESC LIMIT 1)"


def eligible(order):
    return f"""EXISTS(SELECT 1 FROM orders_sellerorder o JOIN fulfilment_shipment s ON s.order_id=o.id JOIN fulfilment_publication sp ON sp.event_id=s.event_id JOIN fulfilment_delivery d ON d.shipment_id=s.id JOIN fulfilment_publication dp ON dp.event_id=d.event_id JOIN fulfilment_chargeproposal c ON c.id={current_charge(order)} WHERE o.id={order} AND {goods_confirmed(order)}>=o.goods_total AND {total(order)}>=c.amount) AND NOT ({open_hold(order)})"""


def active_bucket(alias):
    return f"""EXISTS(SELECT 1 FROM inventory_bucket b JOIN catalogue_variant v ON v.id=b.position_id JOIN catalogue_product p ON p.id=v.product_id JOIN catalogue_sourcerevision sr ON sr.id=p.published_id LEFT JOIN inventory_batch batch ON batch.id=b.batch_id JOIN JSON_TABLE(sr.body,'$.variants[*]' COLUMNS(variant_id CHAR(36) PATH '$.id',enabled BOOLEAN PATH '$.active')) listed WHERE b.id={alias} AND REPLACE(listed.variant_id,'-','')=v.id AND listed.enabled=1 AND (batch.expires_on IS NULL OR batch.expires_on>=DATE(UTC_TIMESTAMP()+INTERVAL 270 MINUTE)))"""


def complete_lines(preparation, order):
    return f"""(SELECT COUNT(*) FROM fulfilment_preparationline l WHERE l.preparation_id={preparation}) BETWEEN 1 AND 100 AND NOT EXISTS(SELECT ol.variant_id FROM orders_orderline ol WHERE ol.order_id={order} GROUP BY ol.variant_id HAVING SUM(ol.quantity)<>COALESCE((SELECT SUM(l.quantity) FROM fulfilment_preparationline l WHERE l.preparation_id={preparation} AND l.variant_id=ol.variant_id),0)) AND NOT EXISTS(SELECT 1 FROM fulfilment_preparationline l JOIN inventory_bucket b ON b.id=l.bucket_id WHERE l.preparation_id={preparation} AND (b.position_id<>l.variant_id OR NOT EXISTS(SELECT 1 FROM orders_orderline ol WHERE ol.order_id={order} AND ol.variant_id=l.variant_id)))"""


def case_code(alias):
    return f"CASE {alias}.kind WHEN 'charge' THEN 'finalize_delivery_charge' WHEN 'payment' THEN 'confirm_delivery_payment' WHEN 'correction' THEN 'correct_delivery_payment' WHEN 'blocker' THEN 'manage_delivery_holds' ELSE 'manage_logistics' END"


def event_source(event, order, actions):
    choices = ",".join("'" + x + "'" for x in actions)
    return f"EXISTS(SELECT 1 FROM fulfilment_event e JOIN fulfilment_state s ON s.order_id=e.order_id WHERE e.id={event} AND e.order_id={order} AND e.action IN ({choices}) AND e.version=s.version AND NOT EXISTS(SELECT 1 FROM fulfilment_publication pub WHERE pub.event_id=e.id))"


def statements():
    sql = []
    for table in [
        "event",
        "publication",
        "command",
        "provider",
        "arrangement",
        "recipient",
        "preparation",
        "preparationline",
        "partialpermission",
        "chargeproposal",
        "chargedecision",
        "shipment",
        "tracking",
        "delivery",
        "claim",
        "claimdecision",
        "receipt",
        "correction",
        "blocker",
        "blockerclosure",
        "completion",
        "dispatchattempt",
        "caseevent",
        "evidencebinding",
    ]:
        sql += retained("fulfilment_" + table)
    sql += [
        trigger("fulfilment_state", "INSERT", reject(f"NEW.version<>0 OR NOT ({accepted('NEW.order_id')})")),
        trigger("fulfilment_state", "DELETE", reject()),
        trigger(
            "fulfilment_state",
            "UPDATE",
            reject(
                f"NOT ({same('order_id created_at')}) OR NEW.version<>OLD.version AND (NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM fulfilment_event e WHERE e.order_id=NEW.order_id AND e.version=NEW.version))"
            ),
        ),
    ]
    body = (
        "DECLARE current_version BIGINT; SELECT version INTO current_version FROM fulfilment_state WHERE order_id=NEW.order_id FOR UPDATE; "
        + reject(f"current_version IS NULL OR NEW.version<>current_version+1 OR NOT ({accepted('NEW.order_id')})")
    )
    owner = "EXISTS(SELECT 1 FROM accounts_user u WHERE u.id=NEW.actor_id AND u.is_superuser AND u.is_staff AND u.is_active AND u.email_verified)"
    participant = "EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.account_id AND a.user_id=NEW.actor_id AND a.context=NEW.context AND a.status='active')"
    b = buyer("NEW.order_id", "NEW.account_id")
    log = seller("NEW.order_id", "NEW.account_id", "fulfilment")
    fin = seller("NEW.order_id", "NEW.account_id", "payments_refunds")
    con = seller("NEW.order_id", "NEW.account_id", "orders_negotiation")
    native = f"(NEW.context='owner' AND ({owner}) OR NEW.context='staff' AND ({permission('NEW.actor_id', chr(39) + 'read_fulfilment' + chr(39))}))"
    # Event-level source and role; object/assignment/snapshot checks follow at seal.
    body += reject(
        f"""NOT ((NEW.context='buyer' AND ({participant}) AND ({b}) AND NEW.action IN ('recipient_revised','delivery_claimed','claim_withdrawn','correction_proposed','delivered')) OR (NEW.context='seller' AND ({participant}) AND ((NEW.action IN ('arrangement_proposed','prepared','charge_proposed','dispatched','dispatch_blocked','tracking_recorded','delivered') AND ({log})) OR (NEW.action IN ('delivery_claimed','claim_withdrawn','correction_proposed') AND ({fin})) OR (NEW.action='partial_authorized' AND ({con})))) OR (({native}) AND NEW.action IN ('arrangement_proposed','prepared','charge_proposed','dispatched','dispatch_blocked','tracking_recorded','delivered','operational_hold','case_open','case_assign','case_approve','case_reject','case_clear','case_refer','case_resolve')) OR (NEW.context='system' AND NEW.actor_id IS NULL AND NEW.account_id IS NULL AND NEW.action='completed'))"""
    )
    sql.append(trigger("fulfilment_event", "INSERT", body))
    mapping = {
        "provider": ["arrangement_proposed"],
        "arrangement": ["arrangement_proposed"],
        "recipient": ["recipient_revised"],
        "preparation": ["prepared"],
        "partialpermission": ["partial_authorized"],
        "chargeproposal": ["charge_proposed"],
        "chargedecision": ["case_approve", "case_reject"],
        "shipment": ["dispatched"],
        "tracking": ["tracking_recorded"],
        "delivery": ["delivered"],
        "claim": ["delivery_claimed"],
        "claimdecision": ["claim_withdrawn", "case_approve", "case_reject"],
        "receipt": ["case_approve"],
        "correction": ["correction_proposed"],
        "blocker": ["operational_hold"],
        "blockerclosure": ["case_clear"],
        "completion": ["completed"],
        "dispatchattempt": ["dispatch_blocked"],
        "caseevent": [
            "case_open",
            "case_assign",
            "case_approve",
            "case_reject",
            "case_clear",
            "case_refer",
            "case_resolve",
        ],
    }
    for table, actions in mapping.items():
        sql.append(
            trigger(
                "fulfilment_" + table,
                "INSERT",
                reject(f"NOT ({event_source('NEW.event_id', 'NEW.order_id', actions)})"),
                suffix="source_guard",
            )
        )
    no_shipment = "EXISTS(SELECT 1 FROM fulfilment_shipment s WHERE s.order_id=NEW.order_id)"
    sql.append(
        trigger(
            "fulfilment_provider",
            "INSERT",
            reject(
                f"{no_shipment} OR CHAR_LENGTH(TRIM(NEW.name))=0 OR (NEW.business_id IS NOT NULL AND NEW.business_id<>(SELECT seller_id FROM orders_sellerorder WHERE id=NEW.order_id))"
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_arrangement",
            "INSERT",
            reject(
                f"{no_shipment} OR NEW.arranger NOT IN ('seller','rezayi') OR NOT EXISTS(SELECT 1 FROM fulfilment_provider p WHERE p.id=NEW.provider_id AND p.order_id=NEW.order_id AND p.event_id=NEW.event_id) OR NEW.arranger='rezayi' AND EXISTS(SELECT 1 FROM fulfilment_event e WHERE e.id=NEW.event_id AND e.context='seller') OR EXISTS(SELECT 1 FROM fulfilment_receipt r JOIN fulfilment_publication rp ON rp.event_id=r.event_id WHERE r.order_id=NEW.order_id)"
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_recipient",
            "INSERT",
            reject(
                f"{no_shipment} OR NEW.revision<>1+(SELECT COALESCE(MAX(r.revision),0) FROM fulfilment_recipient r WHERE r.order_id=NEW.order_id) OR CHAR_LENGTH(TRIM(NEW.name))=0 OR CHAR_LENGTH(TRIM(NEW.phone))=0 OR CHAR_LENGTH(TRIM(NEW.address))=0 OR CHAR_LENGTH(TRIM(NEW.reason))<3"
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_preparation",
            "INSERT",
            reject(
                f"""{no_shipment} OR NOT EXISTS(SELECT 1 FROM fulfilment_arrangement a JOIN fulfilment_publication ap ON ap.event_id=a.event_id JOIN fulfilment_recipient r ON r.id=NEW.recipient_id JOIN fulfilment_publication rp ON rp.event_id=r.event_id WHERE a.id=NEW.arrangement_id AND a.order_id=NEW.order_id AND r.order_id=NEW.order_id AND r.revision=(SELECT MAX(latest.revision) FROM fulfilment_recipient latest JOIN fulfilment_publication lp ON lp.event_id=latest.event_id WHERE latest.order_id=NEW.order_id) AND NOT EXISTS(SELECT 1 FROM fulfilment_arrangement later JOIN fulfilment_event le ON le.id=later.event_id JOIN fulfilment_event ae ON ae.id=a.event_id JOIN fulfilment_publication lpub ON lpub.event_id=later.event_id WHERE later.order_id=NEW.order_id AND le.version>ae.version)) OR NOT EXISTS(SELECT 1 FROM orders_sellerorder o WHERE o.id=NEW.order_id AND (o.payment_method='cod' AND NEW.allocation_id IS NULL OR o.payment_method='advance' AND EXISTS(SELECT 1 FROM payments_allocationintent intent JOIN inventory_allocation al ON al.id=intent.allocation_id WHERE intent.order_id=o.id AND al.id=NEW.allocation_id AND al.state='held')))"""
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_preparationline",
            "INSERT",
            reject(
                """NOT EXISTS(SELECT 1 FROM fulfilment_preparation p JOIN inventory_bucket b ON b.id=NEW.bucket_id JOIN orders_orderline ol ON ol.order_id=p.order_id AND ol.variant_id=NEW.variant_id WHERE p.id=NEW.preparation_id AND b.position_id=NEW.variant_id AND MOD(NEW.quantity,CAST(JSON_UNQUOTE(JSON_EXTRACT(ol.snapshot,'$.increment')) AS DECIMAL(12,3)))=0 AND NOT EXISTS(SELECT 1 FROM fulfilment_publication pub WHERE pub.event_id=p.event_id)) OR NEW.quantity<=0"""
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_partialpermission",
            "INSERT",
            reject(
                f"{no_shipment} OR NOT EXISTS(SELECT 1 FROM orders_sellerorder o JOIN payments_finance f ON f.order_id=o.id WHERE o.id=NEW.order_id AND o.payment_method='advance' AND NEW.goods_version=f.version AND {goods_confirmed('o.id')}>0 AND {goods_confirmed('o.id')}<o.goods_total)"
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_chargeproposal",
            "INSERT",
            reject(
                f"{no_shipment} OR NEW.amount<0 OR NEW.currency<>(SELECT currency FROM orders_sellerorder WHERE id=NEW.order_id) OR NOT EXISTS(SELECT 1 FROM fulfilment_provider p JOIN fulfilment_publication pub ON pub.event_id=p.event_id WHERE p.id=NEW.provider_id AND p.order_id=NEW.order_id) OR CHAR_LENGTH(TRIM(NEW.reason))<3"
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_claim",
            "INSERT",
            reject(
                f"""NEW.amount<=0 OR NEW.paid_at>UTC_TIMESTAMP(6) OR CHAR_LENGTH(TRIM(NEW.description))=0 OR NOT EXISTS(SELECT 1 FROM fulfilment_chargeproposal c JOIN fulfilment_chargedecision d ON d.proposal_id=c.id JOIN fulfilment_publication dp ON dp.event_id=d.event_id JOIN orders_sellerorder o ON o.id=c.order_id WHERE c.id=NEW.charge_id AND c.id={current_charge("NEW.order_id")} AND c.order_id=NEW.order_id AND c.amount>0 AND d.action='approved' AND NEW.currency=o.currency)"""
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_claimdecision",
            "INSERT",
            reject(
                """NEW.action NOT IN ('confirmed','rejected','withdrawn') OR NOT EXISTS(SELECT 1 FROM fulfilment_claim c JOIN fulfilment_publication pub ON pub.event_id=c.event_id JOIN fulfilment_event e ON e.id=NEW.event_id JOIN fulfilment_event ce ON ce.id=c.event_id WHERE c.id=NEW.claim_id AND c.order_id=NEW.order_id AND (NEW.action<>'withdrawn' OR e.account_id=ce.account_id))"""
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_receipt",
            "INSERT",
            reject(
                f"NOT EXISTS(SELECT 1 FROM fulfilment_claim c JOIN fulfilment_publication pub ON pub.event_id=c.event_id WHERE c.id=NEW.claim_id AND c.order_id=NEW.order_id) OR {total('NEW.order_id')}+(SELECT amount FROM fulfilment_claim WHERE id=NEW.claim_id)>9999999999999999999999.99"
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_correction",
            "INSERT",
            reject(
                f"""NEW.amount<0 OR NEW.paid_at>UTC_TIMESTAMP(6) OR NEW.target_version<>{receipt_version("NEW.receipt_id")} OR NOT EXISTS(SELECT 1 FROM fulfilment_receipt r JOIN fulfilment_publication pub ON pub.event_id=r.event_id WHERE r.id=NEW.receipt_id AND r.order_id=NEW.order_id) OR EXISTS(SELECT 1 FROM fulfilment_correction c JOIN fulfilment_reviewcase k ON k.correction_id=c.id WHERE c.receipt_id=NEW.receipt_id AND k.state='open') OR CHAR_LENGTH(TRIM(NEW.reason))<3 OR CHAR_LENGTH(TRIM(NEW.description))=0"""
            ),
        )
    )
    for table in ["tracking", "delivery"]:
        sql.append(
            trigger(
                "fulfilment_" + table,
                "INSERT",
                reject(
                    """NEW.occurred_at>UTC_TIMESTAMP(6) OR NOT EXISTS(SELECT 1 FROM fulfilment_shipment s JOIN fulfilment_publication pub ON pub.event_id=s.event_id WHERE s.id=NEW.shipment_id AND s.order_id=NEW.order_id AND NEW.occurred_at>=s.dispatched_at) OR CHAR_LENGTH(TRIM(NEW.reason))<3"""
                ),
            )
        )
    sql.append(
        trigger(
            "fulfilment_blocker",
            "INSERT",
            reject("NEW.kind NOT IN ('cancellation','dispute') OR CHAR_LENGTH(TRIM(NEW.reason))<3"),
        )
    )
    sql.append(
        trigger(
            "fulfilment_blockerclosure",
            "INSERT",
            reject(
                "NEW.disposition NOT IN ('erroneous','withdrawn') OR NOT EXISTS(SELECT 1 FROM fulfilment_blocker b JOIN fulfilment_publication pub ON pub.event_id=b.event_id WHERE b.id=NEW.blocker_id AND b.order_id=NEW.order_id) OR CHAR_LENGTH(TRIM(NEW.reason))<3"
            ),
        )
    )
    # Mutable assignment pointer is always justified by an immutable, versioned action.
    kind_targets = "(NEW.kind='charge' AND NEW.proposal_id IS NOT NULL AND NEW.claim_id IS NULL AND NEW.correction_id IS NULL AND NEW.blocker_id IS NULL) OR (NEW.kind='payment' AND NEW.claim_id IS NOT NULL AND NEW.proposal_id IS NULL AND NEW.correction_id IS NULL AND NEW.blocker_id IS NULL) OR (NEW.kind='correction' AND NEW.correction_id IS NOT NULL AND NEW.proposal_id IS NULL AND NEW.claim_id IS NULL AND NEW.blocker_id IS NULL) OR (NEW.kind='blocker' AND NEW.blocker_id IS NOT NULL AND NEW.proposal_id IS NULL AND NEW.claim_id IS NULL AND NEW.correction_id IS NULL) OR (NEW.kind IN ('logistics','stock','exception') AND NEW.proposal_id IS NULL AND NEW.claim_id IS NULL AND NEW.correction_id IS NULL AND NEW.blocker_id IS NULL)"
    sql.append(
        trigger(
            "fulfilment_reviewcase",
            "INSERT",
            reject(
                f"NEW.version<>0 OR NEW.state<>'open' OR NEW.assigned_to_id IS NOT NULL OR NOT ({kind_targets}) OR NOT ({accepted('NEW.order_id')})"
            ),
        )
    )
    sql.append(trigger("fulfilment_reviewcase", "DELETE", reject()))
    sql.append(
        trigger(
            "fulfilment_reviewcase",
            "UPDATE",
            reject(
                f"""NOT ({same("id key order_id kind proposal_id claim_id correction_id blocker_id created_at")}) OR OLD.state<>'open' OR NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM fulfilment_caseevent e WHERE e.case_id=NEW.id AND e.case_version=NEW.version AND (e.assigned_to_id <=> NEW.assigned_to_id) AND NEW.state=CASE e.action WHEN 'open' THEN 'open' WHEN 'assign' THEN 'open' WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' WHEN 'refer' THEN 'referred' ELSE 'resolved' END)"""
            ),
        )
    )
    required = case_code("k")
    code_read = permission("e.actor_id", "'read_fulfilment'")
    assignment = f"NEW.action='assign' AND ({permission('e.actor_id', chr(39) + 'assign_fulfilment' + chr(39))}) AND ({permission('NEW.assigned_to_id', required)}) AND ({permission('NEW.assigned_to_id', chr(39) + 'read_fulfilment' + chr(39))}) AND ({independent('k.order_id', 'NEW.assigned_to_id')})"
    decision = f"NEW.action NOT IN ('assign','open') AND k.assigned_to_id=e.actor_id AND (NEW.assigned_to_id <=> e.actor_id) AND ({permission('e.actor_id', required)}) AND ({independent('k.order_id', 'e.actor_id')})"
    sql.append(
        trigger(
            "fulfilment_caseevent",
            "INSERT",
            reject(
                f"""NOT EXISTS(SELECT 1 FROM fulfilment_reviewcase k JOIN fulfilment_event e ON e.id=NEW.event_id WHERE k.id=NEW.case_id AND k.order_id=NEW.order_id AND k.state='open' AND NEW.case_version=k.version+1 AND e.action=CONCAT('case_',NEW.action) AND ({code_read}) AND (({assignment}) OR ({decision}) OR NEW.action='open' AND ({permission("e.actor_id", chr(39) + "assign_fulfilment" + chr(39))}))) OR CHAR_LENGTH(TRIM(NEW.reason))<3"""
            ),
        )
    )
    # A successful shipment is associated with exactly the complete movement set.
    stock = """EXISTS(SELECT 1 FROM fulfilment_preparation p JOIN orders_sellerorder o ON o.id=p.order_id JOIN inventory_operation op ON op.id=NEW.operation_id JOIN fulfilment_event e ON e.id=NEW.event_id WHERE p.id=NEW.preparation_id AND p.order_id=NEW.order_id AND op.seller_id=o.seller_id AND op.actor_id=e.actor_id AND (op.account_id <=> e.account_id) AND op.context=e.context AND (o.payment_method='advance' AND op.action='consume' AND p.allocation_id IS NOT NULL AND EXISTS(SELECT 1 FROM inventory_allocation al JOIN payments_allocationintent intent ON intent.allocation_id=al.id WHERE al.id=p.allocation_id AND al.state='consumed' AND intent.order_id=o.id) OR o.payment_method='cod' AND op.action='cod' AND p.allocation_id IS NULL) AND NOT EXISTS(SELECT 1 FROM fulfilment_preparationline l WHERE l.preparation_id=p.id AND NOT EXISTS(SELECT 1 FROM inventory_movement mv WHERE mv.operation_id=op.id AND mv.bucket_id=l.bucket_id AND mv.physical_delta=-l.quantity AND mv.held_delta=IF(o.payment_method='advance',-l.quantity,0))) AND NOT EXISTS(SELECT 1 FROM inventory_movement mv WHERE mv.operation_id=op.id AND NOT EXISTS(SELECT 1 FROM fulfilment_preparationline l WHERE l.preparation_id=p.id AND l.bucket_id=mv.bucket_id AND mv.physical_delta=-l.quantity AND mv.held_delta=IF(o.payment_method='advance',-l.quantity,0))))"""
    sql.append(
        trigger(
            "fulfilment_shipment",
            "INSERT",
            reject(
                f"""NOT ({stock}) OR NOT ({complete_lines("NEW.preparation_id", "NEW.order_id")}) OR ({open_hold("NEW.order_id", "cancellation")}) OR NEW.dispatched_at>UTC_TIMESTAMP(6) OR NEW.charge_id<>{current_charge("NEW.order_id")} OR NEW.goods_version<>(SELECT version FROM payments_finance WHERE order_id=NEW.order_id) OR NEW.goods_confirmed<>{goods_confirmed("NEW.order_id")} OR NOT EXISTS(SELECT 1 FROM orders_sellerorder o WHERE o.id=NEW.order_id AND (o.payment_method='cod' OR NEW.goods_confirmed>0 AND (NEW.goods_confirmed>=o.goods_total OR EXISTS(SELECT 1 FROM fulfilment_partialpermission p JOIN fulfilment_publication pub ON pub.event_id=p.event_id WHERE p.order_id=o.id AND p.goods_version=NEW.goods_version)))) OR EXISTS(SELECT 1 FROM fulfilment_preparationline l WHERE l.preparation_id=NEW.preparation_id AND NOT ({active_bucket("l.bucket_id")}))"""
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_completion",
            "INSERT",
            reject(
                f"NOT ({eligible('NEW.order_id')}) OR NEW.goods_version<>(SELECT version FROM payments_finance WHERE order_id=NEW.order_id) OR NEW.delivery_version<>(SELECT version-1 FROM fulfilment_state WHERE order_id=NEW.order_id) OR NOT EXISTS(SELECT 1 FROM fulfilment_delivery d JOIN fulfilment_publication pub ON pub.event_id=d.event_id WHERE d.id=NEW.delivery_id AND d.order_id=NEW.order_id)"
            ),
        )
    )
    # Private evidence is bound once to the exact author/order/purpose, retained thereafter.
    sql.append(
        trigger(
            "fulfilment_evidence",
            "INSERT",
            reject(
                "NEW.storage_alias<>'private_local' OR NEW.key<>CONCAT('fulfilment/',NEW.id,'.jpg') OR NEW.size>5242880 OR NEW.width>6000 OR NEW.height>6000 OR NEW.width*NEW.height>20000000 OR NEW.sha256 NOT REGEXP BINARY '^[0-9a-f]{64}$' OR NEW.purpose NOT IN ('claim','correction')"
            ),
        )
    )
    sql.append(trigger("fulfilment_evidence", "UPDATE", reject()))
    sql.append(
        trigger(
            "fulfilment_evidence",
            "DELETE",
            reject(
                "OLD.expires_at>UTC_TIMESTAMP(6) OR EXISTS(SELECT 1 FROM fulfilment_evidencebinding b WHERE b.evidence_id=OLD.id)"
            ),
        )
    )
    binding = """EXISTS(SELECT 1 FROM fulfilment_evidence image JOIN fulfilment_claim c ON c.id=NEW.claim_id JOIN fulfilment_event e ON e.id=c.event_id WHERE image.id=NEW.evidence_id AND image.order_id=c.order_id AND image.creator_id=e.account_id AND image.purpose='claim' AND image.expires_at>UTC_TIMESTAMP(6) AND NOT EXISTS(SELECT 1 FROM fulfilment_publication pub WHERE pub.event_id=c.event_id)) OR EXISTS(SELECT 1 FROM fulfilment_evidence image JOIN fulfilment_correction c ON c.id=NEW.correction_id JOIN fulfilment_event e ON e.id=c.event_id WHERE image.id=NEW.evidence_id AND image.order_id=c.order_id AND image.creator_id=e.account_id AND image.purpose='correction' AND image.expires_at>UTC_TIMESTAMP(6) AND NOT EXISTS(SELECT 1 FROM fulfilment_publication pub WHERE pub.event_id=c.event_id))"""
    sql.append(
        trigger(
            "fulfilment_evidencebinding",
            "INSERT",
            reject(
                f"NOT ({binding}) OR NEW.claim_id IS NOT NULL AND (SELECT COUNT(*) FROM fulfilment_evidencebinding b WHERE b.claim_id=NEW.claim_id)>=3 OR NEW.correction_id IS NOT NULL AND (SELECT COUNT(*) FROM fulfilment_evidencebinding b WHERE b.correction_id=NEW.correction_id)>=3"
            ),
        )
    )
    return (
        sql
        + publication_statements()
        + command_statements()
        + stock_witness_statements()
        + additional_boundary_statements()
    )


def publication_statements():
    table_actions = {
        "arrangement_proposed": "arrangement",
        "recipient_revised": "recipient",
        "prepared": "preparation",
        "partial_authorized": "partialpermission",
        "charge_proposed": "chargeproposal",
        "delivery_claimed": "claim",
        "claim_withdrawn": "claimdecision",
        "correction_proposed": "correction",
        "dispatched": "shipment",
        "dispatch_blocked": "dispatchattempt",
        "tracking_recorded": "tracking",
        "delivered": "delivery",
        "operational_hold": "blocker",
        "completed": "completion",
        "case_open": "caseevent",
        "case_assign": "caseevent",
        "case_approve": "caseevent",
        "case_reject": "caseevent",
        "case_clear": "caseevent",
        "case_refer": "caseevent",
        "case_resolve": "caseevent",
    }
    choices = " OR ".join(
        f"e.action='{action}' AND EXISTS(SELECT 1 FROM fulfilment_{table} f WHERE f.event_id=e.id AND f.order_id=e.order_id)"
        for action, table in table_actions.items()
    )
    invalid = f"NOT EXISTS(SELECT 1 FROM fulfilment_event e JOIN fulfilment_state s ON s.order_id=e.order_id WHERE e.id=NEW.event_id AND e.version=s.version AND ({choices}))"
    invalid += f" OR EXISTS(SELECT 1 FROM fulfilment_preparation p WHERE p.event_id=NEW.event_id AND (NOT ({complete_lines('p.id', 'p.order_id')}) OR p.allocation_id IS NOT NULL AND (EXISTS(SELECT 1 FROM inventory_allocationline a WHERE a.allocation_id=p.allocation_id AND NOT EXISTS(SELECT 1 FROM fulfilment_preparationline l WHERE l.preparation_id=p.id AND l.bucket_id=a.bucket_id AND l.quantity=a.quantity)) OR EXISTS(SELECT 1 FROM fulfilment_preparationline l WHERE l.preparation_id=p.id AND NOT EXISTS(SELECT 1 FROM inventory_allocationline a WHERE a.allocation_id=p.allocation_id AND a.bucket_id=l.bucket_id AND a.quantity=l.quantity)))))"
    # Exact native decisions publish their typed fact, with one current target and independent actor.
    case_fact = """(k.kind='charge' AND EXISTS(SELECT 1 FROM fulfilment_chargedecision d WHERE d.event_id=ce.event_id AND d.proposal_id=k.proposal_id AND d.order_id=k.order_id AND d.action=IF(ce.action='approve','approved','rejected'))) OR (k.kind='payment' AND EXISTS(SELECT 1 FROM fulfilment_claimdecision d WHERE d.event_id=ce.event_id AND d.claim_id=k.claim_id AND d.action=IF(ce.action='approve','confirmed','rejected') AND (ce.action='reject' OR EXISTS(SELECT 1 FROM fulfilment_receipt r WHERE r.event_id=ce.event_id AND r.claim_id=k.claim_id AND r.order_id=k.order_id)))) OR (k.kind='correction' AND EXISTS(SELECT 1 FROM fulfilment_correction c WHERE c.id=k.correction_id AND c.order_id=k.order_id))"""
    invalid += f" OR EXISTS(SELECT 1 FROM fulfilment_caseevent ce JOIN fulfilment_reviewcase k ON k.id=ce.case_id WHERE ce.event_id=NEW.event_id AND ce.action IN ('approve','reject') AND NOT ({case_fact}))"
    invalid += " OR EXISTS(SELECT 1 FROM fulfilment_caseevent ce JOIN fulfilment_reviewcase k ON k.id=ce.case_id JOIN fulfilment_event e ON e.id=ce.event_id WHERE ce.event_id=NEW.event_id AND ce.action='clear' AND (k.kind<>'blocker' OR NOT EXISTS(SELECT 1 FROM fulfilment_blockerclosure c JOIN fulfilment_blocker b ON b.id=c.blocker_id JOIN fulfilment_event be ON be.id=b.event_id WHERE c.event_id=ce.event_id AND c.blocker_id=k.blocker_id AND be.actor_id<>e.actor_id)))"
    invalid += f" OR EXISTS(SELECT 1 FROM fulfilment_caseevent ce JOIN fulfilment_reviewcase k ON k.id=ce.case_id JOIN fulfilment_correction c ON c.id=k.correction_id WHERE ce.event_id=NEW.event_id AND ce.action='approve' AND c.target_version<>{receipt_version('c.receipt_id')})"
    invalid += " OR EXISTS(SELECT 1 FROM fulfilment_chargedecision d JOIN fulfilment_chargeproposal c ON c.id=d.proposal_id WHERE d.event_id=NEW.event_id AND d.action='approved' AND (EXISTS(SELECT 1 FROM fulfilment_shipment s WHERE s.order_id=c.order_id) OR EXISTS(SELECT 1 FROM fulfilment_receipt r JOIN fulfilment_publication rp ON rp.event_id=r.event_id JOIN fulfilment_claim cl ON cl.id=r.claim_id JOIN fulfilment_chargeproposal prior_charge ON prior_charge.id=cl.charge_id WHERE r.order_id=c.order_id AND prior_charge.provider_id<>c.provider_id)))"
    invalid += f" OR EXISTS(SELECT 1 FROM fulfilment_receipt r JOIN fulfilment_claim cl ON cl.id=r.claim_id JOIN fulfilment_chargeproposal c ON c.id=cl.charge_id WHERE r.event_id=NEW.event_id AND NOT EXISTS(SELECT 1 FROM fulfilment_chargeproposal current WHERE current.id={current_charge('r.order_id')} AND current.amount>0 AND current.provider_id=c.provider_id))"
    return [trigger("fulfilment_publication", "INSERT", reject(invalid))]


def command_statements():
    user = "EXISTS(SELECT 1 FROM accounts_user u WHERE u.id=NEW.actor_id AND u.is_active AND u.email_verified AND (NEW.context IN ('buyer','seller','staff') AND EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.account_id AND a.user_id=u.id AND a.context=NEW.context AND a.status='active') OR NEW.context='owner' AND u.is_superuser AND u.is_staff AND NEW.account_id IS NULL))"
    source = """(NEW.action='absence_fence' AND NEW.event_id IS NULL AND NEW.digest=REPEAT('0',64) AND JSON_LENGTH(NEW.result)=1 AND JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.settled'))='true') OR (NEW.action='upload' AND NEW.event_id IS NULL AND EXISTS(SELECT 1 FROM fulfilment_evidence image WHERE image.id=REPLACE(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.id')),'-','') AND image.creator_id=NEW.account_id AND image.order_id=NEW.order_id)) OR (NEW.action NOT IN ('upload','absence_fence') AND EXISTS(SELECT 1 FROM fulfilment_event e JOIN fulfilment_publication pub ON pub.event_id=e.id WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.actor_id=NEW.actor_id AND (e.account_id <=> NEW.account_id) AND e.context=NEW.context AND CAST(JSON_UNQUOTE(JSON_EXTRACT(NEW.result,'$.version')) AS UNSIGNED)=e.version))"""
    return [
        trigger(
            "fulfilment_command",
            "INSERT",
            reject(f"NEW.digest NOT REGEXP BINARY '^[0-9a-f]{{64}}$' OR NOT ({user}) OR NOT ({source})"),
        )
    ]


def stock_witness_statements():
    # Numeric bucket/pending fields avoid MariaDB's CHAR-FK generated-slot limitation.
    slot = "ALTER TABLE `inventory_stocktransition` ADD COLUMN `pending_bucket` BIGINT GENERATED ALWAYS AS (CASE WHEN pending THEN bucket_id ELSE NULL END) PERSISTENT, ADD UNIQUE KEY `inventory_pending_transition` (`pending_bucket`)"
    before = """NOT NEW.pending OR NEW.movement_id IS NOT NULL OR NEW.connection_id<>CONNECTION_ID() OR (NEW.before_physical=NEW.after_physical AND NEW.before_held=NEW.after_held) OR NOT EXISTS(SELECT 1 FROM inventory_bucket b WHERE b.id=NEW.bucket_id AND b.physical=NEW.before_physical AND b.held=NEW.before_held)"""
    create = """IF NOT (OLD.physical <=> NEW.physical) OR NOT (OLD.held <=> NEW.held) THEN INSERT INTO inventory_stocktransition(id,bucket_id,movement_id,pending,before_physical,before_held,after_physical,after_held,connection_id,created_at) VALUES(REPLACE(UUID(),'-',''),OLD.id,NULL,1,OLD.physical,OLD.held,NEW.physical,NEW.held,CONNECTION_ID(),UTC_TIMESTAMP(6)); END IF;"""
    witness = """EXISTS(SELECT 1 FROM inventory_stocktransition w JOIN inventory_bucket b ON b.id=w.bucket_id WHERE w.bucket_id=NEW.bucket_id AND w.pending AND w.movement_id IS NULL AND w.connection_id=CONNECTION_ID() AND w.after_physical=b.physical AND w.after_held=b.held AND w.after_physical=NEW.physical_after AND w.after_held=NEW.held_after AND NEW.physical_delta=w.after_physical-w.before_physical AND NEW.held_delta=w.after_held-w.before_held)"""
    consume = """UPDATE inventory_stocktransition SET movement_id=NEW.id,pending=0 WHERE bucket_id=NEW.bucket_id AND pending AND movement_id IS NULL AND connection_id=CONNECTION_ID() AND after_physical=NEW.physical_after AND after_held=NEW.held_after AND NEW.physical_delta=after_physical-before_physical AND NEW.held_delta=after_held-before_held; IF ROW_COUNT()<>1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Stock movement needs one actual bucket transition'; END IF;"""
    immutable = same("id bucket_id before_physical before_held after_physical after_held connection_id created_at")
    update = f"NOT ({immutable}) OR NOT OLD.pending OR OLD.movement_id IS NOT NULL OR NEW.pending OR NEW.movement_id IS NULL OR NOT EXISTS(SELECT 1 FROM inventory_movement m WHERE m.id=NEW.movement_id AND m.bucket_id=NEW.bucket_id AND m.physical_after=NEW.after_physical AND m.held_after=NEW.after_held AND m.physical_delta=NEW.after_physical-NEW.before_physical AND m.held_delta=NEW.after_held-NEW.before_held)"
    return [
        slot,
        trigger("inventory_stocktransition", "INSERT", reject(before)),
        trigger("inventory_stocktransition", "UPDATE", reject(update)),
        trigger("inventory_stocktransition", "DELETE", reject()),
        trigger(
            "inventory_bucket",
            "UPDATE",
            reject(f"NOT ({same('id position_id batch_id')})") + create,
            suffix="transition_guard",
        ),
        trigger("inventory_movement", "INSERT", reject(f"NOT ({witness})"), suffix="transition_guard"),
        trigger("inventory_movement", "INSERT", consume, suffix="transition_publish", timing="AFTER"),
    ]


def additional_boundary_statements():
    sql = []
    physical = [
        "arrangement_proposed",
        "prepared",
        "charge_proposed",
        "dispatched",
        "dispatch_blocked",
        "tracking_recorded",
    ]
    names = ",".join("'" + x + "'" for x in physical)
    admin = "NEW.context IN ('owner','staff')"
    logistics = permission("NEW.actor_id", "'manage_logistics'")
    assigned = "NEW.context='owner' OR EXISTS(SELECT 1 FROM fulfilment_reviewcase k WHERE k.order_id=NEW.order_id AND k.kind='logistics' AND k.assigned_to_id=NEW.actor_id)"
    invalid = f"({admin}) AND ((NEW.action IN ({names}) AND (NOT ({logistics}) OR NOT ({assigned}))) OR (NEW.action='delivered' AND (NOT ({permission('NEW.actor_id', chr(39) + 'confirm_delivery' + chr(39))}) OR NOT ({assigned}))) OR (NEW.action='operational_hold' AND (NOT ({permission('NEW.actor_id', chr(39) + 'manage_delivery_holds' + chr(39))}) OR NEW.context<>'owner' AND NOT EXISTS(SELECT 1 FROM fulfilment_reviewcase k WHERE k.order_id=NEW.order_id AND k.assigned_to_id=NEW.actor_id))))"
    sql.append(trigger("fulfilment_event", "INSERT", reject(invalid), suffix="role_guard"))
    sql.append(
        trigger(
            "fulfilment_chargedecision",
            "INSERT",
            reject(
                "NOT EXISTS(SELECT 1 FROM fulfilment_chargeproposal c WHERE c.id=NEW.proposal_id AND c.order_id=NEW.order_id) OR NEW.action NOT IN ('approved','rejected') OR CHAR_LENGTH(TRIM(NEW.reason))<3"
            ),
        )
    )
    sql.append(
        trigger(
            "fulfilment_reviewcase",
            "INSERT",
            reject(
                """(NEW.proposal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fulfilment_chargeproposal c WHERE c.id=NEW.proposal_id AND c.order_id=NEW.order_id)) OR (NEW.claim_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fulfilment_claim c WHERE c.id=NEW.claim_id AND c.order_id=NEW.order_id)) OR (NEW.correction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fulfilment_correction c WHERE c.id=NEW.correction_id AND c.order_id=NEW.order_id)) OR (NEW.blocker_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fulfilment_blocker b WHERE b.id=NEW.blocker_id AND b.order_id=NEW.order_id))"""
            ),
            suffix="target_guard",
        )
    )
    current = """EXISTS(SELECT 1 FROM fulfilment_preparation p JOIN fulfilment_recipient r ON r.id=p.recipient_id JOIN fulfilment_arrangement a ON a.id=p.arrangement_id JOIN fulfilment_chargeproposal c ON c.id=NEW.charge_id WHERE p.id=NEW.preparation_id AND c.provider_id=a.provider_id AND NOT EXISTS(SELECT 1 FROM fulfilment_recipient later JOIN fulfilment_publication pub ON pub.event_id=later.event_id WHERE later.order_id=NEW.order_id AND later.revision>r.revision) AND NOT EXISTS(SELECT 1 FROM fulfilment_arrangement later JOIN fulfilment_event le ON le.id=later.event_id JOIN fulfilment_event ae ON ae.id=a.event_id JOIN fulfilment_publication pub ON pub.event_id=later.event_id WHERE later.order_id=NEW.order_id AND le.version>ae.version))"""
    journal = "EXISTS(SELECT 1 FROM inventory_movement mv WHERE mv.operation_id=NEW.operation_id AND NOT EXISTS(SELECT 1 FROM inventory_stocktransition w WHERE w.movement_id=mv.id AND NOT w.pending AND w.after_physical-w.before_physical=mv.physical_delta AND w.after_held-w.before_held=mv.held_delta))"
    sql.append(
        trigger("fulfilment_shipment", "INSERT", reject(f"NOT ({current}) OR ({journal})"), suffix="snapshot_guard")
    )
    sql.append(
        trigger(
            "inventory_allocationline",
            "INSERT",
            reject(
                "EXISTS(SELECT 1 FROM payments_allocationintent i WHERE i.allocation_id=NEW.allocation_id) OR EXISTS(SELECT 1 FROM fulfilment_preparation p JOIN fulfilment_publication pub ON pub.event_id=p.event_id WHERE p.allocation_id=NEW.allocation_id)"
            ),
            suffix="sealed_guard",
        )
    )
    sql.append(
        trigger(
            "fulfilment_publication",
            "INSERT",
            reject(
                f"EXISTS(SELECT 1 FROM fulfilment_caseevent ce JOIN fulfilment_reviewcase k ON k.id=ce.case_id JOIN fulfilment_correction c ON c.id=k.correction_id JOIN fulfilment_receipt r ON r.id=c.receipt_id WHERE ce.event_id=NEW.event_id AND ce.action='approve' AND {total('c.order_id')}-{effective('r')}+c.amount>9999999999999999999999.99)"
            ),
            suffix="money_guard",
        )
    )
    sql.append(
        trigger(
            "fulfilment_publication",
            "INSERT",
            reject(
                """EXISTS(SELECT 1 FROM fulfilment_chargedecision d JOIN fulfilment_chargeproposal c ON c.id=d.proposal_id WHERE d.event_id=NEW.event_id AND d.action='approved' AND NOT EXISTS(SELECT 1 FROM fulfilment_arrangement a JOIN fulfilment_publication pub ON pub.event_id=a.event_id JOIN fulfilment_event ae ON ae.id=a.event_id WHERE a.order_id=c.order_id AND a.provider_id=c.provider_id AND NOT EXISTS(SELECT 1 FROM fulfilment_arrangement later JOIN fulfilment_publication lp ON lp.event_id=later.event_id JOIN fulfilment_event le ON le.id=later.event_id WHERE later.order_id=c.order_id AND le.version>ae.version)))"""
            ),
            suffix="payee_guard",
        )
    )
    return sql


def _derive(statement, old, new, count=1):
    """Exact-substring guard extension; fail loudly on generator drift."""
    if statement.count(old) != count:
        raise RuntimeError("The retained guard body no longer contains its reviewed clause.")
    return statement.replace(old, new)


def _aftercare_permission(user, code):
    return f"""EXISTS(SELECT 1 FROM accounts_user u WHERE u.id={user} AND u.is_active AND u.email_verified AND u.is_staff AND (u.is_superuser OR EXISTS(SELECT 1 FROM accounts_user_groups ug JOIN auth_group_permissions gp ON gp.group_id=ug.group_id JOIN auth_permission p ON p.id=gp.permission_id JOIN django_content_type ct ON ct.id=p.content_type_id WHERE ug.user_id=u.id AND ct.app_label='orders' AND p.codename={code})))"""


def _provider_receipts(provider, order):
    return f"""(SELECT COALESCE(SUM({effective('r')}),0) FROM fulfilment_receipt r JOIN fulfilment_publication rp ON rp.event_id=r.event_id WHERE r.order_id={order} AND r.claim_id IN (SELECT c.id FROM fulfilment_claim c WHERE c.charge_id IN (SELECT cp.id FROM fulfilment_chargeproposal cp WHERE cp.provider_id={provider} AND cp.order_id={order})))"""


def _confirmed_refunds(order, provider=None):
    return (
        "(SELECT COALESCE(SUM(dr.amount),0) FROM fulfilment_deliveryrefund dr JOIN fulfilment_deliveryrefunddecision dd "
        f"ON dd.refund_id=dr.id WHERE dr.order_id={order} AND dd.action='confirmed'"
        + (f" AND dr.provider_id={provider}" if provider is not None else "")
        + ")"
    )


def _effective_quantity(line):
    return f"""COALESCE((SELECT amended_line.proposed_quantity FROM orders_amendmentline amended_line JOIN orders_amendment amendment ON amendment.id=amended_line.amendment_id JOIN orders_amendmentdecision decision ON decision.amendment_id=amendment.id JOIN orders_aftercareevent decision_event ON decision_event.id=decision.event_id WHERE amended_line.line_id={line}.id AND amendment.order_id={line}.order_id AND amendment.state='approved' AND decision.action='approved' ORDER BY decision_event.version DESC LIMIT 1),{line}.quantity)"""


def _accepted_total(order):
    return f"""(CASE WHEN EXISTS(SELECT 1 FROM orders_cancellationrequest cancelled JOIN orders_cancellationdecision cancellation_decision ON cancellation_decision.request_id=cancelled.id WHERE cancelled.order_id={order} AND cancelled.state='approved' AND cancellation_decision.action='approved') THEN 0 ELSE COALESCE((SELECT amendment.after_total FROM orders_amendment amendment JOIN orders_amendmentdecision decision ON decision.amendment_id=amendment.id JOIN orders_aftercareevent decision_event ON decision_event.id=decision.event_id WHERE amendment.order_id={order} AND amendment.state='approved' AND decision.action='approved' ORDER BY decision_event.version DESC LIMIT 1),(SELECT original.goods_total FROM orders_sellerorder original WHERE original.id={order})) END)"""


def _net_goods(order):
    # Receipts/snapshot figures remain gross; only policy deducts confirmed refunds.
    refunded = f"""(SELECT COALESCE(SUM(report.amount),0) FROM payments_refundreport report JOIN payments_refunddue due ON due.id=report.due_id JOIN payments_refunddecision decision ON decision.report_id=report.id WHERE due.order_id={order} AND decision.action='confirmed')"""
    return f"({goods_confirmed(order)}-{refunded})"


def _cancellation_blocks(order):
    return f"EXISTS(SELECT 1 FROM orders_cancellationrequest cancellation WHERE cancellation.order_id={order} AND cancellation.state IN ('pending','approved'))"


def _complete_lines_v4(preparation, order):
    return _derive(complete_lines(preparation, order), "SUM(ol.quantity)", f"SUM({_effective_quantity('ol')})")


def _held_quantity(line):
    # Reduction has no publication column: the immutable reduce operation and
    # its sealed, actual bucket movement are the native stock witness.
    witnessed = """EXISTS(SELECT 1 FROM inventory_operation reduction_operation JOIN inventory_allocation allocation ON allocation.id=reduction.allocation_id JOIN inventory_operation original_operation ON original_operation.id=allocation.operation_id JOIN inventory_movement movement ON movement.operation_id=reduction_operation.id JOIN inventory_stocktransition witness ON witness.movement_id=movement.id WHERE reduction_operation.id=reduction.operation_id AND reduction_operation.action='reduce' AND reduction_operation.seller_id=original_operation.seller_id AND movement.bucket_id=reduction.bucket_id AND movement.physical_delta=0 AND movement.held_delta=-reduction.quantity AND witness.bucket_id=movement.bucket_id AND NOT witness.pending AND witness.after_physical=movement.physical_after AND witness.after_held=movement.held_after AND witness.after_physical-witness.before_physical=movement.physical_delta AND witness.after_held-witness.before_held=movement.held_delta)"""
    return f"({line}.quantity-(SELECT COALESCE(SUM(reduction.quantity),0) FROM inventory_allocationreduction reduction WHERE reduction.allocation_id={line}.allocation_id AND reduction.bucket_id={line}.bucket_id AND ({witnessed})))"


def _held_lines_invalid(preparation):
    remaining = _held_quantity("a")
    return f"""EXISTS(SELECT 1 FROM inventory_allocationline a WHERE a.allocation_id={preparation}.allocation_id AND ({remaining}<0 OR {remaining}>0 AND NOT EXISTS(SELECT 1 FROM fulfilment_preparationline l WHERE l.preparation_id={preparation}.id AND l.bucket_id=a.bucket_id AND l.quantity={remaining}))) OR EXISTS(SELECT 1 FROM fulfilment_preparationline l WHERE l.preparation_id={preparation}.id AND NOT EXISTS(SELECT 1 FROM inventory_allocationline a WHERE a.allocation_id={preparation}.allocation_id AND a.bucket_id=l.bucket_id AND {remaining}>0 AND {remaining}=l.quantity))"""


def _eligible_v4(order):
    eligible_now = _derive(
        eligible(order),
        f"{goods_confirmed(order)}>=o.goods_total AND {total(order)}>=c.amount",
        f"{_net_goods(order)}>={_accepted_total(order)} AND ({total(order)}-{_confirmed_refunds(order)})>=c.amount",
    )
    return f"{eligible_now} AND NOT ({_cancellation_blocks(order)})"


def refund_statements():
    """Phase 14 refund/hold guards. The event, blocker, closure, publication,
    case and evidence boundaries gain their refund/aftercare clauses; v1-v3
    statement bytes are untouched. New fact rows are append-only."""
    source = {s.split("`", 2)[1]: s for s in statements() if s.startswith("CREATE TRIGGER")}
    participant = "EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.account_id AND a.user_id=NEW.actor_id AND a.context=NEW.context AND a.status='active')"
    event = _derive(
        source["fulfilment_event_insert_guard"],
        "AND NEW.action IN ('recipient_revised','delivery_claimed','claim_withdrawn','correction_proposed','delivered')",
        "AND NEW.action IN ('recipient_revised','delivery_claimed','claim_withdrawn','correction_proposed','delivered','cancellation_hold')",
    )
    event = _derive(
        event,
        "('arrangement_proposed','prepared','charge_proposed','dispatched','dispatch_blocked','tracking_recorded','delivered')",
        "('arrangement_proposed','prepared','charge_proposed','dispatched','dispatch_blocked','tracking_recorded','delivered','delivery_refund_reported')",
    )
    event = _derive(
        event,
        "NEW.action IN ('delivery_claimed','claim_withdrawn','correction_proposed')",
        "NEW.action IN ('delivery_claimed','claim_withdrawn','correction_proposed','delivery_refund_reported')",
    )
    event = _derive(
        event,
        "'case_clear','case_refer','case_resolve'))",
        "'case_clear','case_refer','case_resolve','cancellation_hold','delivery_refund_reported'))",
    )
    event = _derive(
        event,
        " OR (((NEW.context='owner'",
        f" OR (NEW.context='seller' AND ({participant}) AND (NEW.action='cancellation_hold' AND ({seller('NEW.order_id', 'NEW.account_id', 'orders_negotiation')}))) OR (((NEW.context='owner'",
    )
    result = [event]
    result.append(
        trigger(
            "fulfilment_event",
            "INSERT",
            reject(
                f"(NEW.action='delivery_refund_reported' AND NEW.context='staff' AND (NOT ({permission('NEW.actor_id', chr(39) + 'record_delivery_refund' + chr(39))}) OR NOT EXISTS(SELECT 1 FROM fulfilment_reviewcase k WHERE k.order_id=NEW.order_id AND k.assigned_to_id=NEW.actor_id))) OR (NEW.action='cancellation_hold' AND NEW.context='staff' AND NOT ({_aftercare_permission('NEW.actor_id', chr(39) + 'read_aftercare' + chr(39))}))"
            ),
            suffix="refund_role_guard",
        )
    )
    result.append(
        _derive(
            source["fulfilment_blocker_insert_source_guard"],
            "e.action IN ('operational_hold') AND e.version=s.version",
            "e.action IN ('operational_hold','cancellation_hold') AND (e.action='operational_hold' OR EXISTS(SELECT 1 FROM orders_cancellationrequest p WHERE p.order_id=NEW.order_id AND p.state='pending')) AND e.version=s.version",
        )
    )
    result.append(
        _derive(
            source["fulfilment_blockerclosure_insert_guard"],
            "NEW.disposition NOT IN ('erroneous','withdrawn')",
            "NEW.disposition NOT IN ('erroneous','withdrawn','decided')",
        )
    )
    publication = _derive(
        source["fulfilment_publication_insert_guard"],
        "e.action='arrangement_proposed' AND EXISTS(SELECT 1 FROM fulfilment_arrangement f WHERE f.event_id=e.id AND f.order_id=e.order_id)",
        "e.action='cancellation_hold' AND EXISTS(SELECT 1 FROM fulfilment_blocker f WHERE f.event_id=e.id AND f.order_id=e.order_id) OR e.action='delivery_refund_reported' AND EXISTS(SELECT 1 FROM fulfilment_deliveryrefund f WHERE f.event_id=e.id AND f.order_id=e.order_id) OR e.action='arrangement_proposed' AND EXISTS(SELECT 1 FROM fulfilment_arrangement f WHERE f.event_id=e.id AND f.order_id=e.order_id)",
    )
    publication = _derive(
        publication,
        "(k.kind='correction' AND EXISTS(SELECT 1 FROM fulfilment_correction c WHERE c.id=k.correction_id AND c.order_id=k.order_id))",
        "(k.kind='correction' AND EXISTS(SELECT 1 FROM fulfilment_correction c WHERE c.id=k.correction_id AND c.order_id=k.order_id)) OR (k.kind='refund' AND EXISTS(SELECT 1 FROM fulfilment_deliveryrefunddecision d WHERE d.event_id=ce.event_id AND d.refund_id=k.refund_id AND d.order_id=k.order_id AND d.action=IF(ce.action='approve','confirmed','rejected')))",
    )
    publication = _derive(
        publication,
        complete_lines("p.id", "p.order_id"),
        _complete_lines_v4("p.id", "p.order_id"),
    )
    publication = _derive(
        publication,
        "EXISTS(SELECT 1 FROM inventory_allocationline a WHERE a.allocation_id=p.allocation_id AND NOT EXISTS(SELECT 1 FROM fulfilment_preparationline l WHERE l.preparation_id=p.id AND l.bucket_id=a.bucket_id AND l.quantity=a.quantity)) OR EXISTS(SELECT 1 FROM fulfilment_preparationline l WHERE l.preparation_id=p.id AND NOT EXISTS(SELECT 1 FROM inventory_allocationline a WHERE a.allocation_id=p.allocation_id AND a.bucket_id=l.bucket_id AND a.quantity=l.quantity))",
        _held_lines_invalid("p"),
    )
    result.append(publication)
    shipment = _derive(
        source["fulfilment_shipment_insert_guard"],
        complete_lines("NEW.preparation_id", "NEW.order_id"),
        _complete_lines_v4("NEW.preparation_id", "NEW.order_id"),
    )
    shipment = _derive(
        shipment,
        "NEW.goods_confirmed>0 AND (NEW.goods_confirmed>=o.goods_total",
        f"{_net_goods('NEW.order_id')}>0 AND ({_net_goods('NEW.order_id')}>={_accepted_total('o.id')}",
    )
    shipment = _derive(
        shipment,
        f"OR ({open_hold('NEW.order_id', 'cancellation')})",
        f"OR ({open_hold('NEW.order_id', 'cancellation')}) OR ({_cancellation_blocks('NEW.order_id')}) OR EXISTS(SELECT 1 FROM fulfilment_preparation p WHERE p.id=NEW.preparation_id AND p.allocation_id IS NOT NULL AND ({_held_lines_invalid('p')}))",
    )
    result.append(shipment)
    partial = _derive(
        source["fulfilment_partialpermission_insert_guard"],
        f"{goods_confirmed('o.id')}>0 AND {goods_confirmed('o.id')}<o.goods_total",
        f"{_net_goods('o.id')}>0 AND {_net_goods('o.id')}<{_accepted_total('o.id')}",
    )
    result.append(partial)
    result.append(
        _derive(
            source["fulfilment_completion_insert_guard"],
            eligible("NEW.order_id"),
            _eligible_v4("NEW.order_id"),
        )
    )
    reviewcase = _derive(
        source["fulfilment_reviewcase_insert_guard"],
        "OR (NEW.kind IN ('logistics','stock','exception') AND NEW.proposal_id IS NULL AND NEW.claim_id IS NULL AND NEW.correction_id IS NULL AND NEW.blocker_id IS NULL)",
        "OR (NEW.kind='refund' AND NEW.refund_id IS NOT NULL AND NEW.proposal_id IS NULL AND NEW.claim_id IS NULL AND NEW.correction_id IS NULL AND NEW.blocker_id IS NULL) OR (NEW.kind IN ('logistics','stock','exception') AND NEW.proposal_id IS NULL AND NEW.claim_id IS NULL AND NEW.correction_id IS NULL AND NEW.blocker_id IS NULL AND NEW.refund_id IS NULL)",
    )
    reviewcase = _derive(
        reviewcase,
        f"OR NOT ({accepted('NEW.order_id')})",
        f"OR (NEW.kind<>'refund' AND NEW.refund_id IS NOT NULL) OR (NEW.kind='refund' AND NEW.refund_id IS NULL) OR NOT ({accepted('NEW.order_id')})",
    )
    result.append(reviewcase)
    result.append(
        _derive(
            source["fulfilment_reviewcase_insert_target_guard"],
            "OR (NEW.blocker_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fulfilment_blocker b WHERE b.id=NEW.blocker_id AND b.order_id=NEW.order_id))",
            "OR (NEW.blocker_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fulfilment_blocker b WHERE b.id=NEW.blocker_id AND b.order_id=NEW.order_id)) OR (NEW.refund_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM fulfilment_deliveryrefund d WHERE d.id=NEW.refund_id AND d.order_id=NEW.order_id))",
        )
    )
    result.append(
        _derive(
            source["fulfilment_caseevent_insert_guard"],
            "WHEN 'blocker' THEN 'manage_delivery_holds' ELSE 'manage_logistics'",
            "WHEN 'blocker' THEN 'manage_delivery_holds' WHEN 'refund' THEN 'confirm_delivery_refund' ELSE 'manage_logistics'",
            count=2,
        )
    )
    result.append(
        _derive(
            source["fulfilment_evidence_insert_guard"],
            "NEW.purpose NOT IN ('claim','correction')",
            "NEW.purpose NOT IN ('claim','correction','refund')",
        )
    )
    binding = _derive(
        source["fulfilment_evidencebinding_insert_guard"],
        "WHERE image.id=NEW.evidence_id AND image.order_id=c.order_id AND image.creator_id=e.account_id AND image.purpose='correction' AND image.expires_at>UTC_TIMESTAMP(6) AND NOT EXISTS(SELECT 1 FROM fulfilment_publication pub WHERE pub.event_id=c.event_id))",
        "WHERE image.id=NEW.evidence_id AND image.order_id=c.order_id AND image.creator_id=e.account_id AND image.purpose='correction' AND image.expires_at>UTC_TIMESTAMP(6) AND NOT EXISTS(SELECT 1 FROM fulfilment_publication pub WHERE pub.event_id=c.event_id)) OR EXISTS(SELECT 1 FROM fulfilment_evidence image JOIN fulfilment_deliveryrefund r ON r.id=NEW.refund_id JOIN fulfilment_event e ON e.id=r.event_id WHERE image.id=NEW.evidence_id AND image.order_id=r.order_id AND image.creator_id=e.account_id AND image.purpose='refund' AND image.expires_at>UTC_TIMESTAMP(6) AND NOT EXISTS(SELECT 1 FROM fulfilment_publication pub WHERE pub.event_id=r.event_id))",
    )
    binding = _derive(
        binding,
        "OR NEW.correction_id IS NOT NULL AND (SELECT COUNT(*) FROM fulfilment_evidencebinding b WHERE b.correction_id=NEW.correction_id)>=3",
        "OR NEW.correction_id IS NOT NULL AND (SELECT COUNT(*) FROM fulfilment_evidencebinding b WHERE b.correction_id=NEW.correction_id)>=3 OR NEW.refund_id IS NOT NULL AND (SELECT COUNT(*) FROM fulfilment_evidencebinding b WHERE b.refund_id=NEW.refund_id)>=3",
    )
    result.append(binding)
    result += [trigger("fulfilment_deliveryrefund", "UPDATE", reject()), trigger("fulfilment_deliveryrefund", "DELETE", reject())]
    body = "DECLARE parent_id CHAR(32); SELECT order_id INTO parent_id FROM fulfilment_state WHERE order_id=NEW.order_id FOR UPDATE; "
    body += reject(
        """parent_id IS NULL OR NEW.currency<>(SELECT currency FROM orders_sellerorder WHERE id=NEW.order_id) OR NEW.sent_at>UTC_TIMESTAMP(6) OR CHAR_LENGTH(TRIM(NEW.description))=0 OR NOT EXISTS(SELECT 1 FROM fulfilment_provider p WHERE p.id=NEW.provider_id AND p.order_id=NEW.order_id) OR NOT EXISTS(SELECT 1 FROM fulfilment_event e JOIN fulfilment_state s ON s.order_id=e.order_id WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.action='delivery_refund_reported' AND e.version<=s.version) OR NOT (EXISTS(SELECT 1 FROM fulfilment_arrangement a JOIN fulfilment_publication ap ON ap.event_id=a.event_id WHERE a.order_id=NEW.order_id AND a.provider_id=NEW.provider_id AND NOT EXISTS(SELECT 1 FROM fulfilment_arrangement later JOIN fulfilment_publication lp ON lp.event_id=later.event_id JOIN fulfilment_event le ON le.id=later.event_id JOIN fulfilment_event ae ON ae.id=a.event_id WHERE later.order_id=NEW.order_id AND le.version>ae.version)) OR EXISTS(SELECT 1 FROM fulfilment_chargeproposal cp JOIN fulfilment_chargedecision cd ON cd.proposal_id=cp.id JOIN fulfilment_publication dp ON dp.event_id=cd.event_id WHERE cp.order_id=NEW.order_id AND cp.provider_id=NEW.provider_id AND cd.action='approved'))"""
    )
    body += reject(f"""{_confirmed_refunds('NEW.order_id', 'NEW.provider_id')}+NEW.amount>{_provider_receipts('NEW.provider_id', 'NEW.order_id')}""")
    result.append(trigger("fulfilment_deliveryrefund", "INSERT", body))
    result += [
        trigger("fulfilment_deliveryrefunddecision", "UPDATE", reject()),
        trigger("fulfilment_deliveryrefunddecision", "DELETE", reject()),
    ]
    body = "DECLARE parent_id CHAR(32); SELECT order_id INTO parent_id FROM fulfilment_state WHERE order_id=NEW.order_id FOR UPDATE; "
    body += reject(
        f"""parent_id IS NULL OR NEW.action NOT IN ('confirmed','rejected') OR CHAR_LENGTH(TRIM(NEW.reason))<3 OR NOT EXISTS(SELECT 1 FROM fulfilment_reviewcase k JOIN fulfilment_event e ON e.id=NEW.event_id JOIN fulfilment_state s ON s.order_id=e.order_id WHERE k.refund_id=NEW.refund_id AND e.order_id=NEW.order_id AND e.version<=s.version AND e.action=CASE NEW.action WHEN 'confirmed' THEN 'case_approve' ELSE 'case_reject' END AND e.actor_id=k.assigned_to_id AND ({permission('e.actor_id', chr(39) + 'confirm_delivery_refund' + chr(39))}) AND ({independent('NEW.order_id', 'e.actor_id')}) AND NOT EXISTS(SELECT 1 FROM fulfilment_deliveryrefund dr JOIN fulfilment_event de ON de.id=dr.event_id WHERE dr.id=NEW.refund_id AND de.actor_id=e.actor_id)) OR EXISTS(SELECT 1 FROM fulfilment_deliveryrefunddecision existing_decision WHERE existing_decision.refund_id=NEW.refund_id)"""
    )
    body += reject(
        f"""NEW.action='confirmed' AND {_confirmed_refunds('NEW.order_id', '(SELECT provider_id FROM fulfilment_deliveryrefund WHERE id=NEW.refund_id)')}+(SELECT amount FROM fulfilment_deliveryrefund WHERE id=NEW.refund_id)>{_provider_receipts('(SELECT provider_id FROM fulfilment_deliveryrefund WHERE id=NEW.refund_id)', 'NEW.order_id')}"""
    )
    result.append(trigger("fulfilment_deliveryrefunddecision", "INSERT", body))
    return result


def _dispute_withdrawal(order, event, blocker, *, inserting=False):
    from apps.orders.mariadb_guards import dispute_event_unpublished

    actor_event = "NEW" if inserting else "withdrawal"
    event_join = "" if inserting else f"JOIN fulfilment_event withdrawal ON withdrawal.id={event}"
    return f"""EXISTS(SELECT 1 FROM orders_disputerequest request
        JOIN orders_aftercareevent opening ON opening.id=request.event_id
        JOIN orders_aftercareevent aftercare_event ON aftercare_event.order_id=request.order_id
        JOIN orders_aftercare head ON head.order_id=aftercare_event.order_id
        JOIN fulfilment_blocker hold ON hold.id=request.blocker_id
        {event_join}
        JOIN accounts_account buyer_account ON buyer_account.id=request.requester_account_id
        WHERE request.order_id={order} AND request.blocker_id={blocker} AND request.state='withdrawn'
        AND hold.order_id=request.order_id AND hold.kind='dispute'
        AND opening.action='dispute_opened' AND opening.order_id=request.order_id
        AND {actor_event}.order_id=request.order_id AND {actor_event}.action='dispute_withdrawn'
        AND {actor_event}.context='buyer' AND {actor_event}.account_id=request.requester_account_id
        AND {actor_event}.actor_id=buyer_account.user_id AND ({buyer(order, actor_event + '.account_id')})
        AND aftercare_event.action='dispute_withdrawn' AND aftercare_event.version=head.version
        AND aftercare_event.actor_id={actor_event}.actor_id AND aftercare_event.account_id={actor_event}.account_id
        AND aftercare_event.context={actor_event}.context AND opening.version<aftercare_event.version
        AND ({dispute_event_unpublished('aftercare_event', order)})
        AND NOT EXISTS(SELECT 1 FROM orders_disputedecision decision WHERE decision.dispute_id=request.id)
        AND NOT EXISTS(SELECT 1 FROM orders_disputerequest newer JOIN orders_aftercareevent newer_open
            ON newer_open.id=newer.event_id WHERE newer.order_id=request.order_id AND newer_open.version>opening.version))"""


def dispute_statements():
    """Exact buyer dispute construction/withdrawal; ordinary staff clear is unchanged."""
    from apps.orders.mariadb_guards import dispute_event_unpublished

    source = {s.split("`", 2)[1]: s for s in statements() + refund_statements() if s.startswith("CREATE TRIGGER")}
    buyer_actions = (
        "AND NEW.action IN ('recipient_revised','delivery_claimed','claim_withdrawn',"
        "'correction_proposed','delivered','cancellation_hold')"
    )
    event = _derive(source["fulfilment_event_insert_guard"], buyer_actions,
                    buyer_actions[:-1] + ",'dispute_hold','dispute_withdrawn')")
    event = event.removesuffix(" END") + " " + reject(f"""NEW.action='dispute_withdrawn'
        AND NOT EXISTS(SELECT 1 FROM orders_disputerequest request WHERE request.order_id=NEW.order_id
            AND ({_dispute_withdrawal('NEW.order_id', 'NEW.id', 'request.blocker_id', inserting=True)}))""") + " END"
    hold_source = (
        "e.action IN ('operational_hold','cancellation_hold') AND (e.action='operational_hold' "
        "OR EXISTS(SELECT 1 FROM orders_cancellationrequest p WHERE p.order_id=NEW.order_id AND p.state='pending')) "
        "AND e.version=s.version"
    )
    opening = f"""EXISTS(SELECT 1 FROM orders_disputerequest request
        JOIN orders_aftercareevent opening ON opening.id=request.event_id
        JOIN orders_aftercare head ON head.order_id=opening.order_id
        WHERE request.order_id=NEW.order_id AND request.state='pending' AND request.blocker_id IS NULL
        AND opening.order_id=request.order_id AND opening.action='dispute_opened' AND opening.version=head.version
        AND opening.actor_id=e.actor_id AND opening.account_id=e.account_id AND opening.context=e.context
        AND e.context='buyer' AND NEW.kind='dispute' AND ({dispute_event_unpublished('opening', 'NEW.order_id')}))"""
    blocker = _derive(source["fulfilment_blocker_insert_source_guard"], hold_source,
                      f"(({hold_source}) OR (e.action='dispute_hold' AND e.version=s.version AND ({opening})))")
    closure_source = _derive(source["fulfilment_blockerclosure_insert_source_guard"], "'case_clear'",
                             "'case_clear','dispute_withdrawn'")
    closure = source["fulfilment_blockerclosure_insert_guard"].removesuffix(" END") + " " + reject(f"""
        EXISTS(SELECT 1 FROM fulfilment_event e WHERE e.id=NEW.event_id AND e.action='dispute_withdrawn')
        AND (NEW.disposition<>'withdrawn' OR NOT ({_dispute_withdrawal('NEW.order_id', 'NEW.event_id', 'NEW.blocker_id')})
            OR NOT EXISTS(SELECT 1 FROM fulfilment_reviewcase k WHERE k.order_id=NEW.order_id
                AND k.blocker_id=NEW.blocker_id AND k.kind='blocker' AND k.state='open')
            OR EXISTS(SELECT 1 FROM fulfilment_blockerclosure prior WHERE prior.blocker_id=NEW.blocker_id))
        """) + " " + reject("""EXISTS(SELECT 1 FROM orders_disputerequest request
            JOIN fulfilment_event e ON e.id=NEW.event_id WHERE request.blocker_id=NEW.blocker_id
            AND e.action='case_clear' AND (NEW.disposition<>'decided'
                OR NOT EXISTS(SELECT 1 FROM orders_disputedecision decision
                    JOIN orders_aftercareevent decision_event ON decision_event.id=decision.event_id
                    JOIN orders_aftercare head ON head.order_id=decision_event.order_id
                    WHERE decision.dispute_id=request.id AND request.state=decision.action
                    AND request.order_id=NEW.order_id AND decision_event.order_id=NEW.order_id
                    AND decision_event.version=head.version AND decision.actor_id=e.actor_id
                    AND (decision.account_id <=> e.account_id) AND decision.context=e.context)))""") + " END"
    case_source = _derive(source["fulfilment_caseevent_insert_source_guard"], "'case_resolve'",
                          "'case_resolve','dispute_withdrawn'")
    case_event = source["fulfilment_caseevent_insert_guard"]
    withdrawal_case = f"""EXISTS(SELECT 1 FROM fulfilment_reviewcase k JOIN fulfilment_event e ON e.id=NEW.event_id
        WHERE k.id=NEW.case_id AND k.order_id=NEW.order_id AND k.kind='blocker' AND k.state='open'
        AND NEW.case_version=k.version+1 AND (NEW.assigned_to_id <=> k.assigned_to_id)
        AND NEW.action='withdraw' AND ({_dispute_withdrawal('NEW.order_id', 'NEW.event_id', 'k.blocker_id')})
        AND EXISTS(SELECT 1 FROM fulfilment_blockerclosure closure WHERE closure.blocker_id=k.blocker_id
            AND closure.event_id=NEW.event_id AND closure.disposition='withdrawn'))"""
    case_event = _derive(case_event, "NOT EXISTS(SELECT 1 FROM fulfilment_reviewcase k",
                         f"NOT ({withdrawal_case}) AND NOT EXISTS(SELECT 1 FROM fulfilment_reviewcase k")
    published_withdrawal = f"""e.action='dispute_withdrawn' AND EXISTS(SELECT 1 FROM fulfilment_caseevent ce
        JOIN fulfilment_reviewcase k ON k.id=ce.case_id JOIN fulfilment_blockerclosure closure
            ON closure.blocker_id=k.blocker_id AND closure.event_id=ce.event_id
        WHERE ce.event_id=e.id AND ce.order_id=e.order_id AND ce.action='withdraw'
        AND k.order_id=e.order_id AND k.kind='blocker' AND k.state='resolved' AND ce.case_version=k.version
        AND (ce.assigned_to_id <=> k.assigned_to_id) AND closure.disposition='withdrawn'
        AND ({_dispute_withdrawal('e.order_id', 'e.id', 'k.blocker_id')}))"""
    publication = _derive(source["fulfilment_publication_insert_guard"],
        "e.action='cancellation_hold' AND EXISTS(SELECT 1 FROM fulfilment_blocker f WHERE f.event_id=e.id AND f.order_id=e.order_id)",
        "e.action='dispute_hold' AND EXISTS(SELECT 1 FROM fulfilment_blocker f JOIN orders_disputerequest request "
        "ON request.blocker_id=f.id WHERE f.event_id=e.id AND f.order_id=e.order_id AND f.kind='dispute' "
        "AND request.order_id=e.order_id AND request.state='pending') OR " + published_withdrawal +
        " OR e.action='cancellation_hold' AND EXISTS(SELECT 1 FROM fulfilment_blocker f WHERE f.event_id=e.id AND f.order_id=e.order_id)")
    return [event, blocker, closure_source, closure, case_source, case_event, publication]
