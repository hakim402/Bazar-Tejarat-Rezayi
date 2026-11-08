"""Native scoped storefront review; no staff REST adapter or generic publication CRUD."""

from django import forms
from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.db.models import Q, F
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import path, reverse
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException
from unfold.widgets import UnfoldAdminSelectWidget, UnfoldAdminTextareaWidget
from apps.accounts.admin import owner_site
from apps.accounts.admin_access import admin_actor, is_owner, permits
from apps.organizations.access import independent
from apps.organizations.admin import ReadOnlyAdmin
from apps.organizations.models import BusinessProfile
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
    profile = forms.ModelChoiceField(queryset=BusinessProfile.objects.none(), required=False, label="Featured Rezayi store", widget=UnfoldAdminSelectWidget)
    reason = forms.CharField(max_length=1000, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}))


class RevisionAdmin(ReadOnlyAdmin):
    list_display = ["store", "number", "state", "assigned_to", "created_at", "review_link"]
    list_filter = ["state", "created_at"]
    search_fields = ["store__profile__display_name"]
    list_per_page = 20
    list_select_related = ["store__profile", "assigned_to__user"]
    ordering = ["-created_at", "pk"]

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

    def review_link(self, obj):
        return format_html('<a href="{}">Review public store</a>', reverse("admin:marketplace_storerevision_review", args=[obj.pk]))

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
            "revision": revision, "form": form, "independent_decision": independent_decision, "can_act": len(choices) > 1, "can_read": can_read,
            "public_store_url": f"{settings.FRONTEND_ORIGIN}/en/stores/{revision.store_id}",
            "editions": revision.body["editions"].items() if can_read else [], "public_body": revision.body if can_read else None, "media": media}, status=status)

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


owner_site.register(StoreRevision, RevisionAdmin)
owner_site.register(Store, ReadOnlyAdmin)
owner_site.register(StoreEvent, ReadOnlyAdmin)
owner_site.register(FeaturedStore, FeatureAdmin)


class MediaAdmin(ReadOnlyAdmin):
    fields = ['id', 'store', 'created_by', 'content_type', 'width', 'height', 'size', 'created_at', 'protected_download']
    list_display = ['store', 'content_type', 'width', 'height', 'size', 'created_at']
    list_filter = ['content_type']
    search_fields = ['store__profile__display_name']

    def get_readonly_fields(self, request, obj=None):
        return self.fields

    def protected_download(self, obj):
        return format_html('<a href="{}">Inspect protected media</a>', reverse('admin:marketplace_store_media', args=[obj.pk]))


owner_site.register(StoreMedia, MediaAdmin)
