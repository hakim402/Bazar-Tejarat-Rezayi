"""Product review workspace: a native Unfold change form over the locked services.

Source publication and translation decisions keep their version tokens, evidence
and independence safeguards. The page renders through admin/change_form.html with
readonly panels and explicit Unfold action buttons — no custom template.
"""

from django import forms
from django.contrib import admin
from django.core.exceptions import PermissionDenied
from django.db.models import OuterRef, Subquery
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException
from unfold.decorators import action, display
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget
from urllib.parse import urlencode

from apps.accounts.admin import owner_site
from apps.accounts.admin.access import admin_actor, is_owner, permits
from apps.accounts.admin.display import state_badge
from apps.organizations.admin import ReadOnlyAdmin
from .. import access, contracts, services, translations
from ..models import (
    CatalogueEvent, Product, SourceRevision, ProductImage, Translation, TranslationJob, LOCALES,
)
from ..owner_copy import localize
from ..queries import working_revisions
from . import moderation
from .summaries import language_name, revision_summary
from .presentation import ProductIdentityMixin, product_cell
from .helpers import (
    changeform_context, chrome_locale, independent_product,
    link_button, panel_note, panel_table, submit_pressed,
)


class RevisionChoice(forms.ModelChoiceField):
    def label_from_instance(self, obj):
        return _("Revision %(number)s · %(title)s · %(language)s · %(state)s") % {
            "number": obj.number, "title": obj.body.get("title") or _("Untitled product"),
            "language": language_name(obj.body.get("locale")), "state": obj.get_state_display(),
        }


class ReviewForm(forms.ModelForm):
    version = forms.IntegerField(widget=forms.HiddenInput)
    revision = RevisionChoice(queryset=SourceRevision.objects.none(), widget=UnfoldAdminSelectWidget())
    action = forms.ChoiceField(choices=[(x, x) for x in ("publish", "reject", "unpublish")],
                               required=False, widget=forms.HiddenInput)
    reason = forms.CharField(max_length=1000, required=False, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}),
                             help_text=_("Give a reason when rejecting or unpublishing."))

    class Meta:
        model = Product
        fields = []

    def _post_clean(self):
        # The guarded service validates the product; never run model-instance checks here.
        pass


class TranslationSelectionForm(forms.Form):
    revision = RevisionChoice(queryset=SourceRevision.objects.none())
    target = forms.ChoiceField(choices=[(x, x) for x in LOCALES])


class TranslationForm(forms.ModelForm):
    version = forms.IntegerField(min_value=1, widget=forms.HiddenInput)
    revision = RevisionChoice(queryset=SourceRevision.objects.none(), widget=forms.HiddenInput)
    locale = forms.ChoiceField(choices=[(x, x) for x in LOCALES], widget=forms.HiddenInput)
    action = forms.ChoiceField(choices=[(x, x) for x in ("save", "approve", "reject", "generate", "retry")], required=False, widget=forms.HiddenInput)
    title = forms.CharField(max_length=200, required=False)
    description = forms.CharField(max_length=6000, required=False, widget=forms.Textarea)
    image_alts = forms.JSONField(required=False)
    reason = forms.CharField(max_length=1000, required=False)

    class Meta:
        model = Product
        fields = []

    def _post_clean(self):
        pass


