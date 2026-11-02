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
