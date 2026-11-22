"""Native scoped storefront review; no staff REST adapter or generic publication CRUD."""

from decimal import Decimal

from django import forms
from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.db.models import Exists, F, OuterRef, Q
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import path, reverse
from django.contrib import admin, messages
from django.utils import timezone
from django.utils.formats import localize
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _, ngettext
from rest_framework.exceptions import APIException
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget, UnfoldAdminTextInputWidget, UnfoldBooleanSwitchWidget
from apps.accounts.admin import owner_site
from apps.accounts.admin.access import admin_actor, is_owner, permits
from apps.accounts.admin.display import short_id, state_badge
from apps.accounts.admin.locale import admin_language, frontend_locale
from apps.accounts.admin.theme import STORE_SETTINGS_THEME
from apps.catalogue.admin.helpers import link_button
from apps.catalogue.admin.presentation import seller_cell
from apps.orders.admin_presentation import account_cell
from apps.orders.reviews import aggregate
from apps.organizations.access import independent
from apps.organizations.admin import ReadOnlyAdmin
from apps.organizations.models import BusinessProfile
from apps.verification.models import ReviewCase
from . import access, services
from .models import Store, StoreRevision, StoreMedia, StoreEvent, FeaturedStore, PERMISSIONS
from .views import media_response


def independent_admin(profile, actor):
    try:
        independent(profile, actor)
    except APIException:
        raise PermissionDenied from None


class ReviewForm(forms.Form):
    version = forms.IntegerField(min_value=0, widget=forms.HiddenInput)
    action = forms.ChoiceField(choices=[], widget=UnfoldAdminSelectWidget)
    reason = forms.CharField(max_length=1000, required=False, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}))
    assigned_to = forms.ModelChoiceField(queryset=services.Account.objects.none(), required=False, widget=UnfoldAdminSelectWidget)


class FeatureForm(forms.Form):
    version = forms.IntegerField(min_value=0, widget=forms.HiddenInput)
    profile = forms.ModelChoiceField(queryset=BusinessProfile.objects.none(), required=False, label=_("Featured Rezayi store"), widget=UnfoldAdminSelectWidget)
    reason = forms.CharField(max_length=1000, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}))


class StoreSettingsForm(forms.Form):
    version = forms.IntegerField(min_value=0, widget=forms.HiddenInput)
    contacts_enabled = forms.BooleanField(
        label=_("Show public contact links"), required=False, widget=UnfoldBooleanSwitchWidget,
        help_text=_("Show WhatsApp and social links from the published store revision."),
    )
    verification_badge_enabled = forms.BooleanField(
        label=_("Show verified business badge"), required=False, widget=UnfoldBooleanSwitchWidget,
        help_text=_("The badge is available only while the business verification is current."),
    )
    premium_starts_on = forms.DateField(
        label=_("Paid shop starts"), required=False, input_formats=["%Y-%m-%d"],
        widget=UnfoldAdminTextInputWidget(attrs={"type": "date"}),
    )
    premium_ends_on = forms.DateField(
        label=_("Paid shop ends"), required=False, input_formats=["%Y-%m-%d"],
        widget=UnfoldAdminTextInputWidget(attrs={"type": "date"}),
        help_text=_("The last day is included. Clear both dates to remove the grant."),
    )
    sponsored_placement = forms.BooleanField(
        label=_("Show in sponsored stores"), required=False, widget=UnfoldBooleanSwitchWidget,
        help_text=_("The homepage can show this shop in Sponsored stores during its paid period if it is published and verified."),
    )
    reason = forms.CharField(label=_("Reason for change"), max_length=1000, widget=UnfoldAdminTextareaWidget(attrs={"rows": 2}))

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in ("contacts_enabled", "verification_badge_enabled", "sponsored_placement"):
            widget = self.fields[field].widget
            widget.attrs["role"] = "switch"
            classes = [item for item in widget.attrs["class"].split() if item != "focus:outline-none"]
            widget.attrs["class"] = " ".join([*classes, STORE_SETTINGS_THEME["switch_control"]])
        for field in ("premium_starts_on", "premium_ends_on"):
            if self.initial.get(field):
                self.initial[field] = self.initial[field].isoformat()

    def clean(self):
        data = super().clean()
        start, end = data.get("premium_starts_on"), data.get("premium_ends_on")
        if (start is None) != (end is None) or (start and start > end):
            self.add_error("premium_ends_on", _("Enter both dates with the end on or after the start."))
        elif data.get("sponsored_placement") and not start:
            self.add_error("sponsored_placement", _("Set the paid shop dates to enable sponsorship."))
        return data


