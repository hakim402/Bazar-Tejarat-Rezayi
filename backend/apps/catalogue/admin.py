"""Owner workflows call the same locked services; ordinary save and bulk changes are disabled."""

from django import forms
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from django.utils.html import format_html
from urllib.parse import urlencode
from rest_framework.exceptions import APIException
from apps.accounts.admin import owner_site
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
    CatalogueEvent,
    Category,
    SaleUnit,
    LOCALES,
)


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
        item = get_object_or_404(Product, pk=pk)
        actor = access.actor_for(request, "owner")
        access.resource(actor, pk)
        translation = request.POST.get("form") == "translation" or request.GET.get("translation") == "1"
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
                item=item,
                revisions=item.revisions.order_by("-number"),
                translation=translation,
                selection=selection,
                selected_revision=selected_revision,
                selected_translation=selected_translation,
                translations=Translation.objects.filter(revision__product=item),
                events=item.events.order_by("-created_at")[:50],
            ),
        )


class CategoryForm(forms.Form):
    payload = forms.JSONField(widget=forms.Textarea(attrs={"rows": 20, "dir": "ltr"}))


class CategoryAdmin(ReadOnlyAdmin):
    def get_readonly_fields(self, request, obj=None):
        return [*super().get_readonly_fields(request, obj), "units"]

    list_display = ["code", "active", "version", "workflow_link"]
    list_filter = ["active"]

    def workflow_link(self, obj):
        return format_html('<a href="{}">Taxonomy / دسته‌بندی</a>', reverse("admin:catalogue_taxonomy", args=[obj.pk]))

    def get_urls(self):
        return [
            path("<slug:code>/workflow/", self.admin_site.admin_view(self.workflow), name="catalogue_taxonomy"),
            *super().get_urls(),
        ]

    def workflow(self, request, code):
        locale = "en"
        actor = access.actor_for(request, "owner")
        access.staff(actor, "manage_taxonomy")
        row = next((r for r in taxonomy.taxonomy()["categories"] if r["code"] == code), None)
        form = CategoryForm(request.POST if request.method == "POST" else None, initial={"payload": row})
        t = localize(form, locale)
        if request.method == "POST" and form.is_valid():
            try:
                contract = contracts.CatalogueTaxonomyInput(data=form.cleaned_data["payload"])
                contract.is_valid(raise_exception=True)
                taxonomy.save_category(actor, contract.validated_data)
                return redirect(request.get_full_path())
            except APIException:
                form.add_error(None, t["error"])
        return render(
            request,
            "catalogue/workflow.html",
            dict(
                self.admin_site.each_context(request),
                title=t["payload"],
                form=form,
                t=t,
                locale=locale,
                direction="ltr" if locale == "en" else "rtl",
            ),
        )


class UnitAdmin(ReadOnlyAdmin):
    list_display = ["code", "active", "fractional", "version", "workflow_link"]

    def workflow_link(self, obj):
        return format_html('<a href="{}">Unit / واحد</a>', reverse("admin:catalogue_unit", args=[obj.pk]))

    def get_urls(self):
        return [
            path("<slug:code>/workflow/", self.admin_site.admin_view(self.workflow), name="catalogue_unit"),
            *super().get_urls(),
        ]

    def workflow(self, request, code):
        actor = access.actor_for(request, "owner")
        access.staff(actor, "manage_taxonomy")
        locale = "en"
        row = next((r for r in taxonomy.taxonomy()["units"] if r["code"] == code), None)
        form = CategoryForm(request.POST if request.method == "POST" else None, initial={"payload": row})
        t = localize(form, locale)
        if request.method == "POST" and form.is_valid():
            try:
                contract = contracts.CatalogueUnitInput(data=form.cleaned_data["payload"])
                contract.is_valid(raise_exception=True)
                taxonomy.save_unit(actor, contract.validated_data)
                return redirect(request.get_full_path())
            except APIException:
                form.add_error(None, t["error"])
        return render(
            request,
            "catalogue/workflow.html",
            dict(
                self.admin_site.each_context(request),
                title=t["unit"],
                form=form,
                t=t,
                locale=locale,
                direction="ltr" if locale == "en" else "rtl",
            ),
        )


owner_site.register(SaleUnit, UnitAdmin)
owner_site.register(Product, ProductAdmin)
owner_site.register(Category, CategoryAdmin)
for model in (
    SourceRevision,
    Variant,
    ProductImage,
    PriceChange,
    Translation,
    TranslationJob,
    CatalogueEvent,
):
    owner_site.register(model, ReadOnlyAdmin)
