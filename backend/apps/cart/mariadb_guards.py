from apps.runtime.mariadb.ddl import reject, same, trigger, retained


def statements():
    result = retained("cart_mergereceipt")
    result.append(trigger("cart_cart", "INSERT", reject("NEW.account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts_account WHERE id=NEW.account_id AND context='buyer')")))
    valid = same("id account_id guest_key")
    result.append(trigger("cart_cart", "UPDATE", reject(f"NOT ({valid}) OR NEW.version<>OLD.version+1 OR OLD.consumed_by_id IS NOT NULL OR (NEW.consumed_by_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts_account WHERE id=NEW.consumed_by_id AND context='buyer'))")))
    active = "OLD.account_id IS NOT NULL OR OLD.consumed_by_id IS NOT NULL OR OLD.expires_at>CURRENT_TIMESTAMP(6)"
    result.append(trigger("cart_cart", "DELETE", reject(active)))
    result.append(trigger("cart_cartcommand", "UPDATE", reject()))
    result.append(trigger("cart_cartcommand", "DELETE", reject("EXISTS(SELECT 1 FROM cart_cart WHERE id=OLD.cart_id AND (account_id IS NOT NULL OR consumed_by_id IS NOT NULL OR expires_at>CURRENT_TIMESTAMP(6)))")))
    for event in ("INSERT", "UPDATE", "DELETE"):
        selected = "OLD" if event == "DELETE" else "NEW"
        body = f"DECLARE selected_id CHAR(32); SELECT id INTO selected_id FROM cart_cart WHERE id={selected}.cart_id FOR UPDATE; "
        body += reject("EXISTS(SELECT 1 FROM cart_cart WHERE id=selected_id AND consumed_by_id IS NOT NULL)")
        if event == "INSERT":
            body += reject("(SELECT count(*) FROM cart_cartline WHERE cart_id=selected_id)>=100")
        if event != "DELETE":
            body += reject("NEW.quantity<=0 OR NEW.quantity>999999999.999 OR NOT EXISTS(SELECT 1 FROM catalogue_variant v JOIN catalogue_saleunit u ON u.code=v.unit_id WHERE v.id=NEW.variant_id AND MOD(NEW.quantity,v.quantity_increment)=0 AND (u.fractional OR NEW.quantity=TRUNCATE(NEW.quantity,0)))")
        if event == "UPDATE":
            body += reject(f"NOT ({same('id cart_id variant_id tier')}) OR NEW.version<>OLD.version+1")
        result.append(trigger("cart_cartline", event, body))
    return result
