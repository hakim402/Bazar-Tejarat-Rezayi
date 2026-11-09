"""Explicit v4 -> v5 publication, retaining exact historical installer meanings."""

from . import schema
from .aftercare_v4 import begin as _begin, publish as _publish

UPGRADING = "phase15-upgrading-v5"

# Every guard whose reviewed v4 body this phase derives. An unlisted trigger may
# never be overwritten, and a listed one may only move from its exact v4 body.
REPLACED = {
    "orders_aftercareevent_insert_guard",
    "orders_aftercarecommand_insert_source_guard",
    "payments_event_insert_guard",
    "payments_refunddue_insert_guard",
    "payments_refundseal_insert_guard",
    "payments_evidencebinding_insert_guard",
    "payments_refunddecision_insert_guard",
    "fulfilment_event_insert_guard",
    "fulfilment_blocker_insert_source_guard",
    "fulfilment_blockerclosure_insert_source_guard",
    "fulfilment_blockerclosure_insert_guard",
    "fulfilment_caseevent_insert_source_guard",
    "fulfilment_caseevent_insert_guard",
    "fulfilment_publication_insert_guard",
    "messaging_report_update_guard",
    "notifications_notice_update_guard",
    "notifications_notice_insert_guard",
    "notifications_notice_insert_old_scope_guard",
    "notifications_event_insert_guard",
    "notifications_aftercareemail_insert_scope_guard",
    "notifications_aftercareemail_update_guard",
}


def additions():
    from .common import uuid_statements
    from apps.orders.mariadb_guards import aftercare_statements, dispute_statements
    from apps.payments.mariadb_guards import dispute_refund_statements
    from apps.fulfilment.mariadb_guards import dispute_statements as delivery_disputes
    from apps.messaging.mariadb_guards import dispute_statements as messaging_disputes
    from apps.notifications.mariadb_guards import dispute_statements as notifications_disputes

    old = set(schema.reference(4)["ddl"])
    statements = (
        list(uuid_statements(version=5))
        + aftercare_statements(version=5)
        + dispute_statements()
        + dispute_refund_statements()
        + delivery_disputes()
        + messaging_disputes()
        + notifications_disputes()
    )
    # Applied history stores each statement once: an unchanged retained guard
    # already sits in the v4 bytes and is not re-issued.
    seen, delta = set(old), []
    for statement in statements:
        if statement not in seen:
            seen.add(statement)
            delta.append(statement)
    return delta


def begin(apps, editor):
    _begin(apps, editor, version=5, marker=UPGRADING)


def publish(apps, editor):
    _publish(apps, editor, version=5, marker=UPGRADING, replaced=REPLACED, delta=additions())