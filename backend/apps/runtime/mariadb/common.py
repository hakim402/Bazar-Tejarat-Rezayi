from .ddl import reject, same, trigger, retained


def statements():
    result = []
    for table in ("runtime_mutex", "inventory_batch", "inventory_operation", "inventory_movement", "inventory_allocationline", "inventory_shortage", "inventory_recovery", "marketplace_storemedia", "marketplace_storeevent", "messaging_command", "messaging_caseevent", "messaging_caseaccess", "notifications_event", "notifications_attempt", "orders_sellerorder", "orders_orderline", "orders_invoice", "orders_checkoutsubmission", "orders_orderevent", "orders_negotiationsubmission", "orders_negotiationrevision", "orders_negotiationevent", "orders_negotiationcommand"):
        result.extend(retained(table))
    # Generated NULL slots implement PostgreSQL conditional/expression uniqueness.
    slots = [
        ("accounts_user", "email_normalized", "VARCHAR(254)", "LOWER(email)", "accounts_email_case_insensitive", "email_normalized"),
        ("organizations_businessprofile", "owned_kind", "VARCHAR(12)", "CASE WHEN kind <> 'company' THEN kind ELSE NULL END", "organizations_one_owned_profile_kind", "account_id,owned_kind"),
        ("organizations_invitation", "pending_slot", "TINYINT", "CASE WHEN status='pending' THEN 1 ELSE NULL END", "organizations_one_pending_invite", "company_id,email,pending_slot"),
        ("organizations_ownershiptransfer", "pending_slot", "TINYINT", "CASE WHEN status IN ('pending','accepted') THEN 1 ELSE NULL END", "organizations_one_pending_transfer", "company_id,pending_slot"),
        ("catalogue_sourcerevision", "submitted_slot", "TINYINT", "CASE WHEN state='submitted' THEN 1 ELSE NULL END", "catalogue_one_submission", "product_id,submitted_slot"),
        ("marketplace_storerevision", "submitted_slot", "TINYINT", "CASE WHEN state='submitted' THEN 1 ELSE NULL END", "marketplace_one_submission", "store_id,submitted_slot"),
        ("inventory_operation", "reference_slot", "VARCHAR(120)", "CASE WHEN reference <> '' THEN reference ELSE NULL END", "inventory_logical_operation", "seller_id,action,reference_slot"),
    ]
    for table, column, kind, expression, name, fields in slots:
        fields = ",".join(f"`{x}`" for x in fields.split(","))
        result.append(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {kind} GENERATED ALWAYS AS ({expression}) PERSISTENT, ADD UNIQUE KEY `{name}` ({fields})")
    # MariaDB11.4 rejects this generated expression on a CHAR FK. Serialize
    # plain-bucket uniqueness on its retained position instead of weakening it.
    body = "DECLARE parent_id CHAR(32); SELECT variant_id INTO parent_id FROM inventory_position WHERE variant_id=NEW.position_id FOR UPDATE; "
    body += reject("NEW.batch_id IS NULL AND EXISTS(SELECT 1 FROM inventory_bucket b WHERE b.position_id=NEW.position_id AND b.batch_id IS NULL AND b.id<>NEW.id)", "Duplicate plain stock bucket")
    result.extend(trigger("inventory_bucket", event, body, suffix="plain_guard") for event in ("INSERT", "UPDATE"))
    return result


def store_statements():
    table = "marketplace_storerevision"
    immutable = same("id store_id number business_case_id body author_id created_at", json={"body"})
    valid = "OLD.state=NEW.state OR (OLD.state='draft' AND NEW.state='submitted') OR (OLD.state='submitted' AND NEW.state IN ('approved','rejected','withdrawn')) OR (OLD.state='approved' AND NEW.state='withdrawn')"
    result = [trigger(table, "DELETE", reject()), trigger(table, "UPDATE", reject(f"NOT ({immutable}) OR NOT ({valid})"))]
    guard = reject("NEW.published_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM marketplace_storerevision r WHERE r.id=NEW.published_id AND r.store_id=NEW.profile_id AND r.state='approved')")
    return result + [trigger("marketplace_store", event, guard) for event in ("INSERT", "UPDATE")]


def uuid_statements():
    """Fixed hex storage retains native validation and cross-engine ordering."""
    import hashlib
    from django.apps import apps
    result = []
    for model in sorted(apps.get_models(include_auto_created=True), key=lambda m: m._meta.db_table):
        for original in model._meta.concrete_fields:
            field = original
            while getattr(field, "target_field", None) is not None:
                field = field.target_field
            if field.get_internal_type() != "UUIDField":
                continue
            table, column = model._meta.db_table, original.column
            name = "uuid_" + hashlib.sha256((table + ":" + column).encode()).hexdigest()[:24]
            result.append(f"ALTER TABLE `{table}` ADD CONSTRAINT `{name}` CHECK (`{column}` IS NULL OR (CHAR_LENGTH(`{column}`)=32 AND `{column}` REGEXP BINARY '^[0-9a-f]{{32}}$'))")
    return result
