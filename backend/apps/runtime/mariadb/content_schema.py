"""Exact additive content metadata, separate from frozen financial contracts."""
import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def reference():
    return json.loads(Path(__file__).with_name("content_reference.json").read_text())


def financial_rows(group, rows):
    # Remove exact approved extension rows only. Unknown objects/definitions stay
    # visible to the original financial contract comparison and fail closed.
    approved = reference()["structure"][group]
    return [row for row in rows if row not in approved]


def verify(cursor):
    cursor.execute(
        "SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME "
        "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND "
        "(TABLE_NAME IN ('site_contentpage','site_contentpagelocale') OR "
        "(TABLE_NAME='catalogue_category' AND COLUMN_NAME IN ('icon','image_id'))) "
        "ORDER BY TABLE_NAME,ORDINAL_POSITION"
    )
    if [list(row) for row in cursor.fetchall()] != reference()["columns"]:
        raise RuntimeError("Current content schema columns are incomplete or differ.")
    from .schema import structural_inventory
    actual = structural_inventory(cursor, include_content=True)
    for group, expected in reference()["structure"].items():
        if any(row not in actual[group] for row in expected):
            raise RuntimeError("Current content schema constraints are incomplete or differ.")
