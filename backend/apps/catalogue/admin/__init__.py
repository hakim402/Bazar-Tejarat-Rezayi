"""Catalogue admin: native Unfold screens over the locked domain services.

Split into focused modules — shared helpers, taxonomy CRUD, the product review
workspace and read-only history tables. Importing this package registers every
model. The names below are re-exported for callers and tests.
"""

from django.shortcuts import render

from apps.accounts.admin.access import admin_actor, is_owner, permits
from ..owner_copy import localize
from .helpers import CatalogueRecordAdmin, ServiceFormMixin, chrome_locale
from .taxonomy import (
    CategoryAdmin, CategoryForm, TaxonomyAdmin, UnitAdmin, UnitForm,
)
from .products import (
    ProductAdmin, ReviewForm, RevisionChoice,
    TranslationForm, TranslationSelectionForm,
)
from .records import (
    BudgetAdmin, CatalogueEventAdmin, PriceChangeAdmin, RevisionAdmin,
    TranslationAdmin, TranslationJobAdmin, VariantAdmin,
)

__all__ = [
    "render", "admin_actor", "is_owner", "permits", "localize", "chrome_locale",
    "CatalogueRecordAdmin", "ServiceFormMixin",
    "CategoryAdmin", "CategoryForm", "TaxonomyAdmin", "UnitAdmin", "UnitForm",
    "ProductAdmin", "ReviewForm", "RevisionChoice",
    "TranslationForm", "TranslationSelectionForm",
    "BudgetAdmin", "CatalogueEventAdmin", "PriceChangeAdmin", "RevisionAdmin",
    "TranslationAdmin", "TranslationJobAdmin", "VariantAdmin",
]