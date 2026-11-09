from apps.runtime.mariadb.ddl import reject, same, trigger


def statements():
    result = []
    result.append(trigger("notifications_notice", "DELETE", reject()))
    result.append(trigger("notifications_notice", "UPDATE", reject(f"NOT ({same('id event_id account_id conversation_id order_id negotiation_id created_at')}) OR (OLD.read_at IS NOT NULL AND NOT (NEW.read_at <=> OLD.read_at))")))
    result.append(trigger("notifications_notice", "INSERT", reject("(NEW.negotiation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e JOIN orders_negotiationevent r ON r.id=e.negotiation_event_id WHERE e.id=NEW.event_id AND r.request_id=NEW.negotiation_id AND e.kind='negotiation')) OR (NEW.order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.order_id=NEW.order_id AND e.kind='order_accepted')) OR (NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.order_id IS NULL AND e.negotiation_event_id IS NULL))")))
    result.append(trigger("notifications_outbox", "DELETE", reject()))
    result.append(trigger("notifications_outbox", "UPDATE", reject(f"NOT ({same('id conversation_id account_id episode identity_digest created_at')}) OR NEW.version<>OLD.version+1")))
    result.append(trigger("notifications_ordernoticecursor", "DELETE", reject()))
    result.append(trigger("notifications_ordernoticecursor", "UPDATE", reject(f"OLD.complete OR NOT ({same('event_id sender_id')}) OR NEW.version<>OLD.version+1 OR (OLD.after_account IS NOT NULL AND (NEW.after_account IS NULL OR NEW.after_account<OLD.after_account))")))
    result.append(trigger("notifications_event", "INSERT", reject("NEW.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messaging_message m WHERE m.id=NEW.message_id AND m.published)")))
    return result


def _derive(statement, old, new, count=1):
    if statement.count(old) != count:
        raise RuntimeError("The retained notification guard no longer contains its reviewed clause.")
    return statement.replace(old, new)


def aftercare_statements():
    """Phase 14 aftercare notice/email guards. The typed notice boundary
    gains the aftercare resource branch; v1-v3 bytes are untouched."""
    from apps.payments.mariadb_guards import seller_account
    from apps.runtime.mariadb.fulfilment_v3 import notification_statements

    result = []
    for statement in notification_statements():
        name = statement.split("`", 2)[1]
        if name == "notifications_notice_update_guard":
            statement = _derive(
                statement,
                "AND (OLD.`fulfilment_order_id` <=> NEW.`fulfilment_order_id`)",
                "AND (OLD.`fulfilment_order_id` <=> NEW.`fulfilment_order_id`) AND (OLD.`aftercare_order_id` <=> NEW.`aftercare_order_id`)",
            )
        elif name == "notifications_notice_insert_guard":
            statement = _derive(
                statement,
                "OR NEW.fulfilment_order_id IS NULL AND EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.kind='fulfilment')",
                "OR NEW.fulfilment_order_id IS NULL AND EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.kind='fulfilment') OR (NEW.aftercare_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.kind='aftercare' AND (EXISTS(SELECT 1 FROM orders_aftercareevent a WHERE a.id=e.aftercare_event_id AND a.order_id=NEW.aftercare_order_id) OR EXISTS(SELECT 1 FROM payments_event p WHERE p.id=e.payment_event_id AND p.order_id=NEW.aftercare_order_id) OR EXISTS(SELECT 1 FROM fulfilment_event f WHERE f.id=e.fulfilment_event_id AND f.order_id=NEW.aftercare_order_id)))) OR (NEW.aftercare_order_id IS NULL AND EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.kind='aftercare'))",
            )
        elif name == "notifications_event_insert_guard":
            prefix = statement.rsplit(" END", 1)[0]
            statement = (
                prefix
                + " "
                + reject(
                    "NEW.aftercare_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orders_aftercareevent a JOIN orders_aftercare s ON s.order_id=a.order_id WHERE a.id=NEW.aftercare_event_id AND a.version<=s.version)"
                )
                + " END"
            )
        result.append(statement)
    result += [
        trigger("notifications_aftercarenoticecursor", "DELETE", reject()),
        trigger(
            "notifications_aftercarenoticecursor",
            "UPDATE",
            reject(
                f"OLD.complete OR NEW.version<>OLD.version+1 OR NOT ({same('event_id sender_id')}) OR OLD.after_account IS NOT NULL AND (NEW.after_account IS NULL OR NEW.after_account<OLD.after_account)"
            ),
        ),
        trigger(
            "notifications_aftercarenoticecursor",
            "INSERT",
            reject(
                "NEW.version<>0 OR NEW.complete OR NEW.after_account IS NOT NULL OR NOT EXISTS(SELECT 1 FROM notifications_event n WHERE n.id=NEW.event_id AND n.kind='aftercare')"
            ),
        ),
    ]
    result.append(
        trigger(
            "notifications_aftercareemail",
            "INSERT",
            reject(
                f"NOT EXISTS(SELECT 1 FROM orders_sellerorder o JOIN accounts_account a ON a.id=o.buyer_id JOIN accounts_user u ON u.id=a.user_id WHERE o.id=NEW.order_id AND NEW.account_id=a.id AND a.status='active' AND u.is_active AND u.email_verified) AND NOT ({seller_account('NEW.order_id', 'NEW.account_id', bundles=('orders_negotiation', 'payments_refunds'))})"
            ),
            suffix="scope_guard",
        )
    )
    result.append(
        trigger(
            "notifications_aftercareemail",
            "INSERT",
            reject(
                "NEW.status<>'queued' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.lease IS NOT NULL OR NEW.lease_until IS NOT NULL OR CHAR_LENGTH(NEW.identity_digest)<>64"
            ),
        )
    )
    result.append(trigger("notifications_aftercareemail", "DELETE", reject()))
    transition = """(OLD.status IN ('queued','retry_due','claimed') AND NEW.status IN ('claimed','dispatching','retry_due','cancelled','exhausted')) OR (OLD.status='dispatching' AND NEW.status IN ('captured','smtp_accepted','retry_due','delivery_unknown','exhausted'))"""
    result.append(
        trigger(
            "notifications_aftercareemail",
            "UPDATE",
            reject(
                f"NOT ({same('id order_id account_id episode identity_digest created_at')}) OR NEW.version<>OLD.version+1 OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR NOT ({transition})"
            ),
        )
    )
    result += [trigger("notifications_aftercareemailattempt", "UPDATE", reject()), trigger("notifications_aftercareemailattempt", "DELETE", reject())]
    return result


