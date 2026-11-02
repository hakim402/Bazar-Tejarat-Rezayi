"""Native MariaDB guards. Statement lists avoid DELIMITER/client SQL parsing."""


def reject(condition="TRUE", message="Retained history or invalid transition"):
    return f"IF COALESCE(({condition}), TRUE) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='{message}'; END IF;"


def same(columns, *, json=()):
    return " AND ".join(f"JSON_EQUALS(OLD.`{c}`,NEW.`{c}`)" if c in json else f"(OLD.`{c}` <=> NEW.`{c}`)" for c in columns.split())


def trigger(table, event, body, suffix="guard", timing="BEFORE"):
    name = f"{table}_{event.lower()}_{suffix}"
    if len(name) > 64:
        raise ValueError("Native guard name exceeds MariaDB limit")
    return f"CREATE TRIGGER `{name}` {timing} {event} ON `{table}` FOR EACH ROW BEGIN {body} END"


def retained(table):
    return [trigger(table, event, reject()) for event in ("UPDATE", "DELETE")]
