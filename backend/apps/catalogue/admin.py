"""Owner workflows call the same locked services; ordinary save and bulk changes are disabled."""

from django import forms
from django.core.exceptions import PermissionDenied
from apps.accounts.admin_access import admin_actor, permits, is_owner
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from django.utils.html import format_html
from urllib.parse import urlencode
from rest_framework.exceptions import APIException
from apps.accounts.admin import owner_site
from apps.accounts.admin_copy import COPY as ADMIN_COPY
from apps.organizations.admin import ReadOnlyAdmin
from . import contracts, access, services, translations, taxonomy
from .owner_copy import localize
from .models import (
    Product,
    SourceRevision,
    Variant,
    ProductImage,
    PriceChange,
    Translation,
    TranslationJob,
    TranslationBudget,
    CatalogueEvent,
    Category,
    SaleUnit,
    LOCALES,
)


class CatalogueRecordAdmin(ReadOnlyAdmin):
    def staff_view(self, request, obj=None):
        return permits(request, "catalogue", "view_" + self.model._meta.model_name) and permits(
            request, "catalogue", "review_source", "review_translation", "moderate_catalogue")

    def staff_queryset(self, request, qs):
        path = "revision__product" if self.model in (Translation, TranslationJob) else "product"
        return qs.exclude(**{path + "__seller__account__user": request.user}).exclude(
            **{path + "__seller__memberships__account__user": request.user}).distinct()


class PrivateImageAdmin(CatalogueRecordAdmin):
    def get_readonly_fields(self, request, obj=None):
        return ["id", "product", "content_type", "width", "height", "size", "created_at", "protected_preview"]

    def protected_preview(self, obj):
        return format_html('<a href="{}">Protected image</a>', reverse("admin:catalogue_private_image", args=[obj.pk]))

    def get_urls(self):
        return [path("<uuid:pk>/download/", self.admin_site.admin_view(self.download),
                     name="catalogue_private_image"), *super().get_urls()]

    def download(self, request, pk):
        from .views import image_response
        image = get_object_or_404(ProductImage, pk=pk)
        actor = admin_actor(request)
        access.resource(actor, image.product_id)
        from apps.organizations.access import independent
        if not is_owner(request):
            independent(image.product.seller, actor)
        access.audit(actor, image.product, "private_media_inspected")
        return image_response(image, request)


class RevisionChoice(forms.ModelChoiceField):
    def label_from_instance(self, obj):
        return f"#{obj.number} · {obj.body['locale']} · {obj.state} · {obj.pk}"


class ReviewForm(forms.Form):
    version = forms.IntegerField(widget=forms.HiddenInput)
    revision = RevisionChoice(queryset=SourceRevision.objects.none())
    action = forms.ChoiceField(choices=[(x, x) for x in ("publish", "reject", "unpublish")])
    reason = forms.CharField(max_length=1000, required=False, widget=forms.Textarea(attrs={"rows": 3}))


class TranslationSelectionForm(forms.Form):
    revision = RevisionChoice(queryset=SourceRevision.objects.none())
    target = forms.ChoiceField(choices=[(x, x) for x in LOCALES])


class TranslationForm(forms.Form):
    version = forms.IntegerField(min_value=1, widget=forms.HiddenInput)
    revision = RevisionChoice(queryset=SourceRevision.objects.none(), widget=forms.HiddenInput)
    locale = forms.ChoiceField(choices=[(x, x) for x in LOCALES], widget=forms.HiddenInput)
    action = forms.ChoiceField(choices=[(x, x) for x in ("save", "approve", "reject", "generate", "retry")])
    title = forms.CharField(max_length=200, required=False)
    description = forms.CharField(max_length=6000, required=False, widget=forms.Textarea)
    image_alts = forms.JSONField(required=False)
    reason = forms.CharField(max_length=1000, required=False)