class ProductAdmin(ProductIdentityMixin, ReadOnlyAdmin):
    product_path = ""
    def staff_view(self, request, obj=None):
        return permits(request, "catalogue", "review_source", "review_translation", "moderate_catalogue") and (
            obj is None or self.staff_queryset(request, Product.objects.filter(pk=obj.pk)).exists())

    def staff_queryset(self, request, qs):
        return qs.exclude(seller__account__user=request.user).exclude(
            seller__memberships__account__user=request.user).distinct()

    list_display = ["listing", "seller_identity", "currency", "pricing_mode", "published_state", "workflow_link"]
    list_filter = ["currency", "pricing_mode"]
    search_fields = ["seller__display_name", "seller__account__user__email", "variants__sku", "revisions__body__title"]
    search_help_text = _("Find by product title, seller, or SKU")
    actions = None
    change_form_outer_before_template = "catalogue/admin/operation_links.html"

    def get_queryset(self, request):
        latest = working_revisions(SourceRevision.objects.filter(product_id=OuterRef("pk"))).order_by("-number")
        moderation_events = access.restriction_events(CatalogueEvent.objects.filter(product_id=OuterRef("pk")))
        return super().get_queryset(request).select_related("seller").annotate(
            listing_state=Subquery(latest.values("state")[:1]),
            moderation_state=Subquery(moderation_events.values("action")[:1]),
        )

    @display(description=_("Product"), ordering="admin_title")
    def listing(self, obj):
        return product_cell(obj, str(obj.pk)[:8])

    def has_delete_permission(self, request, obj=None):
        return is_owner(request)

    def delete_view(self, request, object_id, extra_context=None):
        return moderation.remove_product(self, request, object_id)

    def visibility_view(self, request, pk, operation):
        return moderation.change_visibility(self, request, pk, operation)

    def get_fieldsets(self, request, obj=None):
        if not obj or not is_owner(request):
            return super().get_fieldsets(request, obj)
        source_fields = ["revisions_panel"]
        if Translation.objects.filter(revision__product=obj).exists():
            source_fields.append("translation_details")
        if TranslationJob.objects.filter(translation__revision__product=obj).exists():
            source_fields.append("jobs_panel")
        return [
            (_("Product identity"), {"fields": ["listing", "seller_identity", ("currency", "pricing_mode"), ("version", "created_at")]}),
            (_("Images"), {"fields": ["images_panel"]}),
            (_("Source and translation records"), {"fields": source_fields}),
            (_("Activity"), {"fields": ["activity_panel"]}),
        ]

    def get_readonly_fields(self, request, obj=None):
        fields = super().get_readonly_fields(request, obj)
        if not obj or not is_owner(request):
            return fields
        return [*fields, "listing", "seller_identity", "images_panel", "revisions_panel", "translation_details", "jobs_panel",
                "activity_panel"]

    def render_change_form(self, request, context, add=False, change=False, form_url="", obj=None):
        if obj is not None and is_owner(request):
            variant_url = f"{reverse('admin:catalogue_variant_changelist')}?{urlencode({'product__id__exact': obj.pk})}"
            context.update(
                operation_summary=[(_("Publication"), self.published_state(obj))],
                operation_links=[
                    link_button(reverse("admin:catalogue_workflow", args=[obj.pk]), _("Source review"), "fact_check"),
                    link_button(variant_url, _("Variants and prices"), "sell"),
                    *moderation.links(obj),
                ],
                show_delete=False,
            )
        return super().render_change_form(request, context, add, change, form_url, obj)

    @admin.display(description=_("Publication"))
    def published_state(self, obj):
        if obj.moderation_state == "restrict":
            return state_badge("restricted")
        if obj.published_id:
            return state_badge("published")
        return state_badge("unpublished" if obj.listing_state == "published" else obj.listing_state or "draft")

    @display(description=_("Review"))
    def workflow_link(self, obj):
        return link_button(
            reverse("admin:catalogue_workflow", args=[obj.pk]),
            _("Source review"), icon="fact_check",
        )

    def get_urls(self):
        return [
            path("<uuid:pk>/workflow/", self.admin_site.admin_view(self.workflow), name="catalogue_workflow"),
            path("<uuid:pk>/visibility/<str:operation>/", self.admin_site.admin_view(self.visibility_view),
                 name="catalogue_product_visibility"),
            path("images/<uuid:pk>/download/", self.admin_site.admin_view(self.download_image), name="catalogue_private_image"),
            *super().get_urls(),
        ]

    def download_image(self, request, pk):
        """Stream one protected product image; folded into the product workspace."""
        from ..views import image_response
        image = get_object_or_404(ProductImage, pk=pk)
        actor = admin_actor(request)
        access.resource(actor, image.product_id)
        from apps.organizations.access import independent
        if not is_owner(request):
            independent(image.product.seller, actor)
        access.audit(actor, image.product, "private_media_inspected")
        return image_response(image, request)

    # --- readonly workspace panels (rendered natively inside the change form) ---

    @admin.display(description=_("Source revisions"))
    def revisions_panel(self, obj):
        revisions = obj.revisions.select_related("author").order_by("-number")
        if not revisions:
            return panel_note(_("No revisions yet."))
        blocks = []
        for revision in revisions:
            blocks.append(format_html(
                '<details class="rounded-default border border-base-200 p-3 dark:border-base-800">'
                '<summary class="cursor-pointer text-sm font-medium" dir="auto">{} · {} · <bdi>{}</bdi></summary>'
                '<p class="my-2 text-sm text-subtle">{} · {} · {}</p>'
                '<div class="mt-3">{}</div>'
                '<p dir="auto" class="mt-1 text-xs text-base-500">{}</p></details>',
                _("Revision %(number)s") % {"number": revision.number}, state_badge(revision.state),
                revision.body.get("title") or _("Untitled product"),
                language_name(revision.body.get("locale")), revision.author, revision.created_at,
                revision_summary(revision), revision.reason,
            ))
        return format_html('<div class="flex flex-col gap-2">{}</div>', format_html_join("", "{}", ((b,) for b in blocks)))

    @admin.display(description=_("Translations"))
    def translations_panel(self, obj):
        return self.translation_rows(obj, editable=True)

    @admin.display(description=_("Translations"))
    def translation_details(self, obj):
        return self.translation_rows(obj, editable=False)

    def translation_rows(self, obj, *, editable):
        rows = Translation.objects.filter(revision__product=obj).select_related("revision")
        if not rows:
            return panel_note(_("No translations yet."))
        base = reverse("admin:catalogue_workflow", args=[obj.pk])
        table = []
        for row in rows:
            url = f"{base}?{urlencode({'translation': '1', 'revision': str(row.revision_id), 'target': row.locale})}"
            summary = [
                row.locale, state_badge(row.state), row.version,
                format_html('<bdi>{}</bdi>', row.title or "—"),
            ]
            if editable:
                summary.append(link_button(url, _("Open"), icon="translate"))
            else:
                summary.append(link_button(reverse("admin:catalogue_translation_change", args=[row.pk]), _("View")))
            table.append(summary)
        headers = [_("Language"), _("State"), _("Version"), _("Title")]
        return panel_table([*headers, ""], table, "")

    @admin.display(description=_("Translation jobs"))
    def jobs_panel(self, obj):
        jobs = TranslationJob.objects.filter(translation__revision__product=obj).select_related("translation")
        if not jobs:
            return panel_note(_("No translation jobs."))
        table = [[j.translation.locale, state_badge(j.status), j.attempts, j.error_code or "—"] for j in jobs]
        return panel_table([_("Language"), _("Status"), _("Attempts"), _("Error")], table, "")

    @admin.display(description=_("Activity"))
    def activity_panel(self, obj):
        events = list(obj.events.order_by("-created_at", "-pk"))
        if not events:
            return panel_note(_("No activity yet."))
        table = [[e.created_at, state_badge(e.action), format_html("<bdi>{}</bdi>", e.reason or "")] for e in events]
        headers = [_("When"), _("Action"), _("Reason")]
        recent = panel_table(headers, table[:5], "")
        if len(table) <= 5:
            return recent
        return format_html(
            '{}<details class="mt-3">'
            '<summary class="inline-flex cursor-pointer items-center rounded-default border border-base-200 px-3 py-2 text-sm font-medium text-base-700 dark:border-base-700 dark:text-base-300">{}</summary>'
            '<div class="mt-3">{}</div></details>',
            recent, _("View more (%(count)s older activities)") % {"count": len(table) - 5},
            panel_table(headers, table[5:], ""),
        )

    @admin.display(description=_("Images"))
    def images_panel(self, obj):
        # Inline gallery: each thumbnail streams through the protected, audited endpoint.
        images = list(obj.images.all())
        if not images:
            return panel_note(_("No images."))
        cells = [
            format_html(
                '<a href="{}" target="_blank" rel="noopener" class="block h-16 w-16 shrink-0 overflow-hidden rounded-default border border-base-200 dark:border-base-800">'
                '<img src="{}" alt="{}" width="64" height="64" class="h-full w-full object-cover" loading="lazy"></a>',
                reverse("admin:catalogue_private_image", args=[image.pk]),
                reverse("admin:catalogue_private_image", args=[image.pk]),
                _("Product image"),
            )
            for image in images
        ]
        return format_html('<div class="flex flex-wrap gap-3">{}</div>', format_html_join("", "{}", ((cell,) for cell in cells)))

    # --- submit-line action markers (the workflow POST handler routes to services) ---

    @action(description=_("Approve and publish"), icon="publish")
    def publish(self, request, obj=None):
        """Submit-line marker."""

    @action(description=_("Reject"), icon="block")
    def reject(self, request, obj=None):
        """Submit-line marker."""

    @action(description=_("Unpublish"), icon="unpublished")
    def unpublish(self, request, obj=None):
        """Submit-line marker."""

    @action(description=_("Save draft"), icon="draft")
    def save(self, request, obj=None):
        """Submit-line marker."""

    @action(description=_("Approve translation"), icon="check_circle")
    def approve(self, request, obj=None):
        """Submit-line marker."""

    @action(description=_("Request automatic draft"), icon="auto_awesome")
    def generate(self, request, obj=None):
        """Submit-line marker."""

    @action(description=_("Retry job"), icon="refresh")
    def retry(self, request, obj=None):
        """Submit-line marker."""

    def workflow(self, request, pk):
        locale = chrome_locale(request)
        item = get_object_or_404(self.get_queryset(request), pk=pk)
        actor = admin_actor(request)
        access.resource(actor, pk)
        independent_decision = independent_product(item, actor)
        translation = request.POST.get("form") == "translation" or request.GET.get("translation") == "1"
        if translation and actor.context == "owner":
            if request.method != "GET":
                raise PermissionDenied
            return redirect("admin:catalogue_product_change", pk)
        if translation and not permits(request, "catalogue", "review_translation"):
            raise PermissionDenied
        if not translation and not permits(request, "catalogue", "review_source", "moderate_catalogue"):
            # A translation-only reviewer starts at its own deliberate source/target selector.
            if request.method == "GET" and permits(request, "catalogue", "review_translation"):
                return redirect(request.path + "?translation=1")
            raise PermissionDenied
        # Distinct Unfold buttons per mode; only permitted actions are offered.
        if translation:
            action_names = ["save", "approve", "reject", "generate", "retry"]
        else:
            action_names = [
                a for a in ("publish", "reject", "unpublish")
                if permits(request, "catalogue", "moderate_catalogue" if a == "unpublish" else "review_source")
            ]
            if actor.context == "owner":
                action_names = [name for name in action_names if name != "unpublish"]
            if item.moderation_state == "restrict" and "publish" in action_names:
                action_names.remove("publish")
        pressed = next((n for n in action_names if submit_pressed(request.POST, n)), None)
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
            selected = RevisionChoice(queryset=revisions, required=False)
            try:
                default_revision = selected.clean(request.GET.get("revision"))
            except forms.ValidationError:
                default_revision = None
            default_revision = default_revision or revisions.filter(state="submitted").first() or working_revisions(revisions).first()
            form = ReviewForm(request.POST if request.method == "POST" else None,
                              initial={"version": item.version, "revision": default_revision})
        t = localize(form, locale)
        if not translation:
            form.fields["revision"].label = _("Source revision to review")
            form.fields["revision"].help_text = _("Choose the seller submission by revision number, product title, language and status.")
        form.instance = item
        form.fields["revision"].queryset = revisions
        if request.method == "POST" and form.is_valid():
            data = dict(form.cleaned_data)
            if pressed:
                data["action"] = pressed
            if data["action"] not in action_names:
                raise PermissionDenied
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
        return render(request, "admin/change_form.html", self._context(
            request, item, form, selection, selected_revision, selected_translation,
            translation, independent_decision, action_names, t, locale,
        ))

    def _context(self, request, item, form, selection, selected_revision, selected_translation,
                 translation, independent_decision, action_names, t, locale):
        """Shape the native change-form context: panels, GET selector and action buttons."""
        if not translation:
            revision_value = form["revision"].value()
            try:
                item._review_revision = form.fields["revision"].clean(revision_value)
            except forms.ValidationError:
                item._review_revision = None
            if item._review_revision and item._review_revision.state != "submitted":
                action_names = [name for name in action_names if name not in {"publish", "reject"}]
        translation_panel = "translation_details" if is_owner(request) else "translations_panel"
        panels = ["revisions_panel", translation_panel, "activity_panel", "images_panel"]
        if translation:
            decision = (_("Translation"), {"fields": ["version", "revision", "locale", "action", "title", "description", "image_alts", "reason"],
                                            "description": t["load_help"]})
            panels = ["revisions_panel", "translations_panel", "jobs_panel", "activity_panel", "images_panel"]
        else:
            decision = (_("Guarded decision"), {"fields": ["version", "revision", "action", "reason"],
                                                 "description": _("Publishing locks this exact source revision; unpublishing keeps it retained.")})
        if not Translation.objects.filter(revision__product=item).exists():
            panels = [panel for panel in panels if panel not in {"translation_details", "translations_panel"}]
        if "jobs_panel" in panels and not TranslationJob.objects.filter(translation__revision__product=item).exists():
            panels.remove("jobs_panel")
        panel_titles = {
            "revisions_panel": _("Source revision history"),
            "translation_details": _("Translations"),
        }
        fieldsets = [decision, *[(panel_titles.get(p, _(p.replace("_panel", "").replace("_", " ").title())),
                                 {"fields": [p]}) for p in panels]]
        # The GET selection form and notices render outside the main POST form (datasets).
        datasets = []
        if not translation and item._review_revision and item._review_revision.state != "submitted":
            datasets.append(panel_note(_("This revision is not awaiting review. Approval and rejection are available for submitted revisions.")))
        if not independent_decision:
            datasets.append(format_html(
                '<div class="rounded-default border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300" role="status">{}</div>',
                _("You can inspect this product. An independent reviewer must decide source and translation submissions for your own or historically linked business."),
            ))
        if selection is not None:
            identity = ""
            if selected_revision is not None:
                identity = format_html(
                    '<p class="mt-2 text-xs text-base-500" role="status"><bdi>{}</bdi> · #{} · {} → {} · {} <bdi>{}</bdi> · {}</p>',
                    selected_revision.pk, selected_revision.number, selected_revision.body["locale"],
                    form["locale"].value(), _("Version"), form["version"].value(),
                    selected_translation.state if selected_translation else "draft",
                )
            datasets.append(format_html(
                '<div class="rounded-default border border-base-200 bg-white p-4 dark:border-base-800 dark:bg-base-900">'
                '<h2 class="mb-1 text-base font-semibold">{}</h2><p class="mb-3 text-sm text-base-500">{}</p>'
                '<form method="get" class="flex flex-col gap-3">'
                '<input type="hidden" name="translation" value="1"><input type="hidden" name="locale" value="{}">'
                '{}<button type="submit" class="inline-flex w-full items-center justify-center gap-1 rounded-default border border-transparent bg-primary-600 px-3 py-2 font-medium text-white hover:bg-primary-600/80 lg:w-auto">{}</button>'
                '</form>{}</div>',
                t["revision"], t["load_help"], locale, selection.as_p(), t["load"], identity,
            ))
        if translation:
            provider = translations.provider_status()
            enabled = provider in ("groq", "test_adapter")
            datasets.append(panel_note(_("Automatic draft provider enabled") if enabled else _("Automatic draft provider disabled. Manual translation remains available.")))
        actions = [self.get_unfold_action(name) for name in action_names]
        return changeform_context(
            request, self, form, fieldsets,
            original=item, title=t["title"],
            readonly_fields=panels, actions=actions, datasets=datasets,
            extra={
                "selection": selection, "item": item, "translation": translation,
                "selected_revision": selected_revision, "selected_translation": selected_translation,
                "independent_decision": independent_decision, "t": t, "locale": locale,
                "direction": "ltr" if locale == "en" else "rtl",
                "operation_links": moderation.links(item) if is_owner(request) else (),
                "show_delete_link": False,
                "show_delete": False,
            },
        )


owner_site.register(Product, ProductAdmin)