def _report_recipient(report, account):
    """Native equivalent of fresh report_recipient; no counterpart fan-out."""
    from apps.payments.mariadb_guards import seller_account

    return f"""EXISTS(SELECT 1 FROM accounts_account a JOIN accounts_user u ON u.id=a.user_id
        WHERE a.id={account} AND a.id={report}.reporter_id AND a.status='active' AND u.is_active AND u.email_verified
        AND (({report}.product_id IS NOT NULL OR {report}.store_id IS NOT NULL) AND a.context='buyer'
          OR {report}.order_id IS NOT NULL AND (
            EXISTS(SELECT 1 FROM orders_sellerorder o WHERE o.id={report}.order_id AND o.buyer_id=a.id AND a.context='buyer')
            OR {seller_account(report + '.order_id', account, bundles=('orders_negotiation', 'payments_refunds'))})
          OR {report}.message_id IS NOT NULL AND EXISTS(
            SELECT 1 FROM messaging_message m JOIN messaging_conversation c ON c.id=m.conversation_id
            JOIN organizations_businessprofile p ON p.id=c.seller_id WHERE m.id={report}.message_id AND m.published
            AND (a.context='buyer' AND c.buyer_id=a.id OR a.context='seller' AND (
                p.kind='individual' AND p.account_id=a.id OR p.kind='company' AND EXISTS(
                  SELECT 1 FROM organizations_membership member WHERE member.company_id=p.id AND member.account_id=a.id
                  AND member.active AND (member.is_owner OR JSON_CONTAINS(member.bundles,'"messaging"'))))))))"""