class ProductAdmin(ReadOnlyAdmin):
    def staff_view(self, request, obj=None):
        return permits(request, "catalogue", "review_source", "review_translation", "moderate_catalogue") and (
            obj is None or self.staff_queryset(request, Product.objects.filter(pk=obj.pk)).exists())

    def staff_queryset(self, request, qs):
        return qs.exclude(seller__account__user=request.user).exclude(
            seller__memberships__account__user=request.user).distinct()

    list_display = ["id", "seller", "currency", "pricing_mode", "version", "workflow_link"]
    list_filter = ["currency", "pricing_mode"]
    search_fields = ["seller__display_name", "variants__sku"]

    def workflow_link(self, obj):
        return format_html(
            '<a href="{}">Review / translate / publish</a>', reverse("admin:catalogue_workflow", args=[obj.pk])
        )

    def get_urls(self):
        return [
            path("<uuid:pk>/workflow/", self.admin_site.admin_view(self.workflow), name="catalogue_workflow"),
            *super().get_urls(),
        ]

    def workflow(self, request, pk):
        locale = "en"
        item = get_object_or_404(self.get_queryset(request), pk=pk)
        actor = admin_actor(request)
        access.resource(actor, pk)
        from apps.organizations.access import independent
        independent_decision = True
        try:
            independent(item.seller, actor)
        except APIException:
            independent_decision = False
        translation = request.POST.get("form") == "translation" or request.GET.get("translation") == "1"
        if translation and not permits(request, "catalogue", "review_translation"):
            raise PermissionDenied
        if not translation and not permits(request, "catalogue", "review_source", "moderate_catalogue"):
            # A translation-only reviewer starts at its own deliberate source/target selector.
            if request.method == "GET" and permits(request, "catalogue", "review_translation"):
                return redirect(request.path + "?translation=1")
            raise PermissionDenied
        revisions = item.revisions.order_by("-number")
        selection, selected_revision, selected_translation = None, None, None
        if translation:
            # GET loads a deliberate source/target snapshot. POST always preserves the submitted token.
            default_revision = revisions.filter(pk=item.published_id).first() or revisions.first()
            identity = request.POST if request.method == "POST" else request.GET
            selection_data = {
                "revision": identity.get("revision", str(default_revision.pk) if default_revision else ""),
                "target": identity.get("locale" if request.method == "POST" else "target", ""),
            }
            selection = TranslationSelectionForm(selection_data, auto_id="select_%s")
            selection.fields["revision"].queryset = revisions
            # ModelChoiceField bounds malformed/foreign UUIDs without exposing resource details.
            try:
                selected_revision = selection.fields["revision"].clean(selection_data["revision"])
            except forms.ValidationError:
                pass
            targets = [x for x in LOCALES if not selected_revision or x != selected_revision.body["locale"]]
            selection.fields["target"].choices = [(x, x) for x in targets]
            if not selection_data["target"]:
                selection_data["target"] = targets[0]
            localize(selection, locale)
            if selection.is_valid():
                selected_translation = Translation.objects.filter(
                    revision=selected_revision, locale=selection.cleaned_data["target"]
                ).first()
            else:
                selected_revision = None
            initial = {
                "revision": selected_revision,
                "locale": selection_data["target"],
                "version": selected_translation.version if selected_translation else 1,
                "title": selected_translation.title if selected_translation else "",
                "description": selected_translation.description if selected_translation else "",
                "image_alts": {
                    image["id"]: selected_translation.image_alts.get(image["id"], "") if selected_translation else ""
                    for image in selected_revision.body["images"]
                } if selected_revision else {},
            }
            form = TranslationForm(request.POST if request.method == "POST" else None, initial=initial)
            form.fields["locale"].choices = [(x, x) for x in targets]
        else:
            form = ReviewForm(request.POST if request.method == "POST" else None, initial={"version": item.version})
        if not translation:
            form.fields["action"].choices = [
                (action, action) for action in ("publish", "reject", "unpublish")
                if permits(request, "catalogue", "moderate_catalogue" if action == "unpublish" else "review_source")
            ]
        t = localize(form, locale)
        form.fields["revision"].queryset = revisions
        if request.method == "POST" and form.is_valid():
            data = dict(form.cleaned_data)
            revision = data.pop("revision")
            try:
                if translation:
                    target = data.pop("locale")
                    data["image_alts"] = data["image_alts"] or {}
                    contract = contracts.CatalogueTranslationInput(data=data)
                    contract.is_valid(raise_exception=True)
                    translations.edit(actor, pk, revision.pk, target, contract.validated_data)
                else:
                    contract = contracts.CatalogueAction(data={**data, "revision": revision.pk})
                    contract.is_valid(raise_exception=True)
                    services.transition(actor, pk, contract.validated_data)
                query = {"locale": locale}
                if translation:
                    query.update(translation="1", revision=str(revision.pk), target=target)
                return redirect(request.path + "?" + urlencode(query))
            except APIException as exc:
                form.add_error(None, t["conflict"] if translation and exc.status_code == 409 else t["error"])
        return render(
            request,
            "catalogue/workflow.html",
            dict(
                self.admin_site.each_context(request),
                title=t["title"],
                t=t,
                locale=locale,
                direction="ltr" if locale == "en" else "rtl",
                form=form,
                item=item, independent_decision=independent_decision,
                revisions=item.revisions.order_by("-number"),
                translation=translation,
                can_review_source=permits(request, "catalogue", "review_source", "moderate_catalogue"),
                can_translate=permits(request, "catalogue", "review_translation"),
                selection=selection,
                selected_revision=selected_revision,
                selected_translation=selected_translation,
                translations=Translation.objects.filter(revision__product=item),
                translation_jobs=TranslationJob.objects.filter(translation__revision__product=item).select_related("translation"),
                provider=translations.provider_status(),
                events=item.events.order_by("-created_at")[:50],
                private_images=[{"id": image.pk, "url": reverse("admin:catalogue_private_image", args=[image.pk])}
                                for image in item.images.all()],
            ),
        )