class RevisionAdmin(ReadOnlyAdmin):
    list_display = ["business_identity", "number", "revision_status", "reviewer", "created_at", "review_link"]
    list_display_links = ["business_identity"]
    list_filter = ["state", "created_at"]
    search_fields = ["store__profile__display_name"]
    list_per_page = 20
    list_select_related = ["store__profile__account__user", "assigned_to__user"]
    ordering = ["-created_at", "pk"]

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(seller_published=Exists(
            StoreEvent.objects.filter(store_id=OuterRef("store_id"), revision_id=OuterRef("pk"), action="seller_publish")
        ))

    @admin.display(ordering="state", description=_("Status"))
    def revision_status(self, obj):
        if obj.state == "approved" and obj.seller_published:
            return state_badge("published", _("Published by seller"))
        return state_badge(obj.state)

    @admin.display(description=_("Business"))
    def business_identity(self, obj):
        return seller_cell(obj.store.profile)

    @admin.display(description=_("Assigned reviewer"))
    def reviewer(self, obj):
        return account_cell(obj.assigned_to) if obj.assigned_to_id else _("Unassigned")

    def staff_view(self, request, obj=None):
        if not permits(request, "marketplace", *PERMISSIONS):
            return False
        return obj is None or self.staff_queryset(request, StoreRevision.objects.filter(pk=obj.pk)).exists()

    def staff_queryset(self, request, qs):
        qs = qs.exclude(state="draft").exclude(store__profile__account__user=request.user).exclude(store__profile__memberships__account__user=request.user)
        if not permits(request, "marketplace", "view_store_queue", "assign_store_review"):
            scope = Q(assigned_to=admin_actor(request).account)
            if permits(request, "marketplace", "moderate_store"):
                scope |= Q(pk=F("store__published_id"))
            qs = qs.filter(scope)
        return qs.distinct()

    def get_urls(self):
        return [path("<uuid:pk>/review/", self.admin_site.admin_view(self.workflow), name="marketplace_storerevision_review"),
            path("media/<uuid:pk>/download/", self.admin_site.admin_view(self.download), name="marketplace_store_media"), *super().get_urls()]

    @admin.display(description=_("Review"))
    def review_link(self, obj):
        return link_button(reverse("admin:marketplace_storerevision_review", args=[obj.pk]), _("Open guarded review"), "fact_check")

    def change_view(self, request, object_id, form_url="", extra_context=None):
        if request.method != "GET":
            raise PermissionDenied
        obj = get_object_or_404(self.get_queryset(request), pk=object_id)
        return HttpResponseRedirect(reverse("admin:marketplace_storerevision_review", args=[obj.pk]))

    def can_read(self, actor, revision):
        rights = access.permissions(actor)
        if actor.context == "owner":
            return True
        independent_admin(revision.store.profile, actor)
        return ("read_store_submission" in rights and revision.assigned_to_id == actor.account.pk) or ("moderate_store" in rights and revision.store.published_id == revision.pk)

    def workflow(self, request, pk):
        revision = get_object_or_404(self.get_queryset(request).select_related("store__profile__account", "business_case"), pk=pk)
        actor = admin_actor(request)
        independent_decision = True
        try:
            independent(revision.store.profile, actor)
        except APIException:
            independent_decision = False
        if not independent_decision and actor.context != "owner":
            raise PermissionDenied
        rights = access.permissions(actor)
        can_read = self.can_read(actor, revision)
        choices = [("", "Choose action")]
        if independent_decision and revision.state == "submitted":
            if "assign_store_review" in rights:
                choices.append(("assign", "Assign independent reviewer"))
            if can_read and "review_store" in rights and (actor.context == "owner" or revision.assigned_to_id == actor.account.pk):
                choices += [("approve", "Approve exact public details"), ("reject", "Reject with reason")]
        if independent_decision and revision.store.published_id == revision.pk and "moderate_store" in rights:
            choices.append(("withdraw_content", "Withdraw optional public details"))
        if request.method == "POST":
            if not independent_decision:
                raise PermissionDenied("An independent reviewer must decide this submission.")
            action = request.POST.get("action")
            allowed = (action == "assign" and "assign_store_review" in rights or action in {"approve", "reject"} and can_read and "review_store" in rights or action == "withdraw_content" and "moderate_store" in rights)
            if not allowed:
                raise PermissionDenied
            if action not in {key for key, _ in choices}:
                choices.append((action, action.replace("_", " ").capitalize()))
        form = ReviewForm(request.POST if request.method == "POST" else None, initial={"version": revision.store.version, "assigned_to": revision.assigned_to_id})
        status = 200
        if request.method == "POST" and request.POST.get("action") not in {key for key, _ in choices if key}:
            raise PermissionDenied
        form.fields["action"].choices = choices
        if "assign_store_review" in rights:
            form.fields["assigned_to"].queryset = services.reviewers(revision.store.profile)
        else:
            form.fields.pop("assigned_to")
        if request.method == "POST" and form.is_valid():
            data = form.cleaned_data.copy()
            if data.get("assigned_to"):
                data["assigned_to"] = data["assigned_to"].pk
            try:
                services.review(actor, pk, data)
            except APIException as error:
                form.add_error(None, error.detail)
                status = error.status_code
            else:
                return HttpResponseRedirect(request.path)
        media = []
        if can_read:
            ids = {revision.body.get(key) for key in ("logo", "banner")} - {None}
            images = {str(item.pk): item for item in StoreMedia.objects.filter(store_id=revision.store_id, pk__in=ids)}
            media = [{"url": reverse("admin:marketplace_store_media", args=[images[revision.body[role]].pk]), "name": role.capitalize()} for role in ("logo", "banner") if revision.body.get(role) in images]
        return render(request, "marketplace/review.html", {**self.admin_site.each_context(request), "title": _("Review public store details"),
            "revision": revision, "revision_status": self.revision_status(revision), "form": form,
            "independent_decision": independent_decision, "can_act": len(choices) > 1, "can_read": can_read,
            "public_store_url": f"{settings.FRONTEND_ORIGIN}/en/stores/{revision.store_id}",
            "editions": revision.body["editions"].items() if can_read else [], "public_body": revision.body if can_read else None,
            "contact_fields": revision.body.get("contacts", {}).items() if can_read else (), "media": media}, status=status)

    def download(self, request, pk):
        actor = admin_actor(request)
        item = get_object_or_404(StoreMedia.objects.select_related("store__profile__account"), pk=pk)
        if actor.context != "owner":
            independent_admin(item.store.profile, actor)
        candidates = self.get_queryset(request).filter(store_id=item.store_id)
        authorized = actor.context == "owner" or any(self.can_read(actor, revision) and str(item.pk) in {revision.body.get("logo"), revision.body.get("banner")} for revision in candidates)
        if not authorized:
            raise PermissionDenied
        from apps.accounts.models import AuditEvent
        AuditEvent.objects.create(actor=actor.user, account=actor.account, context=actor.context,
            action="store_media_inspected", request_id=getattr(request, "request_id", None),
            resource_type="marketplace.storemedia", resource_id=item.pk,
            state={"organization_id": str(item.store_id)})
        return media_response(item)


