from apps.runtime.mariadb.ddl import reject, same, trigger


def statements():
    result = []
    scope = reject("NOT EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.buyer_id AND a.context='buyer') OR NOT EXISTS(SELECT 1 FROM catalogue_product p WHERE p.id=NEW.product_id AND p.seller_id=NEW.seller_id)")
    result.append(trigger("messaging_conversation", "INSERT", scope))
    result.append(trigger("messaging_conversation", "DELETE", reject()))
    result.append(trigger("messaging_conversation", "UPDATE", reject(f"NOT ({same('id buyer_id seller_id product_id snapshot created_at', json={'snapshot'})}) OR NEW.sequence<>OLD.sequence+1")))
    scope = "CHAR_LENGTH(NEW.body)>6000 OR NOT EXISTS(SELECT 1 FROM accounts_account a WHERE a.id=NEW.author_id AND a.context=NEW.context) OR NOT EXISTS(SELECT 1 FROM messaging_conversation c WHERE c.id=NEW.conversation_id AND c.sequence=NEW.sequence AND (NEW.context='seller' OR c.buyer_id=NEW.author_id))"
    result.append(trigger("messaging_message", "INSERT", reject(scope + " OR NEW.published")))
    immutable = same("id conversation_id sequence author_id context author_label body created_at")
    seal = "(TRIM(NEW.body)='' AND NOT EXISTS(SELECT 1 FROM messaging_attachment a WHERE a.message_id=NEW.id)) OR (SELECT COUNT(*) FROM messaging_attachment WHERE message_id=NEW.id)>3"
    result.append(trigger("messaging_message", "UPDATE", reject(f"OLD.published OR NOT NEW.published OR NOT ({immutable}) OR ({seal})")))
    result.append(trigger("messaging_message", "DELETE", reject()))
    identity = same("id product_id creator_id storage_alias key content_type size sha256 width height created_at")
    for event in ("INSERT", "UPDATE"):
        body = ""
        if event == "UPDATE":
            body += reject(f"OLD.message_id IS NOT NULL OR NOT ({identity}) OR NEW.message_id IS NULL OR (OLD.conversation_id IS NOT NULL AND OLD.conversation_id<>NEW.conversation_id) OR NEW.expires_at IS NOT NULL")
        body += reject("NEW.storage_alias<>'private_local' OR NEW.`key` NOT LIKE 'messages/%' OR NEW.`key` LIKE '%..%'")
        body += reject("NEW.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messaging_message m JOIN messaging_conversation c ON c.id=m.conversation_id WHERE m.id=NEW.message_id AND NOT m.published AND c.id=NEW.conversation_id AND c.product_id=NEW.product_id AND m.author_id=NEW.creator_id)")
        result.append(trigger("messaging_attachment", event, body))
    result.append(trigger("messaging_attachment", "DELETE", reject("OLD.message_id IS NOT NULL OR OLD.expires_at IS NULL OR OLD.expires_at>CURRENT_TIMESTAMP(6)")))
    result.append(trigger("messaging_report", "DELETE", reject()))
    result.append(trigger("messaging_report", "UPDATE", reject(f"NOT ({same('id message_id reporter_id category reason created_at')}) OR NEW.version<>OLD.version+1 OR NEW.status NOT IN ('open','resolved')")))
    result.append(trigger("messaging_readstate", "UPDATE", reject(f"NOT ({same('id conversation_id account_id')}) OR NEW.last_read<OLD.last_read OR NEW.latest_incoming<OLD.latest_incoming OR NEW.episode<OLD.episode OR NEW.episode>OLD.episode+1")))
    return result
