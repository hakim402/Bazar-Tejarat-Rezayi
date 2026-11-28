"""Exact additive email-code, business approval and review-notification metadata."""
import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def reference():
    return json.loads(Path(__file__).with_name("review_reference.json").read_text())


def financial_rows(group, rows):
    approved = reference()["structure"][group]
    return [row for row in rows if row not in approved]


def verify(cursor):
    cursor.execute(
        "SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME "
        "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND "
        "(TABLE_NAME='notifications_reviewnotice' OR "
        "(TABLE_NAME='organizations_businessprofile' AND COLUMN_NAME='effective_case_id') OR "
        "(TABLE_NAME='accounts_actiontoken' AND COLUMN_NAME IN ('code_digest','failed_attempts'))) "
        "ORDER BY TABLE_NAME,ORDINAL_POSITION"
    )
    if [list(row) for row in cursor.fetchall()] != reference()["columns"]:
        raise RuntimeError("Review workflow columns differ from the additive contract.")
    from .schema import structural_inventory
    actual = structural_inventory(cursor, include_content=True)
    for group, expected in reference()["structure"].items():
        if any(row not in actual[group] for row in expected):
            raise RuntimeError("Review workflow constraints differ from the additive contract.")