def dispute_statements():
    """Derive v5 only; all retained v1-v4 statements stay byte-identical."""
    from apps.payments.mariadb_guards import seller_account

    source = {s.split("`", 2)[1]: s for s in aftercare_statements() if s.startswith("CREATE TRIGGER")}
    result = [
        _derive(
            source["notifications_notice_update_guard"],
            "AND (OLD.`aftercare_order_id` <=> NEW.`aftercare_order_id`) AND (OLD.`created_at` <=> NEW.`created_at`)",
            "AND (OLD.`aftercare_order_id` <=> NEW.`aftercare_order_id`) AND (OLD.`product_id` <=> NEW.`product_id`) AND (OLD.`store_id` <=> NEW.`store_id`) AND (OLD.`created_at` <=> NEW.`created_at`)",
        )
    ]
    valid_report_notice = f"""EXISTS(SELECT 1 FROM notifications_event e JOIN messaging_report r ON r.id=e.report_id
        WHERE e.id=NEW.event_id AND e.kind='report_status' AND ({_report_recipient('r', 'NEW.account_id')})
        AND (r.product_id IS NOT NULL AND r.product_id=NEW.product_id
          OR r.store_id IS NOT NULL AND r.store_id=NEW.store_id
          OR r.order_id IS NOT NULL AND r.order_id=NEW.order_id
          OR r.message_id IS NOT NULL AND EXISTS(SELECT 1 FROM messaging_message m
             WHERE m.id=r.message_id AND m.conversation_id=NEW.conversation_id)))"""
    tail = "OR (NEW.aftercare_order_id IS NULL AND EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.kind='aftercare'))"
    result.append(_derive(
        source["notifications_notice_insert_guard"], tail,
        tail + " OR ((NEW.product_id IS NOT NULL OR NEW.store_id IS NOT NULL OR EXISTS(SELECT 1 FROM notifications_event e WHERE e.id=NEW.event_id AND e.kind='report_status')) AND NOT ("
        + valid_report_notice + "))",
    ))
    old_order = "e.order_id=NEW.order_id AND e.kind='order_accepted'"
    result.append(_derive(
        source["notifications_notice_insert_old_scope_guard"], old_order,
        "((e.order_id=NEW.order_id AND e.kind='order_accepted') OR (e.kind='report_status' AND EXISTS(SELECT 1 FROM messaging_report r WHERE r.id=e.report_id AND r.order_id=NEW.order_id AND r.reporter_id=NEW.account_id)))",
    ))
    result.append(_derive(
        source["notifications_event_insert_guard"], "END IF; END",
        "END IF; " + reject("NEW.kind='report_status' AND NOT EXISTS(SELECT 1 FROM messaging_report r JOIN messaging_caseevent c ON c.report_id=r.id AND c.version=NEW.report_version WHERE r.id=NEW.report_id AND r.version=NEW.report_version)") + " END",
    ))
    # Bind the email to its exact typed notice episode, not an arbitrary UUID.
    old_scope = f"NOT EXISTS(SELECT 1 FROM orders_sellerorder o JOIN accounts_account a ON a.id=o.buyer_id JOIN accounts_user u ON u.id=a.user_id WHERE o.id=NEW.order_id AND NEW.account_id=a.id AND a.status='active' AND u.is_active AND u.email_verified) AND NOT ({seller_account('NEW.order_id', 'NEW.account_id', bundles=('orders_negotiation', 'payments_refunds'))})"
    valid_order = f"""NEW.order_id IS NOT NULL AND NEW.report_id IS NULL AND NOT ({old_scope})
        AND EXISTS(SELECT 1 FROM notifications_notice n JOIN notifications_event e ON e.id=n.event_id
          WHERE e.id=NEW.episode AND e.kind='aftercare' AND n.account_id=NEW.account_id AND n.aftercare_order_id=NEW.order_id)"""
    valid_report = f"""NEW.order_id IS NULL AND NEW.report_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM messaging_report r JOIN notifications_event e ON e.report_id=r.id
        JOIN notifications_notice n ON n.event_id=e.id AND n.account_id=NEW.account_id
        WHERE r.id=NEW.report_id AND e.id=NEW.episode AND e.kind='report_status' AND n.read_at IS NULL
        AND ({_report_recipient('r', 'NEW.account_id')}) AND (
          r.product_id IS NOT NULL AND r.product_id=n.product_id OR r.store_id IS NOT NULL AND r.store_id=n.store_id
          OR r.order_id IS NOT NULL AND r.order_id=n.order_id OR r.message_id IS NOT NULL AND EXISTS(
            SELECT 1 FROM messaging_message m WHERE m.id=r.message_id AND m.conversation_id=n.conversation_id)))"""
    result.append(_derive(source["notifications_aftercareemail_insert_scope_guard"], old_scope,
                          "NOT ((" + valid_order + ") OR (" + valid_report + "))"))
    result.append(_derive(
        source["notifications_aftercareemail_update_guard"],
        same("id order_id account_id episode identity_digest created_at"),
        same("id order_id report_id account_id episode identity_digest created_at"),
    ))
    return result