class FeatureAdmin(ReadOnlyAdmin):
    list_display = ["id", "profile", "version"]

    def get_urls(self):
        return [path("configure/", self.admin_site.admin_view(self.configure), name="marketplace_feature_store"), *super().get_urls()]

    def changelist_view(self, request, extra_context=None):
        return self.configure(request)

    def configure(self, request):
        if not is_owner(request):
            raise PermissionDenied
        actor = admin_actor(request)
        current = FeaturedStore.objects.first()
        form = FeatureForm(request.POST if request.method == "POST" else None, initial={"profile": current.profile_id if current else None, "version": current.version if current else 0})
        form.fields["profile"].queryset = access.eligible_profiles()
        status = 200
        if request.method == "POST" and form.is_valid():
            try:
                services.feature(actor, form.cleaned_data["profile"].pk if form.cleaned_data["profile"] else None, form.cleaned_data["version"], form.cleaned_data["reason"])
            except APIException as error:
                form.add_error(None, error.detail)
                status = error.status_code
            else:
                return HttpResponseRedirect(request.path)
        return render(request, "marketplace/feature.html", {**self.admin_site.each_context(request), "title": _("Featured Rezayi store"), "form": form}, status=status)


class StoreAdmin(ReadOnlyAdmin):
    list_display = ["business_identity", "published_state", "paid_shop", "contacts_enabled", "store_settings", "created_at"]
    list_display_links = ["business_identity"]
    list_select_related = ["profile__account__user", "published"]
    search_fields = ["profile__display_name", "profile__legal_name"]
    ordering = ["-created_at"]
    fields = ["business_identity", "published_state", "business_verification", "buyer_rating", "paid_shop", "store_settings", "version", "created_at"]

    def get_urls(self):
        return [
            path("<uuid:pk>/settings/", self.admin_site.admin_view(self.settings_view), name="marketplace_store_settings"),
            *super().get_urls(),
        ]

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    @admin.display(description=_("Business"))
    def business_identity(self, obj):
        return seller_cell(obj.profile)

    @admin.display(description=_("Public store"))
    def published_state(self, obj):
        if obj.published_id:
            return link_button(
                reverse("admin:marketplace_storerevision_review", args=[obj.published_id]),
                _("Published revision %(number)s") % {"number": obj.published.number}, "storefront",
            )
        return _("Not published yet")

    @admin.display(description=_("Current business verification"))
    def business_verification(self, obj):
        case = ReviewCase.objects.filter(profile=obj.profile, revision=obj.profile.revision).first()
        if case:
            return link_button(reverse("admin:verification_reviewcase_workflow", args=[case.pk]), _("Open business verification"), "verified")
        return _("Not submitted")

    def buyer_reviews_url(self, obj):
        return reverse("admin:orders_review_changelist", query={"order__seller__id__exact": obj.profile_id})

    @admin.display(description=_("Buyer rating"))
    def buyer_rating(self, obj):
        rating = aggregate(obj.profile)
        label = _("No approved buyer reviews")
        if rating["count"]:
            label = ngettext("%(average)s out of 5 · %(count)s review", "%(average)s out of 5 · %(count)s reviews", rating["count"]) % {
                "average": localize(Decimal(rating["average"])), "count": localize(rating["count"]),
            }
        return format_html(
            '<div class="flex flex-wrap items-center gap-3"><span>{}</span>{}</div>',
            label, link_button(self.buyer_reviews_url(obj), _("View buyer reviews"), "rate_review"),
        )

    @admin.display(description=_("Shop plan"))
    def paid_shop(self, obj):
        return _("Paid shop") if obj.premium_active else _("Free shop")

    @admin.display(description=_("Store settings"))
    def store_settings(self, obj):
        return link_button(reverse("admin:marketplace_store_settings", args=[obj.pk]), _("Manage store features"), "settings")

    def settings_view(self, request, pk):
        if not is_owner(request) or request.method not in {"GET", "HEAD", "POST"}:
            raise PermissionDenied
        store = get_object_or_404(self.get_queryset(request), pk=pk)
        fields = ("version", "contacts_enabled", "verification_badge_enabled", "premium_starts_on", "premium_ends_on", "sponsored_placement")
        form = StoreSettingsForm(
            request.POST if request.method == "POST" else None,
            initial={field: getattr(store, field) for field in fields},
        )
        status = 200
        if request.method == "POST" and form.is_valid():
            try:
                services.configure_store(admin_actor(request), pk, form.cleaned_data)
            except APIException as error:
                if error.status_code == 409:
                    form.add_error(None, _("This store changed. Reload the page and try again."))
                else:
                    form.add_error(None, _("Review the store settings and try again."))
                status = error.status_code
            else:
                self.message_user(request, _("Store features saved."), level=messages.SUCCESS)
                return HttpResponseRedirect(request.path)
        approved_case = access.eligible_profiles([pk]).values_list("approved_case", flat=True).first()
        published = store.published
        current_publication = bool(
            approved_case and published and published.state == "approved" and published.business_case_id == approved_case
        )
        if store.premium_active:
            plan_badge = state_badge("active", _("Paid shop"))
        elif store.premium_starts_on and store.premium_starts_on > timezone.localdate():
            plan_badge = state_badge("pending", _("Paid plan scheduled"))
        elif store.premium_ends_on:
            plan_badge = state_badge("expired", _("Paid plan ended"))
        else:
            plan_badge = state_badge("free", _("Free shop"))
        if not store.contacts_enabled:
            contact_badge = state_badge("hidden", _("Hidden from the public"))
        elif not current_publication:
            contact_badge = state_badge("pending", _("Awaiting publication"))
        else:
            contact_badge = state_badge("published", _("Visible to the public"))
        return render(request, "marketplace/store_settings.html", {
            **self.admin_site.each_context(request), "title": _("Manage store features"), "store": store, "form": form,
            "rz_store": STORE_SETTINGS_THEME,
            "verified": bool(approved_case),
            "store_url": reverse("admin:marketplace_store_change", args=[pk]),
            "public_url": f"{settings.FRONTEND_ORIGIN}/{frontend_locale(admin_language(request))}/stores/{pk}" if approved_case else None,
            "buyer_rating": self.buyer_rating(store),
            "contact_fields": list(published.body.get("contacts", {}).items()) if published else [],
            "current_publication": current_publication,
            "plan_badge": plan_badge,
            "contact_badge": contact_badge,
        }, status=status)