LABEL_FIELDS = {"fa-AF": "label_fa_af", "en": "label_en", "ps": "label_ps", "ar": "label_ar"}


class TaxonomyBaseForm(forms.Form):
    version = forms.IntegerField(min_value=0, widget=forms.HiddenInput)
    code = forms.SlugField(
        max_length=40,
        help_text="Permanent identity: lowercase letters, digits and hyphens. It cannot change after creation.",
    )
    label_fa_af = forms.CharField(max_length=100, widget=forms.TextInput(attrs={"dir": "rtl"}), help_text="Required Dari display name (default marketplace language).")
    label_en = forms.CharField(max_length=100, widget=forms.TextInput(attrs={"dir": "ltr"}), help_text="Required English display name.")
    label_ps = forms.CharField(max_length=100, widget=forms.TextInput(attrs={"dir": "rtl"}), help_text="Required Pashto display name.")
    label_ar = forms.CharField(max_length=100, widget=forms.TextInput(attrs={"dir": "rtl"}), help_text="Required Arabic display name.")
    active = forms.BooleanField(required=False, initial=True, help_text="Inactive entries stay retained but are not offered to new products.")

    def initial_from_row(self, row):
        initial = {"version": row["version"], "code": row["code"], "active": row["active"]}
        initial.update({field: row["labels"].get(locale, "") for locale, field in LABEL_FIELDS.items()})
        return initial

    def labels_payload(self):
        return {locale: self.cleaned_data[field] for locale, field in LABEL_FIELDS.items()}


class CategoryForm(TaxonomyBaseForm):
    parent = forms.ChoiceField(required=False, choices=(), help_text="Optional parent category. Hierarchy is bounded to four levels and cycles are refused.")
    units = forms.CharField(max_length=200, help_text="Comma-separated sale unit codes, 1 to 9 entries, each at most 16 characters. Example: kg, piece.")
    attributes = forms.JSONField(required=False, widget=forms.Textarea(attrs={"rows": 4, "dir": "ltr"}), help_text='Optional advanced attribute definitions as a JSON list. Leave [] unless this category needs extra variant attributes.')

    def clean_units(self):
        entries = [part.strip() for part in self.cleaned_data["units"].split(",")]
        if not entries or any(not entry for entry in entries):
            raise forms.ValidationError("Provide 1 to 9 unit codes separated by commas, without empty entries.")
        return entries

    def clean_attributes(self):
        value = self.cleaned_data.get("attributes")
        if value is None:
            return []
        if not isinstance(value, list):
            raise forms.ValidationError("Attributes must be a JSON list, for example [].")
        return value

    def payload(self):
        return {
            "version": self.cleaned_data["version"],
            "code": self.cleaned_data["code"],
            "labels": self.labels_payload(),
            "parent": self.cleaned_data.get("parent") or None,
            "attributes": self.cleaned_data["attributes"],
            "units": self.cleaned_data["units"],
            "active": self.cleaned_data["active"],
        }


