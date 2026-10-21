"""Idempotent proposed taxonomy and bounded permission groups; never creates products."""

from django.core.management import BaseCommand
from django.contrib.auth.models import Group, Permission
from django.db import transaction
from apps.catalogue.models import SaleUnit, Category, PERMISSIONS


def names(fa, en, ps, ar):
    return dict(zip(("fa-AF", "en", "ps", "ar"), (fa, en, ps, ar)))


class Command(BaseCommand):
    @transaction.atomic
    def handle(self, **options):
        units = [
            ("piece", names("عدد", "Piece", "دانه", "قطعة"), False),
            ("set", names("ست", "Set", "سیټ", "طقم"), False),
            ("kg", names("کیلوگرام", "Kilogram", "کیلوګرام", "كيلوغرام"), True),
            ("g", names("گرام", "Gram", "ګرام", "غرام"), True),
            ("litre", names("لیتر", "Litre", "لیتر", "لتر"), True),
            ("ml", names("میلی‌لیتر", "Millilitre", "میلي لیتر", "مليلتر"), True),
            ("pack", names("بسته", "Pack", "بسته", "عبوة"), False),
            ("carton", names("کارتن", "Carton", "کارتن", "كرتون"), False),
        ]
        for code, labels, fractional in units:
            SaleUnit.objects.get_or_create(code=code, defaults={"labels": labels, "fractional": fractional})
        categories = [
            (
                "food",
                names("مواد غذایی", "Food", "خوراکي توکي", "مواد غذائية"),
                ["kg", "g", "litre", "piece", "pack", "carton"],
                [
                    ("grade", names("درجه", "Grade", "درجه", "درجة"), "text", False),
                    ("pack_size", names("اندازهٔ بسته", "Pack size", "د بستې اندازه", "حجم العبوة"), "text", True),
                ],
            ),
            (
                "clothing",
                names("پوشاک", "Clothing", "جامې", "ملابس"),
                ["piece", "set", "pack"],
                [
                    ("size", names("اندازه", "Size", "اندازه", "مقاس"), "enum", True),
                    ("color", names("رنگ", "Color", "رنګ", "لون"), "text", True),
                    ("material", names("جنس", "Material", "مواد", "خامة"), "text", False),
                ],
            ),
            (
                "electronics",
                names("وسایل برقی", "Electronics", "برېښنايي توکي", "إلكترونيات"),
                ["piece", "set"],
                [
                    ("model", names("مدل", "Model", "موډل", "طراز"), "text", False),
                    ("condition", names("حالت", "Condition", "حالت", "حالة"), "enum", True),
                ],
            ),
            (
                "cosmetics",
                names("لوازم آرایشی", "Cosmetics", "د ښکلا توکي", "مستحضرات تجميل"),
                ["piece", "ml", "g", "pack"],
                [
                    ("shade", names("رنگ", "Shade", "رنګ", "درجة اللون"), "text", True),
                    ("volume", names("حجم", "Volume", "حجم", "حجم"), "decimal", False),
                ],
            ),
        ]
        for code, labels, unit_codes, fields in categories:
            attributes = []
            for key, field_labels, kind, variant in fields:
                definition = {"code": key, "labels": field_labels, "type": kind, "required": False, "variant": variant}
                if kind == "enum":
                    definition["choices"] = ["S", "M", "L", "XL"] if key == "size" else ["new", "used", "refurbished"]
                attributes.append(definition)
            category, created = Category.objects.get_or_create(
                code=code, defaults={"labels": labels, "attributes": attributes}
            )
            if created:
                category.units.set(SaleUnit.objects.filter(code__in=unit_codes))
        for code in PERMISSIONS:
            group, _ = Group.objects.get_or_create(name="Catalogue " + code.replace("_", " "))
            group.permissions.add(*Permission.objects.filter(content_type__app_label="catalogue", codename=code))
        self.stdout.write("Catalogue taxonomy and scoped groups prepared; existing values and products preserved.")