class StoreEventAdmin(ReadOnlyAdmin):
    list_display = ["business_identity", "action", "context", "version", "created_at"]
    list_select_related = ["store__profile__account__user"]
    list_filter = ["action", "context"]
    search_fields = ["store__profile__display_name"]
    ordering = ["-created_at"]
    badge_fields = ("action",)

    @admin.display(description=_("Business"))
    def business_identity(self, obj):
        return seller_cell(obj.store.profile)


owner_site.register(StoreRevision, RevisionAdmin)
owner_site.register(Store, StoreAdmin)
owner_site.register(StoreEvent, StoreEventAdmin)
owner_site.register(FeaturedStore, FeatureAdmin)


class MediaAdmin(ReadOnlyAdmin):
    fields = ['record_reference', 'business_identity', 'content_type', 'width', 'height', 'size', 'created_at', 'protected_download']
    list_display = ['business_identity', 'content_type', 'width', 'height', 'size', 'created_at', 'protected_download']
    list_display_links = ['business_identity']
    list_filter = ['content_type']
    search_fields = ['store__profile__display_name']
    list_select_related = ['store__profile__account__user']

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    @admin.display(description=_("Reference"))
    def record_reference(self, obj):
        return short_id(obj.pk)

    @admin.display(description=_("Business"))
    def business_identity(self, obj):
        return seller_cell(obj.store.profile)

    @admin.display(description=_("Protected download"))
    def protected_download(self, obj):
        return link_button(reverse('admin:marketplace_store_media', args=[obj.pk]), _("Inspect protected media"), "download")


owner_site.register(StoreMedia, MediaAdmin)