class UnitForm(TaxonomyBaseForm):
    code = forms.SlugField(max_length=16, help_text="Permanent identity: lowercase letters, digits and hyphens, at most 16 characters.")
    fractional = forms.BooleanField(required=False, help_text="Allow fractional quantities such as 0.25 kg; whole-count units stay unchecked.")

    def payload(self):
        return {
            "version": self.cleaned_data["version"],
            "code": self.cleaned_data["code"],
            "labels": self.labels_payload(),
            "fractional": self.cleaned_data["fractional"],
            "active": self.cleaned_data["active"],
        }


def taxonomy_error(form, error, generic):
    detail = getattr(error, "detail", {})
    mapped = False
    if isinstance(detail, dict):
        for key, messages in detail.items():
            target = key if key in form.fields else None
            if key == "labels":
                target = None
            form.add_error(target, messages if isinstance(messages, list) else [str(messages)])
            mapped = True
    if not mapped:
        form.add_error(None, generic)


class TaxonomyAdmin(ReadOnlyAdmin):
    change_list_template = "catalogue/taxonomy_list.html"

    def staff_view(self, request, obj=None):
        return permits(request, "catalogue", "manage_taxonomy")

    def changelist_view(self, request, extra_context=None):
        kind = "taxonomy" if self.model is Category else "unit"
        return super().changelist_view(request, {
            **(extra_context or {}),
            "taxonomy_create_url": reverse("admin:catalogue_" + kind + "_add"),
            "taxonomy_create_label": ADMIN_COPY["create_category"] if self.model is Category else ADMIN_COPY["create_unit"],
        })

    def create(self, request):
        return self.workflow(request, None)


class CategoryAdmin(TaxonomyAdmin):
    def staff_view(self, request, obj=None):
        return permits(request, "catalogue", "manage_taxonomy")

    def get_readonly_fields(self, request, obj=None):
        return [*super().get_readonly_fields(request, obj), "units"]

    list_display = ["code", "active", "version", "workflow_link"]
    list_filter = ["active"]

    def workflow_link(self, obj):
        return format_html('<a href="{}">Taxonomy</a>', reverse("admin:catalogue_taxonomy", args=[obj.pk]))

    def get_urls(self):
        return [
            path("new/", self.admin_site.admin_view(self.create), name="catalogue_taxonomy_add"),
            path("<slug:code>/workflow/", self.admin_site.admin_view(self.workflow), name="catalogue_taxonomy"),
            *super().get_urls(),
        ]

    def workflow(self, request, code):
        locale = "en"
        actor = admin_actor(request)
        access.staff(actor, "manage_taxonomy")
        row = next((r for r in taxonomy.taxonomy()["categories"] if r["code"] == code), None)
        if code is None:
            row = {"version": 0, "code": "", "labels": {locale: "" for locale in LOCALES},
                   "parent": None, "attributes": [], "units": [], "active": True}
        form = CategoryForm(request.POST if request.method == "POST" else None)
        form.initial = form.initial_from_row(row)
        form.initial.update({"parent": row["parent"] or "", "units": ", ".join(row["units"]), "attributes": row["attributes"]})
        form.fields["parent"].choices = [("", "No parent (top level)")] + [
            (c.code, f"{c.code} — {c.labels.get('en') or c.labels.get('fa-AF') or ''}")
            for c in Category.objects.order_by("code") if c.code != code
        ]
        if code is not None:
            form.fields["code"].disabled = True
        t = localize(form, locale)
        if request.method == "POST" and form.is_valid():
            try:
                contract = contracts.CatalogueTaxonomyInput(data=form.payload())
                contract.is_valid(raise_exception=True)
                if code is None and contract.validated_data["version"] != 0 or code is not None and contract.validated_data["code"] != code:
                    form.add_error("code", ADMIN_COPY["category_identity_guard"])
                else:
                    taxonomy.save_category(actor, contract.validated_data)
                    return redirect("admin:catalogue_taxonomy", code=contract.validated_data["code"])
            except APIException as error:
                taxonomy_error(form, error, t["error"])
        return render(
            request,
            "catalogue/taxonomy_form.html",
            dict(
                self.admin_site.each_context(request),
                title=t["payload"],
                form=form,
                t=t,
                locale=locale,
                direction="ltr" if locale == "en" else "rtl",
                editing=code is not None,
                kind="category",
                cancel_url=reverse("admin:catalogue_category_changelist"),
            ),
        )


