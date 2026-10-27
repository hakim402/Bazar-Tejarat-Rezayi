"""Database-level append-only history, including raw/queryset update attempts."""

from django.db import migrations

TABLES = ("batch", "operation", "movement", "allocationline", "shortage", "recovery")
FORWARD = """
CREATE FUNCTION inventory_reject_history_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Inventory history is immutable; use a compensating operation.';
END;
$$ LANGUAGE plpgsql;
""" + "\n".join(
    f"CREATE TRIGGER inventory_immutable BEFORE UPDATE OR DELETE ON inventory_{table} "
    "FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_change();"
    for table in TABLES
)
REVERSE = (
    "\n".join(f"DROP TRIGGER inventory_immutable ON inventory_{table};" for table in TABLES)
    + "\nDROP FUNCTION inventory_reject_history_change();"
)


class Migration(migrations.Migration):
    dependencies = [("inventory", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
