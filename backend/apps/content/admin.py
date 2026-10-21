from django import forms
from django.core.exceptions import PermissionDenied
from django.shortcuts import get_object_or_404, render, redirect
from django.urls import path, reverse
from django.utils.html import format_html
from rest_framework.exceptions import APIException
from unfold.widgets import UnfoldAdminTextareaWidget, UnfoldAdminSelectWidget
from apps.accounts.admin import owner_site
from apps.organizations.admin import ReadOnlyAdmin
from .models import ContentItem, ContentRevision, Publication, ContentEvent, LOCALES
from .services import authority, save, transition, create
from .contracts import Save, Action, Create
from .owner_copy import COPY


class PublicationForm(forms.Form):
    version = forms.IntegerField(widget=forms.HiddenInput)
    action = forms.ChoiceField(
        choices=[(v, v) for v in ["save", "submit", "return", "publish", "unpublish"]], widget=UnfoldAdminSelectWidget
    )
    locale = forms.ChoiceField(choices=[(v, v) for v in LOCALES], widget=UnfoldAdminSelectWidget)
    source = forms.ModelChoiceField(
        queryset=ContentRevision.objects.none(), required=False, widget=UnfoldAdminSelectWidget
    )
    revision = forms.ModelChoiceField(
        queryset=ContentRevision.objects.none(), required=False, widget=UnfoldAdminSelectWidget
    )
    payload = forms.JSONField(
        required=False, widget=UnfoldAdminTextareaWidget(attrs={"rows": 16, "dir": "ltr", "spellcheck": "false"})
    )
    reason = forms.CharField(max_length=1000, required=False, widget=UnfoldAdminTextareaWidget(attrs={"rows": 3}))
    owner_approval = forms.BooleanField(required=False)
    effective_date = forms.DateField(
        required=False,
        widget=forms.DateInput(
            attrs={
                "type": "date",
                "dir": "ltr",
                "class": "block w-full rounded-default border border-base-300 dark:border-base-700 px-3 py-2 bg-transparent",
            }
        ),
    )


class ContentAdmin(ReadOnlyAdmin):
    change_list_template = "content/item_list.html"
    list_display = ["key", "kind", "version", "workflow_link"]
    list_filter = ["kind"]

    def changelist_view(self, request, extra_context=None):
        locale = request.GET.get("locale", "fa-AF")
        locale = locale if locale in COPY else "fa-AF"
        original = request.GET
        parameters = original.copy()
        parameters.pop("locale", None)
        request.GET = parameters
        try:
            return super().changelist_view(
                request, extra_context={**(extra_context or {}), "content_copy": COPY[locale], "content_locale": locale}
            )
        finally:
            request.GET = original

    def workflow_link(self, obj):
        return format_html(
            '<a href="{}">Edit / preview / publish</a>', reverse("admin:content_workflow", args=[obj.key])
        )

    def get_urls(self):
        return [
            path("new/", self.admin_site.admin_view(self.create_item), name="content_create"),
            path("<slug:key>/workflow/", self.admin_site.admin_view(self.workflow), name="content_workflow"),
            *super().get_urls(),
        ]

    def create_item(self, request):
        locale = request.GET.get("locale", "fa-AF")
        locale = locale if locale in COPY else "fa-AF"
        t = COPY[locale]
        try:
            authority(request, "owner", "edit_content")
        except APIException:
            raise PermissionDenied from None
        form = forms.Form(request.POST if request.method == "POST" else None)
        form.fields["key"] = forms.SlugField(max_length=80, label=t["key"])
        if request.method == "POST" and form.is_valid():
            try:
                contract = Create(data={"key": form.cleaned_data["key"], "kind": "article"})
                contract.is_valid(raise_exception=True)
                create(request, "owner", contract.validated_data)
                return redirect(
                    reverse("admin:content_workflow", args=[form.cleaned_data["key"]]) + f"?locale={locale}"
                )
            except APIException:
                form.add_error(None, t["error"])
        return render(
            request,
            "content/workflow.html",
            dict(
                self.admin_site.each_context(request),
                title=t["title"],
                form=form,
                t=t,
                locale=locale,
                direction="ltr" if locale == "en" else "rtl",
            ),
        )

    def workflow(self, request, key):
        item = get_object_or_404(ContentItem, key=key)
        try:
            authority(request, "owner", "read_drafts", item)
        except APIException:
            raise PermissionDenied from None
        locale = request.GET.get("locale", "fa-AF")
        locale = locale if locale in COPY else "fa-AF"
        t = COPY[locale]
        latest = item.revisions.filter(locale="fa-AF").order_by("-number").first()
        form = PublicationForm(
            request.POST if request.method == "POST" else None,
            initial={
                "version": item.version,
                "locale": "fa-AF",
                "payload": latest.payload if latest else {"title": item.key, "blocks": []},
            },
        )
        for name, field in form.fields.items():
            field.label = t.get(name, name)
        form.fields["action"].choices = [
            (action, t[action]) for action in ["save", "submit", "return", "publish", "unpublish"]
        ]
        form.fields["source"].queryset = item.revisions.filter(locale="fa-AF")
        form.fields["revision"].queryset = item.revisions.order_by("-number")
        if request.method == "POST" and form.is_valid():
            data = form.cleaned_data
            try:
                if data["action"] == "save":
                    contract = Save(
                        data={k: data[k] for k in ("version", "locale", "payload")}
                        | {"source": data["source"].pk if data["source"] else None}
                    )
                    contract.is_valid(raise_exception=True)
                    save(request, "owner", key, contract.validated_data)
                else:
                    values = {k: data[k] for k in ("version", "action", "reason", "owner_approval")}
                    values["revision"] = data["revision"].pk if data["revision"] else None
                    if data["effective_date"]:
                        values["effective_date"] = data["effective_date"]
                    contract = Action(data=values)
                    contract.is_valid(raise_exception=True)
                    transition(request, "owner", key, contract.validated_data)
                return redirect(request.get_full_path())
            except APIException:
                form.add_error(
                    None,
                    t["error"],
                )
        return render(
            request,
            "content/workflow.html",
            dict(
                self.admin_site.each_context(request),
                title=f"{t['title']} — {key}",
                t=t,
                locale=locale,
                direction="ltr" if locale == "en" else "rtl",
                form=form,
                item=item,
                revisions=item.revisions.order_by("-number"),
            ),
        )


owner_site.register(ContentItem, ContentAdmin)
owner_site.register(ContentRevision, ReadOnlyAdmin)
owner_site.register(Publication, ReadOnlyAdmin)
owner_site.register(ContentEvent, ReadOnlyAdmin)