class UnitAdmin(TaxonomyAdmin):
    def staff_view(self, request, obj=None):
        return permits(request, "catalogue", "manage_taxonomy")

    list_display = ["code", "active", "fractional", "version", "workflow_link"]

    def workflow_link(self, obj):
        return format_html('<a href="{}">Unit</a>', reverse("admin:catalogue_unit", args=[obj.pk]))

    def get_urls(self):
        return [
            path("new/", self.admin_site.admin_view(self.create), name="catalogue_unit_add"),
            path("<slug:code>/workflow/", self.admin_site.admin_view(self.workflow), name="catalogue_unit"),
            *super().get_urls(),
        ]

    def workflow(self, request, code):
        actor = admin_actor(request)
        access.staff(actor, "manage_taxonomy")
        locale = "en"
        row = next((r for r in taxonomy.taxonomy()["units"] if r["code"] == code), None)
        if code is None:
            row = {"version": 0, "code": "", "labels": {locale: "" for locale in LOCALES},
                   "fractional": False, "active": True}
        form = UnitForm(request.POST if request.method == "POST" else None)
        form.initial = form.initial_from_row(row)
        form.initial["fractional"] = row["fractional"]
        if code is not None:
            form.fields["code"].disabled = True
        t = localize(form, locale)
        if request.method == "POST" and form.is_valid():
            try:
                contract = contracts.CatalogueUnitInput(data=form.payload())
                contract.is_valid(raise_exception=True)
                if code is None and contract.validated_data["version"] != 0 or code is not None and contract.validated_data["code"] != code:
                    form.add_error("code", ADMIN_COPY["unit_identity_guard"])
                else:
                    taxonomy.save_unit(actor, contract.validated_data)
                    return redirect("admin:catalogue_unit", code=contract.validated_data["code"])
            except APIException as error:
                taxonomy_error(form, error, t["error"])
        return render(
            request,
            "catalogue/taxonomy_form.html",
            dict(
                self.admin_site.each_context(request),
                title=t["unit"],
                form=form,
                t=t,
                locale=locale,
                direction="ltr" if locale == "en" else "rtl",
                editing=code is not None,
                kind="unit",
                cancel_url=reverse("admin:catalogue_saleunit_changelist"),
            ),
        )


class RevisionAdmin(CatalogueRecordAdmin):
    list_display = ["product", "number", "state", "category", "created_at", "workflow_link"]
    list_filter = ["state"]
    ordering = ["created_at"]
    search_fields = ["product__seller__display_name", "product__variants__sku"]

    def workflow_link(self, obj):
        return format_html('<a href="{}">Review</a>', reverse("admin:catalogue_workflow", args=[obj.product_id]))


owner_site.register(SaleUnit, UnitAdmin)
owner_site.register(Product, ProductAdmin)
owner_site.register(Category, CategoryAdmin)
owner_site.register(SourceRevision, RevisionAdmin)
for model in (
    Variant,
    PriceChange,
    Translation,
    TranslationJob,
    CatalogueEvent,
):
    owner_site.register(model, CatalogueRecordAdmin)
owner_site.register(ProductImage, PrivateImageAdmin)


class BudgetAdmin(ReadOnlyAdmin):
    list_display = ['day', 'calls', 'characters']
    ordering = ['-day']


owner_site.register(TranslationBudget, BudgetAdmin)
